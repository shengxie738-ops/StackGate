import {expect,it,vi} from 'vitest';
import {CommandAdapter} from '../../../packages/adapter-command/src/command-adapter.js';
import {commandExecution,commandStep} from '../../support/command-execution.js';
import {withTestDirectory} from '../../support/test-paths.js';
import {validateSchema} from '../../../packages/contracts/src/index.js';
vi.setConfig({testTimeout:45000});
it.each([0,1,7])('collects actual exit %s with immutable command evidence',exit=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,`console.log('PASS');process.exit(${exit})`),adapter=new CommandAdapter();
 const events=[];for await(const event of adapter.execute(commandStep,harness.context))events.push(event);
 const result=await adapter.collect(commandStep,{...harness.collection,artifacts:harness.artifacts});
 expect(validateSchema('check-result',result).ok).toBe(true);expect(result.status).toBe(exit===0?'PASS':'FAIL');expect(result.exit_code).toBe(exit);expect(result.executed_tests).toBe(0);expect(result.evidence_refs.length).toBeGreaterThan(0);expect(events.some(e=>e.type==='artifact.saved')).toBe(true);
 expect(result.attempts[0]?.raw_exit_code).toBe(exit);
}));
it('does not promote missing evidence or a canceled process into PASS',()=>withTestDirectory(async root=>{
 const controller=new AbortController();controller.abort();const harness=await commandExecution(root,'console.log("PASS")',{signal:controller.signal}),adapter=new CommandAdapter();
 expect((await adapter.collect(commandStep,harness.collection)).status).toBe('BLOCKED');
 for await(const _ of adapter.execute(commandStep,harness.context)){void _;}
 expect((await adapter.collect(commandStep,{...harness.collection,artifacts:harness.artifacts})).status).toBe('BLOCKED');
}));
it('preserves timeout without pretending a normal nonzero assertion',()=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,'setInterval(()=>{},1000)',{timeout:100}),adapter=new CommandAdapter();
 for await(const _ of adapter.execute(commandStep,harness.context)){void _;}
 const result=await adapter.collect(commandStep,{...harness.collection,artifacts:harness.artifacts});expect(result.status).toBe('BLOCKED');expect(result.exit_code).toBeNull();expect(result.reasons).toContain('COMMAND_TIMED_OUT');
}));
it('keeps unavailable executable failures distinct from business assertion failure',()=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,'process.exit(0)',{missingExecutable:true}),adapter=new CommandAdapter();
 for await(const event of adapter.execute(commandStep,harness.context)){void event;}
 const result=await adapter.collect(commandStep,{...harness.collection,artifacts:harness.artifacts});expect(result.status).toBe('ERROR');expect(result.exit_code).toBeNull();
}));
it('rejects supplied artifact metadata that differs from the verified store index',()=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,'process.exit(0)'),adapter=new CommandAdapter();
 for await(const event of adapter.execute(commandStep,harness.context)){void event;}
 const result=await adapter.collect(commandStep,{...harness.collection,artifacts:harness.artifacts.map(artifact=>({...artifact,artifact_id:'artifact_forged'}))});expect(result.status).toBe('ERROR');
}));
it.each(['secondary-evidence','signal','diagnostic'])('rejects contradictory runner facts: %s',variant=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,'process.exit(0)'),adapter=new CommandAdapter(),run=harness.context.commands.run;
 harness.context.commands.run=async command=>{
  const result=await run(command);
  if(variant==='signal')result.signal='SIGTERM';
  if(variant==='diagnostic')result.diagnostics.push({code:'TOOL_FAILURE',message:'Evidence callback failed',source:'runner',location:'',observed_facts:{},recommended_action:'Review execution'});
  if(variant==='secondary-evidence'){const artifact=await harness.context.artifacts.store({name:'stdout.log',bytes:Buffer.from('real log'),media_type:'text/plain',artifact_kind:'log',sensitivity:'regular',redaction_state:'REDACTED'});result.artifacts=[{...artifact,run_id:'run_other'}];}
  return result;
 };
 for await(const event of adapter.execute(commandStep,harness.context)){void event;}
 expect((await adapter.collect(commandStep,{...harness.collection,artifacts:harness.artifacts})).status).toBe('ERROR');
}));
it('rejects using the exit-code adapter for a declared test collector',()=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,'console.log("PASS")'),adapter=new CommandAdapter();
 const step={...commandStep,adapter_id:'junit' as const,parameters:{adapter_id:'junit' as const,report_name:'junit.xml' as const},min_tests:1,expected_test_ids:['required']};
 await expect(adapter.collect(step,harness.collection)).rejects.toThrow();
}));
