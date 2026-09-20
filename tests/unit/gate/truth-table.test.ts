import { expect, it } from 'vitest';
import { evaluateGate } from '../../../packages/core/src/domain/evaluate-gate.js';
import { createCheckFact, createGateInput } from '../../support/factories.js';
import type { CheckFact, GateInput } from '../../../packages/contracts/src/index.js';
it.each([
  [{status:'FAIL',exit_code:1},'FAIL',1],
  [{status:'BLOCKED',reasons:['MISSING_REPORT']},'INCOMPLETE',2],
  [{status:'SKIPPED'},'INCOMPLETE',2],
  [{status:'ERROR'},'ERROR',3],
  [{executed_tests:0,executed_test_ids:[]},'INCOMPLETE',2],
  [{skipped_tests:1},'INCOMPLETE',2],
  [{flaky_tests:1},'INCOMPLETE',2],
  [{executed_test_ids:['another']},'INCOMPLETE',2],
  [{evidence_refs:[]},'INCOMPLETE',2],
  [{exit_code:1},'ERROR',3],
  [{executed_tests:-1},'ERROR',3],
  [{required:false},'ERROR',3],
] as [Partial<CheckFact>,string,number][])('evaluates check facts %j', (override, verdict, exit_code) => {
  const input=createGateInput({checks:[createCheckFact(override)]});const before=structuredClone(input);
  expect(evaluateGate(input)).toMatchObject({verdict,decision:'DENY',exit_code});expect(input).toEqual(before);
});
it.each(['inputs_complete','task_confirmed','policy_confirmed','environment_satisfied','acceptance_inputs_approved'] as const)('requires explicit %s', field => {
  expect(evaluateGate(createGateInput({[field]:false}))).toMatchObject({decision:'DENY',exit_code:2});
  expect(evaluateGate(createGateInput({[field]:undefined} as unknown as Partial<GateInput>))).toMatchObject({decision:'DENY',exit_code:2});
});
it('retains optional failures without replacing the required set', () => {
  const input=createGateInput({checks:[createCheckFact(), createCheckFact({check_id:'optional',required:false,status:'FAIL',exit_code:1})]});
  expect(evaluateGate(input)).toMatchObject({verdict:'PASS',decision:'ALLOW',exit_code:0});
  expect(evaluateGate(input).reasons).toContain('OPTIONAL_CHECK_FAIL:optional');
});
it('rejects duplicate check records and required ID conflicts', () => {
  expect(evaluateGate(createGateInput({checks:[createCheckFact(),createCheckFact()]}))).toMatchObject({verdict:'ERROR',exit_code:3});
  expect(evaluateGate(createGateInput({required_check_ids:['unit','unit']}))).toMatchObject({decision:'DENY',exit_code:3});
  expect(evaluateGate(createGateInput({checks:[createCheckFact(),createCheckFact({check_id:'extra'})]}))).toMatchObject({decision:'DENY',exit_code:3});
});
it('cannot relabel a counted test as exit-code', () => {
  expect(evaluateGate(createGateInput({checks:[createCheckFact({result_kind:'exit-code'})]}))).toMatchObject({decision:'DENY',exit_code:3});
});
it('unknown freshness/integrity do not authorize', () => {
  expect(evaluateGate(createGateInput({freshness:'UNVERIFIED'}))).toMatchObject({decision:'DENY',exit_code:2});
  expect(evaluateGate(createGateInput({report_integrity:'UNVERIFIED'}))).toMatchObject({decision:'DENY',exit_code:2});
});
it('stale and failure remain independent', () => {
  expect(evaluateGate(createGateInput({freshness:'STALE',checks:[createCheckFact({status:'FAIL',exit_code:1})]}))).toMatchObject({verdict:'FAIL',freshness:'STALE',exit_code:4});
});
