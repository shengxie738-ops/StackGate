import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AUDIT_TASK_IDS, validateAuditM3Ledger } from '../../scripts/verify-audit-m3.mjs';

const ledger = JSON.parse(readFileSync('docs/implementation/audit-m3-fixes.json', 'utf8'));

function baseTask(overrides = {}) {
  return {
    task_id: 'AUD-000', title: 'x', dependencies: [], status: 'NOT_STARTED',
    actual_files: [], verification: [], blockers: [], next_action: 'continue', ...overrides,
  };
}
function ledgerOf(tasks) { return { schema_version: '0.1', audit_baseline: ledger.audit_baseline, tasks }; }

test('current audit ledger validates with all five audit task ids', () => {
  assert.deepEqual(validateAuditM3Ledger(ledger), []);
  for (const id of AUDIT_TASK_IDS) assert.ok(ledger.tasks.some(task => task.task_id === id), `missing ${id}`);
});

test('duplicate audit task ids are rejected', () => {
  const errors = validateAuditM3Ledger(ledgerOf([baseTask(), baseTask()]));
  assert.ok(errors.some(error => error.includes('duplicate audit task_id')), errors.join('\n'));
});

test('unknown status values are rejected', () => {
  const errors = validateAuditM3Ledger(ledgerOf([baseTask({ status: 'PASSED' })]));
  assert.ok(errors.some(error => error.includes('illegal status PASSED')), errors.join('\n'));
});

test('DONE without a passing verification is rejected', () => {
  const errors = validateAuditM3Ledger(ledgerOf([baseTask({
    status: 'DONE', actual_files: ['scripts/verify-audit-m3.mjs'],
    verification: [{
      task_id: 'AUD-000', command: 'node --test x', argv: ['node', '--test', 'x'], cwd_relative: '.',
      started_at: '2026-09-21T00:00:00.000Z', finished_at: '2026-09-21T00:00:01.000Z',
      exit_code: 1, result: 'FAILED', evidence_path: 'docs/implementation/evidence/aud-000-x.json',
      log_path: 'docs/implementation/evidence/aud-000-x.log',
    }],
  })]));
  assert.ok(errors.some(error => error.includes('DONE requires successful verification')), errors.join('\n'));
});

test('DONE without actual files is rejected', () => {
  const errors = validateAuditM3Ledger(ledgerOf([baseTask({ status: 'DONE', actual_files: [] })]));
  assert.ok(errors.some(error => error.includes('DONE requires nonempty actual_files')), errors.join('\n'));
});

test('evidence that belongs to another task id is rejected', () => {
  const errors = validateAuditM3Ledger(ledgerOf([baseTask({
    status: 'DONE', actual_files: ['scripts/verify-audit-m3.mjs'],
    verification: [{
      task_id: 'AUD-000', command: 'node x', argv: ['node', 'x'], cwd_relative: '.',
      started_at: '2026-09-21T00:00:00.000Z', finished_at: '2026-09-21T00:00:01.000Z',
      exit_code: 0, result: 'PASSED', evidence_path: 'docs/implementation/evidence/sg-052-x.json',
      log_path: 'docs/implementation/evidence/sg-052-x.log',
    }],
  })]));
  assert.ok(errors.some(error => error.includes('evidence filename must belong to AUD-000')), errors.join('\n'));
});

test('relative paths escaping the repository are rejected', () => {
  const errors = validateAuditM3Ledger(ledgerOf([baseTask({ actual_files: ['../../outside/file.ts'] })]));
  assert.ok(errors.some(error => error.includes('must be relative and contained')), errors.join('\n'));
});

test('dependency cycles are rejected', () => {
  const errors = validateAuditM3Ledger(ledgerOf([
    baseTask({ task_id: 'AUD-000', dependencies: ['AUD-001'] }),
    baseTask({ task_id: 'AUD-001', dependencies: ['AUD-000'] }),
  ]));
  assert.ok(errors.some(error => error.includes('dependency cycle')), errors.join('\n'));
});

test('BLOCKED without a recorded blocker is rejected', () => {
  const errors = validateAuditM3Ledger(ledgerOf([baseTask({ status: 'BLOCKED' })]));
  assert.ok(errors.some(error => error.includes('BLOCKED requires a blocker')), errors.join('\n'));
});
