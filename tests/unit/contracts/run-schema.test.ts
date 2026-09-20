import { expect, it } from 'vitest';
import { validateSchema } from '../../../packages/contracts/src/validation.js';
import { protocolFixture } from '../../support/protocol-fixtures.js';
it.each(['check-result','artifact','gate-evaluation','plan','probe','event','input-manifest','environment','finding','playwright-report','run'])('accepts complete %s protocol', name => expect(validateSchema(name, protocolFixture(name)).ok).toBe(true));
it('represents zero-test BLOCKED and cancellation without inventing a check status', () => {
  const check = protocolFixture('check-result');
  Object.assign(check, {status:'BLOCKED', executed_tests:0, discovered_tests:0, executed_test_ids:[], reasons:['NO_TESTS']});
  expect(validateSchema('check-result',check).ok).toBe(true);
  check.status='INCOMPLETE'; expect(validateSchema('check-result',check).ok).toBe(false);
  const run=protocolFixture('run'); Object.assign(run,{phase:'CANCELED',verdict:'INCOMPLETE',canceled:true});
  expect(validateSchema('run',run).ok).toBe(true);
});
it('rejects missing run identity and duplicate required IDs', () => {
  const probe=protocolFixture('probe'); delete probe.run_id; expect(validateSchema('probe',probe).ok).toBe(false);
  const plan=protocolFixture('plan'); plan.required_check_ids=['unit','unit']; expect(validateSchema('plan',plan).ok).toBe(false);
});
it('rejects timezone-less event, seq zero, unknown event fields and payload variants', () => {
  const event=protocolFixture('event');
  event.at='2026-09-20T00:00:00'; expect(validateSchema('event',event).ok).toBe(false);
  event.at='2026-09-20T00:00:00Z'; event.seq=0; expect(validateSchema('event',event).ok).toBe(false);
  event.seq=1; event.payload.shell='echo'; expect(validateSchema('event',event).ok).toBe(false);
});
it.each(['../secret','C:/secret','a/../secret','a\\secret'])('rejects artifact escape %s', path => {
  const artifact=protocolFixture('artifact'); artifact.relative_path=path;
  expect(validateSchema('artifact',artifact).ok).toBe(false);
});
it('requires trace to be restricted and declares redaction state', () => {
  const artifact=protocolFixture('artifact'); artifact.media_type='application/zip'; artifact.relative_path='restricted/trace/trace.zip';
  artifact.artifact_kind='trace'; artifact.sensitivity='regular';
  expect(validateSchema('artifact',artifact).ok).toBe(false);
  artifact.sensitivity='restricted'; expect(validateSchema('artifact',artifact).ok).toBe(true);
});
it('does not conflate Git sha1 and sha256 object widths', () => {
  const manifest=protocolFixture('input-manifest'); manifest.git_object_format='sha256';
  expect(validateSchema('input-manifest',manifest).ok).toBe(false);
  for(const key of ['base_oid','head_oid','target_tip_oid'])manifest[key]='b'.repeat(64);
  expect(validateSchema('input-manifest',manifest).ok).toBe(true);
});
it.each(['file:///etc/passwd','http://user:secret@localhost/path'])('rejects non-origin environment identity %s', origin => {
  const env=protocolFixture('environment');env.backend_origin=origin;
  expect(validateSchema('environment',env).ok).toBe(false);
});
it('enforces run Git object width', () => {
  const run=protocolFixture('run');run.git_object_format='sha256';
  expect(validateSchema('run',run).ok).toBe(false);
  run.base_oid='b'.repeat(64);expect(validateSchema('run',run).ok).toBe(true);
});
it('requires explicit artifact classification before regular/restricted policy', () => {
  const artifact=protocolFixture('artifact');delete artifact.artifact_kind;
  expect(validateSchema('artifact',artifact).ok).toBe(false);
});
