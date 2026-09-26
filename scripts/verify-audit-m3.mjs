import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'docs/implementation/audit-m3-fixes.json');
export const AUDIT_TASK_IDS = ['AUD-000', 'AUD-001', 'AUD-002', 'AUD-003', 'AUD-004'];
const states = new Set(['NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED_UNVERIFIED', 'BLOCKED', 'DONE']);
const isRelative = value =>
  typeof value === 'string' && value.length > 0
  && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
  && !value.split(/[\\/]/).includes('..');

export function validateAuditM3Ledger(ledger, { rootDir = root, checkFiles = true } = {}) {
  const errors = [];
  if (!ledger || ledger.schema_version !== '0.1' || !Array.isArray(ledger.tasks)) {
    return ['audit ledger must contain schema_version 0.1 and tasks array'];
  }
  if (!/^[a-f0-9]{40,64}$/.test(ledger.audit_baseline ?? '')) errors.push('audit_baseline must be a real Git hash');
  const ids = ledger.tasks.map(task => task?.task_id);
  for (const id of AUDIT_TASK_IDS) if (!ids.includes(id)) errors.push(`missing audit task ${id}`);
  for (const id of new Set(ids)) if (!/^AUD-\d{3}$/.test(id)) errors.push(`invalid audit task_id ${id}`);
  if (new Set(ids).size !== ids.length) errors.push('duplicate audit task_id');
  const byId = new Map(ledger.tasks.map(task => [task?.task_id, task]));
  for (const task of ledger.tasks) {
    const id = task?.task_id;
    if (!states.has(task?.status)) { errors.push(`${id}: illegal status ${task?.status}`); continue; }
    for (const field of ['dependencies', 'actual_files', 'verification', 'blockers']) {
      if (!Array.isArray(task[field])) errors.push(`${id}: ${field} must be an array`);
    }
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
      if (checkFiles && isRelative(verification.evidence_path)) {
        try {
          const evidence = JSON.parse(readFileSync(path.join(rootDir, verification.evidence_path), 'utf8'));
          if (evidence.task_id !== undefined && evidence.task_id !== id) errors.push(`${id}: recorded evidence task_id must be ${id}`);
          for (const key of ['command', 'cwd_relative', 'started_at', 'finished_at', 'exit_code', 'result', 'evidence_path']) {
            if (evidence[key] !== verification[key]) errors.push(`${id}: evidence mismatch for ${key}`);
          }
          if (!isRelative(evidence.log_path) || !existsSync(path.join(rootDir, evidence.log_path))) {
            errors.push(`${id}: evidence log missing or not relative`);
          }
        } catch (error) { errors.push(`${id}: unreadable evidence ${verification.evidence_path}: ${error.message}`); }
      }
    }
    if (task.status === 'DONE' && !(task.verification ?? []).some(item => item.result === 'PASSED' && item.exit_code === 0)) {
      errors.push(`${id}: DONE requires successful verification`);
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
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    const errors = validateAuditM3Ledger(ledger);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log(`Validated ${ledger.tasks.length} audit tasks against ${ledger.audit_baseline}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
