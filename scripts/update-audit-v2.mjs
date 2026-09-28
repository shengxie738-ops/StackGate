import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { V2_TASK_IDS, verifyV2Ledger } from './verify-v2-audit.mjs';

const [id, status, next, ...files] = process.argv.slice(2);
const ledgerPath = 'docs/implementation/audit-v2-fixes.json';
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const task = ledger.tasks.find(item => item.task_id === id);
if (!task || !V2_TASK_IDS.includes(id) || !['IN_PROGRESS', 'IMPLEMENTED_UNVERIFIED', 'DONE', 'BLOCKED'].includes(status) || !next) {
  throw new Error('usage: node scripts/update-audit-v2.mjs V2-R0N status next_action [files...]');
}
const evidenceDir = 'docs/implementation/evidence';
const records = readdirSync(evidenceDir)
  .filter(file => file.startsWith(`${id.toLowerCase()}-`) && file.endsWith('.json'))
  .map(file => JSON.parse(readFileSync(`${evidenceDir}/${file}`, 'utf8')))
  .filter(record => record.task_id === id && typeof record.command === 'string' && record.command.length > 0);
task.verification = [...new Map([...task.verification, ...records].map(item => [item.evidence_path, item])).values()]
  .sort((left, right) => left.started_at.localeCompare(right.started_at));
task.actual_files = [...new Set([...task.actual_files, ...files])];
for (const file of task.actual_files) if (!existsSync(file)) throw new Error(`Missing actual file ${file}`);
const dependencyDone = dependency => ledger.tasks.find(item => item.task_id === dependency)?.status === 'DONE';
const closable = task.verification.filter(item => item.exit_code === 0 && item.result === 'PASSED' && item.verification_attributable === true);
if (status === 'DONE' && (!closable.length || !task.actual_files.length || !task.dependencies.every(dependencyDone))) {
  throw new Error(`Refusing DONE for ${id}: no evidence attributable to one source snapshot, missing actual files, or unfinished dependencies`);
}
if (status === 'BLOCKED' && !task.blockers.length) throw new Error(`Refusing BLOCKED for ${id} without a blocker`);
task.status = status;
task.next_action = next;
const errors = verifyV2Ledger(ledger);
if (errors.length) throw new Error(`Refusing to write an invalid v2 ledger:\n${errors.join('\n')}`);
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

// The original 100-task ledger keeps its identity; V2 repair work is only pointed at from here.
const originalPath = 'docs/implementation/tasks.json';
const original = JSON.parse(readFileSync(originalPath, 'utf8'));
original.audit_v2_fixes = { ledger: ledgerPath, baseline_sha: ledger.baseline_sha, current: id, status };
writeFileSync(originalPath, `${JSON.stringify(original, null, 2)}\n`);
console.log(`${id}: ${status}`);
