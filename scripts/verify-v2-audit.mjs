import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const V2_LEDGER_PATH = 'docs/implementation/audit-v2-fixes.json';
/** Only these eight ids may be recorded; a pattern must never widen the set on its own. */
export const V2_TASK_IDS = ['V2-R00', 'V2-R01', 'V2-R02', 'V2-R03', 'V2-R04', 'V2-R05', 'V2-R06', 'V2-R07'];
const states = new Set(['NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED_UNVERIFIED', 'BLOCKED', 'DONE']);
const isRelative = value =>
  typeof value === 'string' && value.length > 0
  && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
  && !value.split(/[\\/]/).includes('..');

export function verifyV2Ledger(ledger, { rootDir = root, checkFiles = true } = {}) {
  const errors = [];
  if (!ledger || ledger.schema_version !== '0.1' || !Array.isArray(ledger.tasks)) {
    return ['v2 ledger must contain schema_version 0.1 and tasks array'];
  }
  if (!/^[a-f0-9]{40,64}$/.test(ledger.baseline_sha ?? '')) errors.push('baseline_sha must be a real Git hash');
  if (!isRelative(ledger.source_plan)) errors.push('source_plan must be a relative path');
  else if (checkFiles && !existsSync(path.join(rootDir, ledger.source_plan))) errors.push(`source plan does not exist: ${ledger.source_plan}`);
  if (!isRelative(ledger.companion_audit)) errors.push('companion_audit must be a relative path');
  else if (checkFiles && !existsSync(path.join(rootDir, ledger.companion_audit))) errors.push(`companion audit does not exist: ${ledger.companion_audit}`);
  if (!/^[A-Za-z0-9._-]+$/.test(ledger.target_branch ?? '')) errors.push('target_branch must be a nonempty branch name');

  const ids = ledger.tasks.map(task => task?.task_id);
  for (const id of ids) if (!V2_TASK_IDS.includes(id)) errors.push(`unregistered v2 task_id ${id}`);
  for (const id of V2_TASK_IDS) if (!ids.includes(id)) errors.push(`missing v2 repair task ${id}`);
  if (new Set(ids).size !== ids.length) errors.push('duplicate v2 task_id');
  const byId = new Map(ledger.tasks.map(task => [task?.task_id, task]));

  for (const task of ledger.tasks) {
    const id = task?.task_id;
    if (!states.has(task?.status)) { errors.push(`${id}: illegal status ${task?.status}`); continue; }
    for (const field of ['dependencies', 'actual_files', 'verification', 'blockers']) {
      if (!Array.isArray(task[field])) errors.push(`${id}: ${field} must be an array`);
    }
    if (typeof task.title !== 'string' || !task.title.trim()) errors.push(`${id}: title must be nonempty`);
    if (typeof task.next_action !== 'string' || !task.next_action.trim()) errors.push(`${id}: next_action must be nonempty`);
    for (const dependency of task.dependencies ?? []) {
      if (!byId.has(dependency)) errors.push(`${id}: unknown dependency ${dependency}`);
      else if (task.status === 'DONE' && byId.get(dependency).status !== 'DONE') {
        errors.push(`${id}: dependency ${dependency} must be DONE before DONE`);
      }
    }
    for (const file of task.actual_files ?? []) {
      if (!isRelative(file)) errors.push(`${id}: actual_files must be relative and contained: ${file}`);
      else if (checkFiles && !existsSync(path.join(rootDir, file))) errors.push(`${id}: actual file does not exist: ${file}`);
    }
    for (const verification of task.verification ?? []) {
      if (verification.task_id !== id) errors.push(`${id}: evidence task_id must be ${id}`);
      for (const field of ['cwd_relative', 'evidence_path', 'log_path']) {
        if (!isRelative(verification[field])) errors.push(`${id}: ${field} must be relative and contained`);
      }
      if (typeof verification.evidence_path === 'string'
        && !verification.evidence_path.split(/[\\/]/).at(-1).toLowerCase().startsWith(`${id.toLowerCase()}-`)) {
        errors.push(`${id}: evidence filename must belong to ${id}`);
      }
      if (typeof verification.command !== 'string' || !verification.command.trim()) errors.push(`${id}: verification.command required`);
      if (!Number.isInteger(verification.exit_code)) errors.push(`${id}: verification.exit_code must be integer`);
      if (!['PASSED', 'FAILED'].includes(verification.result)
        || (verification.result === 'PASSED') !== (verification.exit_code === 0)) {
        errors.push(`${id}: verification result does not match exit_code`);
      }
      if (!Number.isFinite(Date.parse(verification.started_at)) || !Number.isFinite(Date.parse(verification.finished_at))
        || Date.parse(verification.finished_at) < Date.parse(verification.started_at)) {
        errors.push(`${id}: invalid verification timestamps`);
      }
      // A record that cannot be pinned to one stable source snapshot is not proof of anything.
      if (typeof verification.verification_attributable !== 'boolean') {
        errors.push(`${id}: evidence record lacks verification_attributable`);
      }
      if (!verification.source_after || typeof verification.source_after.content_hash !== 'string') {
        errors.push(`${id}: evidence record lacks source_after content_hash`);
      }
      if (verification.result === 'PASSED' && verification.source_changed_during_verification === true) {
        errors.push(`${id}: evidence recorded as PASSED while the source drifted during verification`);
      }
      if (checkFiles && isRelative(verification.evidence_path)) {
        try {
          const evidence = JSON.parse(readFileSync(path.join(rootDir, verification.evidence_path), 'utf8'));
          if (evidence.task_id !== undefined && evidence.task_id !== id) errors.push(`${id}: recorded evidence task_id must be ${id}`);
          for (const key of ['command', 'cwd_relative', 'started_at', 'finished_at', 'exit_code', 'result', 'evidence_path',
            'verification_attributable', 'source_changed_during_verification']) {
            if (evidence[key] !== verification[key]) errors.push(`${id}: evidence mismatch for ${key}`);
          }
          if (!isRelative(evidence.log_path) || !existsSync(path.join(rootDir, evidence.log_path))) {
            errors.push(`${id}: evidence log missing or not relative`);
          }
        } catch (error) { errors.push(`${id}: unreadable evidence ${verification.evidence_path}: ${error.message}`); }
      }
    }
    const closable = (task.verification ?? []).filter(item => item.result === 'PASSED' && item.exit_code === 0);
    if (task.status === 'DONE' && closable.length === 0) errors.push(`${id}: DONE requires successful evidence`);
    if (task.status === 'DONE' && !closable.some(item => item.verification_attributable === true)) {
      errors.push(`${id}: DONE requires evidence attributable to one stable source snapshot`);
    }
    if (task.status === 'DONE' && !(task.actual_files?.length > 0)) errors.push(`${id}: DONE requires nonempty actual_files`);
    if (task.status === 'BLOCKED' && task.blockers?.length === 0) errors.push(`${id}: BLOCKED requires a blocker`);
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
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ledger = JSON.parse(readFileSync(path.join(root, V2_LEDGER_PATH), 'utf8'));
    const errors = verifyV2Ledger(ledger);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log(`Validated ${ledger.tasks.length} v2 repair tasks against ${ledger.baseline_sha}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
