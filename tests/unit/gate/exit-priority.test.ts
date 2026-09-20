import { expect, it } from 'vitest';
import { evaluateGate } from '../../../packages/core/src/domain/evaluate-gate.js';
import { createCheckFact, createGateInput } from '../../support/factories.js';
import { selectExitCode } from '../../../packages/core/src/domain/exit-code.js';
it('the public exit-code function denies unknown facts', () => {
  const valid={configuration_valid:true,verdict:'PASS',freshness:'FRESH',deterministic_denial:false,incomplete:false};
  for(const patch of [{verdict:'UNKNOWN'},{deterministic_denial:undefined},{incomplete:undefined}]) {
    expect(selectExitCode({...valid,...patch} as unknown as Parameters<typeof selectExitCode>[0])).not.toBe(0);
  }
});
for(let mask=0;mask<64;mask++) {
  const invalid=Boolean(mask&1),error=Boolean(mask&2),stale=Boolean(mask&4),failure=Boolean(mask&8),incomplete=Boolean(mask&16),deny=Boolean(mask&32);
  const expected=invalid?64:error?3:stale?4:(failure||deny)?1:incomplete?2:0;
  it('exit priority combination '+mask+' -> '+expected, () => {
    const input=createGateInput({configuration_valid:!invalid,report_integrity:error?'INVALID':'VALID',freshness:stale?'STALE':'FRESH',checks:[createCheckFact(failure?{status:'FAIL',exit_code:1}:{})],inputs_complete:!incomplete,deterministic_denials:deny?['POLICY_WEAKEN_ATTEMPT']:[]});
    const result=evaluateGate(input);expect(result.exit_code).toBe(expected);
    expect(result.decision).toBe(expected===0?'ALLOW':'DENY');
    if(error)expect(result.reasons).toContain('REPORT_INVALID');
    if(stale)expect(result.reasons).toContain('INPUT_STALE');
    if(failure)expect(result.reasons).toContain('CHECK_FAILED:unit');
    if(incomplete)expect(result.reasons).toContain('INPUTS_INCOMPLETE');
    if(deny)expect(result.reasons).toContain('POLICY_WEAKEN_ATTEMPT');
  });
}
