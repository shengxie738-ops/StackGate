import type { CheckStep } from '../../../contracts/src/index.js';
export function normalizePlanDag(steps: readonly CheckStep[], required: readonly string[]): CheckStep[] {
  if (!steps.length || !required.length || new Set(required).size !== required.length) throw new Error('Plan requires a nonempty unique required set');
  const ids = new Map<string, CheckStep>(), checks = new Set<string>();
  const safe = (id: string) => /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(id);
  for (const step of steps) {
    if (!safe(step.step_id) || !safe(step.check_id) || ids.has(step.step_id) || checks.has(step.check_id)) throw new Error('Duplicate or invalid step/check identity');
    if (step.resource_locks.some(lock => !safe(lock))) throw new Error('Resource locks must be normalized safe IDs');
    if (new Set(step.depends_on).size !== step.depends_on.length || new Set(step.expected_test_ids).size !== step.expected_test_ids.length) throw new Error('Duplicate dependencies or test IDs');
    ids.set(step.step_id, step); checks.add(step.check_id);
  }
  for (const id of required) if (!safe(id) || !steps.some(step => step.check_id === id && step.required)) throw new Error('Required check has no required step');
  for (const step of steps) if (step.required !== required.includes(step.check_id)) throw new Error('Required step flag disagrees with the required set');
  for (const step of steps) for (const dependency of step.depends_on) if (!ids.has(dependency)) throw new Error('Step dependency does not exist');
  const ordered: CheckStep[] = [], remaining = new Set(ids.keys()), completed = new Set<string>();
  while (remaining.size) {
    const ready = [...remaining].filter(id => ids.get(id)!.depends_on.every(dependency => completed.has(dependency))).sort();
    if (!ready.length) throw new Error('Cyclic check dependencies');
    for (const id of ready) {
      const step = ids.get(id)!;
      ordered.push({...step, depends_on: [...step.depends_on].sort(), resource_locks: [...new Set(step.resource_locks)].sort(), expected_artifacts: [...step.expected_artifacts].sort(), expected_test_ids: [...step.expected_test_ids].sort(), parameters: {...step.parameters}});
      remaining.delete(id); completed.add(id);
    }
  }
  return ordered;
}
