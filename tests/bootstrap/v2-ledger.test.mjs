import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { V2_TASK_IDS, verifyV2Ledger } from '../../scripts/verify-v2-audit.mjs';
import { validateAuditM3Ledger } from '../../scripts/verify-audit-m3.mjs';

const ledger = JSON.parse(readFileSync('docs/implementation/audit-v2-fixes.json', 'utf8'));

function task(overrides = {}) {
  return {
    task_id: 'V2-R00', title: 'x', dependencies: [], status: 'NOT_STARTED',
    actual_files: [], verification: [], blockers: [], next_action: 'continue', ...overrides,
  };
}
function ledgerOf(tasks) {
  return {
    schema_version: '0.1',
    baseline_sha: ledger.baseline_sha,
    source_plan: ledger.source_plan,
    companion_audit: ledger.companion_audit,
    target_branch: ledger.target_branch,
    tasks,
  };
}
const minimalLedger = ledgerOf(V2_TASK_IDS.map((id, index) => task({ task_id: id, dependencies: index === 0 ? [] : ['V2-R00'] })));
const attributableRecord = {
  task_id: 'V2-R00', command: 'node scripts/verify-v2-audit.mjs', argv: ['node', 'scripts/verify-v2-audit.mjs'],
  cwd_relative: '.', started_at: '2026-09-28T00:00:00.000Z', finished_at: '2026-09-28T00:00:01.000Z',
  exit_code: 0, result: 'PASSED', evidence_path: 'docs/implementation/evidence/v2-r00-x.json',
  log_path: 'docs/implementation/evidence/v2-r00-x.log',
  source_before: { content_hash: 'sha256:aaa' }, source_after: { content_hash: 'sha256:aaa' },
  source_changed_during_verification: false, verification_attributable: true,
};

test('the plan assertion fragment holds for a minimal ledger and its broken variants', () => {
  assert.deepEqual(verifyV2Ledger(minimalLedger), []);
  const bad = structuredClone(minimalLedger);
  bad.tasks[0].status = 'DONE';
  bad.tasks[0].verification = [];
  assert.ok(verifyV2Ledger(bad).some(x => x.includes('evidence')), 'DONE without evidence must be rejected');
  assert.ok(verifyV2Ledger({ ...minimalLedger, tasks: [...minimalLedger.tasks, minimalLedger.tasks[0]] }).length > 0);
});

test('the shipped v2 ledger validates and carries exactly eight repair tasks', () => {
  assert.deepEqual(verifyV2Ledger(ledger), []);
  assert.equal(ledger.tasks.length, 8);
  for (const id of V2_TASK_IDS) assert.ok(ledger.tasks.some(entry => entry.task_id === id), `missing ${id}`);
  assert.equal(ledger.baseline_sha, '2791cf5f221d6f917101079332f4231c6a450fa7');
  assert.equal(ledger.target_branch, 'V2');
});

test('only the eight registered ids are accepted, V2-R99 is not', () => {
  const errors = verifyV2Ledger(ledgerOf([...V2_TASK_IDS.map(id => task({ task_id: id })), task({ task_id: 'V2-R99' })]));
  assert.ok(errors.some(error => error.includes('unregistered v2 task_id V2-R99')), errors.join('\n'));
  const duplicated = verifyV2Ledger(ledgerOf(V2_TASK_IDS.map(id => task({ task_id: id })).concat(task({ task_id: 'V2-R04' }))));
  assert.ok(duplicated.some(error => error.includes('duplicate v2 task_id')), duplicated.join('\n'));
});

test('a missing repair task is rejected', () => {
  const errors = verifyV2Ledger(ledgerOf(V2_TASK_IDS.slice(0, 7).map(id => task({ task_id: id }))));
  assert.ok(errors.some(error => error.includes('missing v2 repair task V2-R07')), errors.join('\n'));
});

test('unknown dependencies, cycles and premature DONE are rejected', () => {
  const unknown = verifyV2Ledger(ledgerOf([task({ dependencies: ['V2-R99'] })]));
  assert.ok(unknown.some(error => error.includes('unknown dependency V2-R99')), unknown.join('\n'));
  const cycle = verifyV2Ledger(ledgerOf([
    task({ task_id: 'V2-R02', dependencies: ['V2-R03'] }),
    task({ task_id: 'V2-R03', dependencies: ['V2-R02'] }),
  ]));
  assert.ok(cycle.some(error => error.includes('dependency cycle')), cycle.join('\n'));
  const early = verifyV2Ledger(ledgerOf([
    task({ task_id: 'V2-R00', status: 'NOT_STARTED' }),
    task({ task_id: 'V2-R01', dependencies: ['V2-R00'], status: 'DONE', title: 't',
      actual_files: ['scripts/verify-v2-audit.mjs'],
      verification: [{ ...attributableRecord, task_id: 'V2-R01', evidence_path: 'docs/implementation/evidence/v2-r01-x.json',
        log_path: 'docs/implementation/evidence/v2-r01-x.log' }] }),
  ]));
  assert.ok(early.some(error => error.includes('dependency V2-R00 must be DONE')), early.join('\n'));
});

test('illegal status and relative path escapes are rejected', () => {
  const errors = verifyV2Ledger(ledgerOf([task({ status: 'PASSED' })]));
  assert.ok(errors.some(error => error.includes('illegal status PASSED')), errors.join('\n'));
  const escape = verifyV2Ledger(ledgerOf([task({ actual_files: ['../../outside/file.ts'] })]));
  assert.ok(escape.some(error => error.includes('must be relative and contained')), escape.join('\n'));
});

test('DONE cannot be closed by evidence that is not attributable to one source snapshot', () => {
  const closedByTask = task({ status: 'DONE', title: 't', actual_files: ['scripts/verify-v2-audit.mjs'],
    verification: [{ ...attributableRecord, verification_attributable: false }] });
  const errors = verifyV2Ledger(ledgerOf([closedByTask]), { checkFiles: false });
  assert.ok(errors.some(error => error.includes('attributable')), errors.join('\n'));
  assert.ok(!errors.some(error => error.includes('DONE requires successful evidence')), 'a passing record exists; only attribution fails');
});

test('a PASSED record taken while the source drifted is rejected', () => {
  const errors = verifyV2Ledger(ledgerOf([task({ status: 'DONE', title: 't', actual_files: ['scripts/verify-v2-audit.mjs'],
    verification: [{ ...attributableRecord, source_changed_during_verification: true, verification_attributable: false }] })]), { checkFiles: false });
  assert.ok(errors.some(error => error.includes('source drifted during verification')), errors.join('\n'));
});

test('evidence that belongs to another task id is rejected', () => {
  const errors = verifyV2Ledger(ledgerOf([task({ status: 'DONE', title: 't', actual_files: ['scripts/verify-v2-audit.mjs'],
    verification: [{ ...attributableRecord, evidence_path: 'docs/implementation/evidence/sg-052-x.json' }] })]), { checkFiles: false });
  assert.ok(errors.some(error => error.includes('evidence filename must belong to V2-R00')), errors.join('\n'));
});

test('BLOCKED without a recorded blocker is rejected', () => {
  const errors = verifyV2Ledger(ledgerOf([task({ status: 'BLOCKED' })]));
  assert.ok(errors.some(error => error.includes('BLOCKED requires a blocker')), errors.join('\n'));
});

test('the pre-existing M3 validator still closes DONE on non-attributable evidence', () => {
  // Records the gap this ledger exists to pin down: the M3 rules are reused but are not sufficient.
  const ids = ['AUD-000', 'AUD-001', 'AUD-002', 'AUD-003', 'AUD-004'];
  const m3Ledger = {
    schema_version: '0.1',
    audit_baseline: '17ea7adf10bab9961b96cf3edca255b112bf146b',
    tasks: ids.map(id => ({
      task_id: id, title: 'gap probe', dependencies: [], status: 'DONE',
      actual_files: ['scripts/verify-audit-m3.mjs'],
      verification: [{ ...attributableRecord, task_id: id, verification_attributable: false, source_changed_during_verification: true,
        evidence_path: `docs/implementation/evidence/${id.toLowerCase()}-x.json`, log_path: `docs/implementation/evidence/${id.toLowerCase()}-x.log` }],
      blockers: [], next_action: 'none',
    })),
  };
  assert.deepEqual(validateAuditM3Ledger(m3Ledger, { checkFiles: false }), []);
});

test('the recorder accepts only ids registered in the v2 ledger', () => {
  const refused = spawnSync(process.execPath, ['scripts/record.mjs', 'V2-R99', 'probe', '--', 'node', '--version'], { encoding: 'utf8' });
  assert.equal(refused.status, 64, refused.stderr);
  assert.ok(!refused.stdout.includes('Evidence'), 'a refused id must not write evidence');
  const missing = spawnSync(process.execPath, ['scripts/record.mjs', 'V2-R08', 'probe', '--', 'node', '--version'], { encoding: 'utf8' });
  assert.equal(missing.status, 64, 'V2-R08 is not in the plan');
});
