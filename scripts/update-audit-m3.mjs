import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const [id, status, next, ...files] = process.argv.slice(2);
const ledgerPath = 'docs/implementation/audit-m3-fixes.json';
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const task = ledger.tasks.find(item => item.task_id === id);
if (!task || !['IN_PROGRESS', 'IMPLEMENTED_UNVERIFIED', 'DONE', 'BLOCKED'].includes(status) || !next) {
  throw new Error('usage: node scripts/update-audit-m3.mjs AUD-00N status next_action [files...]');
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
if (status === 'DONE' && (!task.verification.some(item => item.exit_code === 0)
  || !task.actual_files.length || !task.dependencies.every(dependencyDone))) {
  throw new Error(`Refusing DONE for ${id}: missing passing evidence, actual files or DONE dependencies`);
}
if (status === 'BLOCKED' && !task.blockers.length) throw new Error(`Refusing BLOCKED for ${id} without a blocker`);
task.status = status;
task.next_action = next;
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const originalPath = 'docs/implementation/tasks.json';
const original = JSON.parse(readFileSync(originalPath, 'utf8'));
original.audit_m3_fixes = { ledger: ledgerPath, audit_baseline: ledger.audit_baseline, current: id, status };
writeFileSync(originalPath, `${JSON.stringify(original, null, 2)}\n`);
console.log(`${id}: ${status}`);
