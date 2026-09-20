import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const states = new Set(['NOT_STARTED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'IMPLEMENTED_UNVERIFIED', 'DONE']);
const isRelative = value => typeof value === 'string' && value.length > 0 && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
export function parseTaskIndex(source) {
  return [...source.matchAll(/^\| \[(SG-\d{3})\]\(#sg-\d{3}\) \| (M[0-5]) \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(([, task_id, phase, title, prerequisites]) => ({ task_id, phase, title: title.trim(), dependencies: prerequisites.match(/SG-\d{3}/g) ?? [] }));
}
export function validateTasks(ledger, { expectedTasks, rootDir = root, checkFiles = true } = {}) {
  const errors = [];
  if (!ledger || ledger.schema_version !== '0.1' || !Array.isArray(ledger.tasks)) return ['ledger must contain schema_version 0.1 and tasks array'];
  const tasks = ledger.tasks;
  const byId = new Map();
  if (tasks.length !== 100) errors.push(`expected 100 tasks, received ${tasks.length}`);
  for (const task of tasks) {
    if (!task || typeof task !== 'object') { errors.push('task must be an object'); continue; }
    const id = task.task_id;
    if (!/^SG-\d{3}$/.test(id ?? '')) errors.push(`invalid task_id ${id}`);
    if (byId.has(id)) errors.push(`duplicate task ID ${id}`);
    byId.set(id, task);
    if (!states.has(task.status)) errors.push(`${id}: illegal status ${task.status}`);
    for (const field of ['dependencies', 'actual_files', 'verification', 'blockers']) if (!Array.isArray(task[field])) errors.push(`${id}: ${field} must be an array`);
    if (task.commit !== null && !/^[a-f0-9]{40,64}$/.test(task.commit ?? '')) errors.push(`${id}: commit must be null or a real Git hash`);
    if (typeof task.next_action !== 'string' || !task.next_action.trim()) errors.push(`${id}: next_action must be nonempty`);
    for (const file of task.actual_files ?? []) {
      if (!isRelative(file)) errors.push(`${id}: actual_files must be relative and contained: ${file}`);
      else if (checkFiles && !existsSync(path.join(rootDir, file))) errors.push(`${id}: actual file does not exist: ${file}`);
    }
    for (const verification of task.verification ?? []) {
      for (const field of ['cwd_relative', 'evidence_path']) if (!isRelative(verification[field])) errors.push(`${id}: ${field} must be relative and contained`);
      if (typeof verification.evidence_path === 'string' && !verification.evidence_path.split(/[\\/]/).at(-1).toLowerCase().startsWith(`${id.toLowerCase()}-`)) errors.push(`${id}: evidence filename must belong to ${id}`);
      if (verification.task_id !== undefined && verification.task_id !== id) errors.push(`${id}: evidence task_id must be ${id}`);
      if (typeof verification.command !== 'string' || !verification.command.trim()) errors.push(`${id}: verification.command required`);
      if (!Number.isInteger(verification.exit_code)) errors.push(`${id}: verification.exit_code must be integer`);
      if (!['PASSED', 'FAILED'].includes(verification.result) || (verification.result === 'PASSED') !== (verification.exit_code === 0)) errors.push(`${id}: verification result does not match exit_code`);
      if (!Number.isFinite(Date.parse(verification.started_at)) || !Number.isFinite(Date.parse(verification.finished_at)) || Date.parse(verification.finished_at) < Date.parse(verification.started_at)) errors.push(`${id}: invalid verification timestamps`);
      if (checkFiles && isRelative(verification.evidence_path)) {
        try {
          const evidence = JSON.parse(readFileSync(path.join(rootDir, verification.evidence_path), 'utf8'));
          if (evidence.task_id !== undefined && evidence.task_id !== id) errors.push(`${id}: recorded evidence task_id must be ${id}`);
          for (const key of ['command', 'cwd_relative', 'started_at', 'finished_at', 'exit_code', 'result', 'evidence_path']) if (evidence[key] !== verification[key]) errors.push(`${id}: evidence mismatch for ${key}`);
          if (!isRelative(evidence.log_path) || !existsSync(path.join(rootDir, evidence.log_path))) errors.push(`${id}: evidence log missing or not relative`);
        } catch (error) { errors.push(`${id}: unreadable evidence ${verification.evidence_path}: ${error.message}`); }
      }
    }
    if (task.status === 'DONE' && !(task.verification ?? []).some(item => item.result === 'PASSED' && item.exit_code === 0)) errors.push(`${id}: DONE requires successful verification`);
    if (task.status === 'DONE' && !(task.actual_files?.length > 0)) errors.push(`${id}: DONE requires nonempty actual_files`);
    if (task.status === 'BLOCKED' && task.blockers?.length === 0) errors.push(`${id}: BLOCKED requires a blocker`);
  }
  for (let index = 1; index <= 100; index++) {
    const id = `SG-${String(index).padStart(3, '0')}`;
    if (!byId.has(id)) errors.push(`missing task ${id}`);
  }
  for (const task of tasks) for (const dependency of task.dependencies ?? []) {
    if (!byId.has(dependency)) errors.push(`${task.task_id}: missing dependency ${dependency}`);
    else if (['READY', 'DONE'].includes(task.status) && byId.get(dependency).status !== 'DONE') errors.push(`${task.task_id}: dependency ${dependency} must be DONE before ${task.status}`);
  }
  const active = new Set();
  const visited = new Set();
  function visit(id) {
    if (active.has(id)) { errors.push(`dependency cycle at ${id}`); return; }
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) if (byId.has(dependency)) visit(dependency);
    active.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  if (expectedTasks) for (const expected of expectedTasks) {
    const task = byId.get(expected.task_id);
    if (!task) continue;
    for (const field of ['phase', 'title', 'dependencies']) if (JSON.stringify(task[field]) !== JSON.stringify(expected[field])) errors.push(`${task.task_id}: ${field} differs from original plan`);
  }
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--ledger')) throw new Error('Usage: node scripts/verify-tasks.mjs [--ledger path]');
    const ledger = JSON.parse(readFileSync(args[1] ?? path.join(root, 'docs/implementation/tasks.json'), 'utf8'));
    const expectedTasks = parseTaskIndex(readFileSync(path.join(root, 'docs/plans/2026-09-18-stackgate-v0.1-execution.md'), 'utf8'));
    const errors = validateTasks(ledger, { expectedTasks });
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log(`Validated ${ledger.tasks.length} tasks, dependencies, states, files and recorded evidence.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
