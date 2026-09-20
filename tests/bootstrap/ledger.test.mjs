import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTasks, parseTaskIndex } from '../../scripts/verify-tasks.mjs';
import { inspectSources } from '../../scripts/verify-source.mjs';

const source = readFileSync(new URL('../../StackGate_Codex可执行开发任务规划_v0.1.md', import.meta.url), 'utf8');
const expected = parseTaskIndex(source);
const createLedger = () => ({ schema_version: '0.1', tasks: expected.map(task => ({ ...structuredClone(task), status: 'NOT_STARTED', actual_files: [], verification: [], commit: null, blockers: [], next_action: `实施 ${task.task_id}` })) });
const check = ledger => validateTasks(ledger, { expectedTasks: expected, checkFiles: false });
test('plan has 100 unique sequential tasks and original dependencies', () => {
  assert.equal(expected.length, 100);
  assert.deepEqual(expected[9].dependencies, ['SG-002', 'SG-008', 'SG-009']);
  assert.deepEqual(check(createLedger()), []);
});
for (const [name, mutate, message] of [
  ['duplicate ID', ledger => ledger.tasks.push(ledger.tasks[0]), /duplicate.*SG-001/i],
  ['missing dependency', ledger => ledger.tasks[1].dependencies.push('SG-999'), /SG-002.*SG-999/],
  ['dependency cycle', ledger => ledger.tasks[0].dependencies.push('SG-002'), /cycle/i],
  ['DONE without evidence', ledger => ledger.tasks[0].status = 'DONE', /SG-001.*verification/i],
  ['illegal status', ledger => ledger.tasks[0].status = 'PASS', /SG-001.*status/i],
  ['early READY', ledger => ledger.tasks[1].status = 'READY', /SG-002.*SG-001.*DONE/i],
  ['missing task', ledger => ledger.tasks.pop(), /SG-100.*missing|missing.*SG-100/i],
  ['absolute file path', ledger => ledger.tasks[0].actual_files.push('C:/secret/file'), /relative/i],
  ['absolute evidence path', ledger => ledger.tasks[0].verification.push({ evidence_path: '/tmp/evidence.json' }), /relative/i],
  ['traversal evidence path', ledger => ledger.tasks[0].verification.push({ evidence_path: '../outside.json' }), /relative/i],
  ['failed-only DONE', ledger => { ledger.tasks[0].status = 'DONE'; ledger.tasks[0].verification.push({ command: 'node test', cwd_relative: '.', started_at: '2026-09-20T00:00:00.000Z', finished_at: '2026-09-20T00:00:01.000Z', exit_code: 1, result: 'FAILED', evidence_path: 'docs/implementation/evidence/fail.json' }); }, /successful.*verification/i],
]) test(`rejects ${name}`, () => { const ledger = createLedger(); mutate(ledger); assert.match(check(ledger).join('\n'), message); });
test('source is preserved byte-for-byte and matches the supplied SHA-256', () => {
  const result = inspectSources();
  assert.deepEqual(result.errors, []);
  assert.equal(result.sources[0].sha256, '56b349eda55673090dee2c611baa250b90f1afa5a3f85a0e78c670fa553af8a9');
});
test('source inspection rejects missing or changed content', () => {
  const result = inspectSources({ read: pathname => pathname.includes('docs/specs') ? Buffer.from('changed') : readFileSync(pathname) });
  assert.match(result.errors.join('\n'), /bytes differ|digest mismatch/i);
});
test('verify-tasks CLI returns nonzero and identifies the task with SG-999 dependency', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackgate-ledger-'));
  try {
    const ledger = createLedger();
    ledger.tasks[1].dependencies.push('SG-999');
    const filename = path.join(directory, 'tasks.json');
    writeFileSync(filename, JSON.stringify(ledger));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/verify-tasks.mjs', import.meta.url)), '--ledger', filename], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SG-002.*SG-999/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
const retainedLedger = JSON.parse(readFileSync(new URL('../../docs/implementation/tasks.json', import.meta.url), 'utf8'));
const recordedSuccess = retainedLedger.tasks[0].verification.find(item => item.exit_code === 0);
test('DONE requires actual implementation files even with valid task evidence', () => {
  const ledger = createLedger();
  ledger.tasks[0].status = 'DONE';
  ledger.tasks[0].verification = [recordedSuccess];
  assert.match(validateTasks(ledger, { expectedTasks: expected }).join('\n'), /SG-001.*actual_files/i);
});
test('DONE cannot borrow another task successful evidence', () => {
  const ledger = createLedger();
  for (const task of ledger.tasks) {
    task.status = 'DONE';
    task.actual_files = ['scripts/verify-tasks.mjs'];
    task.verification = [recordedSuccess];
  }
  assert.match(validateTasks(ledger, { expectedTasks: expected }).join('\n'), /SG-002.*evidence.*SG-002/i);
});
test('evidence runner records task ownership and preserves a failed child exit code', () => {
  const script = fileURLToPath(new URL('../../scripts/record.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'SG-001', 'review-runner-child', '--', 'node', '-e', 'process.exit(7)'], { encoding: 'utf8' });
  assert.equal(result.status, 7);
  const evidencePath = result.stderr.match(/Evidence: ([^;]+);/)?.[1];
  assert.ok(evidencePath, result.stderr);
  const record = JSON.parse(readFileSync(new URL('../../' + evidencePath, import.meta.url), 'utf8'));
  assert.equal(record.task_id, 'SG-001');
  assert.equal(record.exit_code, 7);
  assert.equal(record.result, 'FAILED');
});
test('negative cases do not mutate the shared plan baseline', () => {
  assert.deepEqual(expected, parseTaskIndex(source));
  assert.deepEqual(check(createLedger()), []);
});
