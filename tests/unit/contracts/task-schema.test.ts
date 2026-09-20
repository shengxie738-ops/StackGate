import { expect, it } from 'vitest';
import { validateSchema } from '../../../packages/contracts/src/validation.js';
import { sourceFixture } from '../../support/source-fixtures.js';
it.each(['GET /api/\u0000', 'api:GET /api/\u0001', 'GET /api/\u007f'])('rejects control characters in operation reference %s', operation => {
  const task = sourceFixture('12.3') as any;
  task.required_operations = [operation];
  expect(validateSchema('task', task).ok).toBe(false);
});
it.each(['file:///etc/passwd','mailto:person@example.com','http://user:secret@localhost','http://localhost/path'])('rejects non-origin permission %s', origin => {
  const policy = { schema_version:'0.1', policy_id:'test', policy_hash:'a'.repeat(64), required_set:['unit'], allowed_origins:[origin], allowed_paths:['src/**'], protected_inputs:['tests/**'], minimum_provenance:'OBSERVED', approved_change_records:[], flaky_policy:'incomplete', source:'local-review' };
  expect(validateSchema('policy', policy).ok).toBe(false);
});
it('reads original DRAFT and user-written CONFIRMED without treating either as approval', () => {
  const task = sourceFixture('12.3') as any;
  expect(validateSchema('task', task).ok).toBe(true);
  task.status = 'CONFIRMED';
  expect(validateSchema('task', task).ok).toBe(true);
  expect(validateSchema('confirmation', task).ok).toBe(false);
  expect(validateSchema('trust-record', task).ok).toBe(false);
});
it.each([0, -1, 1.5, '1'])('rejects non-positive integer revision %s', revision => {
  const task = sourceFixture('12.3') as any; task.revision = revision;
  expect(validateSchema('task', task).ok).toBe(false);
});
it.each(['target_contract', 'required_operations', 'required_checks'])('rejects empty %s', field => {
  const task = sourceFixture('12.3') as any; task[field] = field === 'target_contract' ? '' : [];
  expect(validateSchema('task', task).ok).toBe(false);
});
it('requires exact operation, rule, baseline, target and rationale for upgrade approval', () => {
  const task = sourceFixture('12.3') as any;
  const approval = { operation_key: 'api:GET /api/performance', rule_id: 'response-property-type-changed', baseline_hash: 'a'.repeat(64), target_hash: 'b'.repeat(64), reason: 'Reviewed API upgrade' };
  task.compatibility.mode = 'approved-changes'; task.compatibility.approved_breaking_rules = [approval];
  expect(validateSchema('task', task).ok).toBe(true);
  for (const field of Object.keys(approval)) {
    const invalid = structuredClone(task); delete invalid.compatibility.approved_breaking_rules[0][field];
    expect(validateSchema('task', invalid).ok, field).toBe(false);
  }
  approval.rule_id = '*'; expect(validateSchema('task', task).ok).toBe(false);
});
it('requires independent trusted reference, not a claimed name', () => {
  const confirmation: any = { schema_version: '0.1', task_id: 'performance', revision: 1, payload_hash: 'a'.repeat(64), target_hashes: { api: 'b'.repeat(64) }, protected_input_hash: 'c'.repeat(64), confirmed_at: '2026-09-20T00:00:00Z', confirmation_source: 'local-review' };
  expect(validateSchema('confirmation', confirmation).ok).toBe(true);
  confirmation.confirmation_source = 'trusted-ci';
  expect(validateSchema('confirmation', confirmation).ok).toBe(false);
  confirmation.confirmed_by = 'maintainer';
  expect(validateSchema('confirmation', confirmation).ok).toBe(false);
});
