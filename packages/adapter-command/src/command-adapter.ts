import type {Artifact,CheckStep,CheckResult,RunEvent,CommandExecution,AdapterCapabilities,Diagnostic,ProjectConfig} from '../../contracts/src/index.js';
import {validateSchema} from '../../contracts/src/index.js';
import type {Adapter,AdapterConfig,AdapterInputs,ProjectContext,ExecutionContext,CollectionContext} from '../../core/src/ports/adapter.js';
import type {RunnerResult} from '../../core/src/ports/runner.js';
import {canonicalJson} from '../../core/src/storage/canonical-json.js';
const failure=(message:string):Diagnostic=>({code:'CONFIG_INVALID',message,source:'command-adapter',location:'',observed_facts:{},recommended_action:'Restore the confirmed adapter and command configuration.'});
function assertCommandStep(step:CheckStep){if(step.adapter_id!=='command'||step.parameters.adapter_id!=='command'||step.parameters.result_kind!=='exit-code'||!step.command_id||step.expected_test_ids.length||step.min_tests!==null)throw Error('An exit-code adapter cannot replace a declared test collector');}
/** Shared execution fact producer; collector-specific assertions are deliberately separate. */
export async function* executeReviewedCommand(step:CheckStep,context:ExecutionContext):AsyncIterable<RunEvent>{
 if(!step.command_id||step.check_id!==context.check_id)throw Error('Command execution scope differs from the plan');
 const started_at=context.clock.now();let result:RunnerResult;
 try{result=await context.commands.run(step.command_id);}catch{result={status:'ERROR',raw_exit_code:null,signal:null,process:null,artifacts:[],diagnostics:[{...failure('Reviewed command execution could not be completed'),code:'TOOL_FAILURE'}]};}
 const fact={schema_version:'0.1',kind:'stackgate-command-execution',run_id:context.run_id,check_id:context.check_id,step_id:step.step_id,attempt_id:context.attempt_id,command_id:step.command_id,started_at,finished_at:context.clock.now(),result};
 const checked=validateSchema<CommandExecution>('command-execution',fact);if(!checked.ok)throw Error('Runner returned invalid execution facts');
 const artifact=await context.artifacts.store({name:'command-execution.json',bytes:Buffer.from(JSON.stringify(checked.value)),media_type:'application/json',artifact_kind:'report',sensitivity:'regular',redaction_state:'NOT_REQUIRED'});
 yield {schema_version:'0.1',event_id:context.ids.create('event'),run_id:context.run_id,seq:1,at:context.clock.now(),type:'artifact.saved',payload:{payload_version:'0.1',artifact}};
}
export type CommandEvidence={status:'FOUND';fact:CommandExecution;artifact:Artifact}|{status:'MISSING'|'INVALID';artifact:Artifact|null;reason:string};
export async function readCommandExecution(step:CheckStep,context:CollectionContext):Promise<CommandEvidence>{
 const candidates=(context.artifacts??[]).filter(a=>a.relative_path.endsWith('/command-execution.json'));
 if(!candidates.length)return {status:'MISSING',artifact:null,reason:'MISSING_REPORT'};
 const matching=candidates.filter(a=>a.run_id===context.run_id&&a.check_id===context.check_id&&a.attempt_id===context.attempt_id);
 if(matching.length!==1)return {status:'INVALID',artifact:candidates[0]!,reason:'REPORT_SCOPE_MISMATCH'};
 const artifact=matching[0]!;
 if(artifact.artifact_kind!=='report'||artifact.retention?.truncated)return {status:'INVALID',artifact,reason:'REPORT_INVALID'};
 const read=await context.evidence.read({run_id:context.run_id,relative_path:artifact.relative_path,expected_digest:artifact.digest,max_bytes:1024*1024});
 if(read.status!=='FOUND')return {status:read.status==='MISSING'?'MISSING':'INVALID',artifact,reason:read.status==='MISSING'?'MISSING_REPORT':'REPORT_INVALID'};
 if(canonicalJson(read.artifact)!==canonicalJson(artifact))return {status:'INVALID',artifact,reason:'REPORT_INVALID'};
 try{
  const checked=validateSchema<CommandExecution>('command-execution',JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(read.bytes)));
  if(!checked.ok)throw Error();const fact=checked.value;
  if(fact.run_id!==context.run_id||fact.check_id!==context.check_id||fact.check_id!==step.check_id||fact.attempt_id!==context.attempt_id||fact.step_id!==step.step_id||fact.command_id!==step.command_id||Date.parse(fact.finished_at)<Date.parse(fact.started_at)||fact.result.execution&&fact.result.execution.command_id!==step.command_id)throw Error();
  const seen=new Set([artifact.artifact_id]);
  for(const secondary of fact.result.artifacts){
   if(seen.has(secondary.artifact_id)||secondary.run_id!==context.run_id||secondary.check_id!==context.check_id||secondary.attempt_id!==context.attempt_id)throw Error();seen.add(secondary.artifact_id);
   const saved=await context.evidence.read({run_id:context.run_id,relative_path:secondary.relative_path,expected_digest:secondary.digest,max_bytes:Math.max(1,secondary.size)});
   if(saved.status!=='FOUND'||canonicalJson(saved.artifact)!==canonicalJson(secondary)||secondary.retention?.critical&&secondary.retention.truncated)throw Error();
  }
  return {status:'FOUND',fact,artifact};
 }catch{return {status:'INVALID',artifact,reason:'REPORT_INVALID'};}
}
export function emptyCheck(step:CheckStep,context:Pick<CollectionContext,'run_id'|'check_id'|'attempt_id'>,status:CheckResult['status'],result_kind:CheckResult['result_kind'],reasons:string[],evidence_refs:string[]=[]):CheckResult{
 return {schema_version:'0.1',run_id:context.run_id,check_id:context.check_id,step_id:step.step_id,attempt_id:context.attempt_id,required:step.required,status,result_kind,exit_code:null,expected_test_ids:[...step.expected_test_ids],executed_test_ids:[],discovered_tests:0,executed_tests:0,skipped_tests:0,flaky_tests:0,reasons,evidence_refs,attempts:[]};
}
/** Converts only verified process facts. stdout text can never declare success. */
export function commandCheckResult(step:CheckStep,context:CollectionContext,evidence:CommandEvidence):CheckResult{
 if(evidence.status!=='FOUND')return emptyCheck(step,context,evidence.status==='MISSING'?'BLOCKED':'ERROR','exit-code',[evidence.reason],evidence.artifact?[evidence.artifact.artifact_id]:[]);
 const {fact,artifact}=evidence,run=fact.result,reasons=run.diagnostics.map(d=>d.code as string);let status:CheckResult['status'];
 if(run.status==='ERROR'){status='ERROR';reasons.push('COMMAND_ERROR');}
 else if(run.status==='CANCELED'||run.status==='TIMED_OUT'){status='BLOCKED';reasons.push('COMMAND_'+run.status);}
 else if(run.raw_exit_code===null||run.signal!==null||!run.process||!run.execution||run.provenance?.cleanup!=='VERIFIED'||run.diagnostics.length){status='ERROR';reasons.push('COMMAND_COMPLETION_UNVERIFIED');}
 else {status=run.raw_exit_code===0?'PASS':'FAIL';if(status==='FAIL')reasons.push('COMMAND_NONZERO_EXIT');}
 if(run.output?.truncated){status='ERROR';reasons.push(run.output.reason??'ARTIFACT_BUDGET_EXCEEDED');}
 const refs=[artifact.artifact_id,...run.artifacts.map(a=>a.artifact_id)];
 return {...emptyCheck(step,context,status,'exit-code',[...new Set(reasons)],refs),exit_code:run.raw_exit_code,attempts:[{attempt_id:context.attempt_id,started_at:fact.started_at,finished_at:fact.finished_at,raw_exit_code:run.raw_exit_code,status,evidence_refs:refs}]};
}
export class CommandAdapter implements Adapter {
 constructor(readonly commands:ProjectConfig['commands']={}){}
 describe():AdapterCapabilities{return {schema_version:'0.1',adapter_id:'command',version:'0.1.0',platforms:['win32','linux','darwin'],schema_dialects:[],schema_features:[],evidence_formats:['stackgate-command-execution/0.1'],provenance_levels:['DECLARED'],status:'SUPPORTED',limitations:['Process execution requires an independently supported and reviewed RunnerPort. No test inventory is inferred.']};}
 async validate(config:AdapterConfig,project:ProjectContext):Promise<Diagnostic[]>{return config.adapter_id==='command'&&this.commands[config.config.command]&&project.workspaces[this.commands[config.config.command]!.workspace]?[]:[failure('Command adapter requires an explicitly declared command and workspace')];}
 async plan(inputs:AdapterInputs):Promise<CheckStep[]>{
  if(inputs.adapter_id!=='command'||inputs.required_test_ids.length)throw Error('Test requirements cannot be replaced by exit-code checks');
  const check=inputs.configuration.config,command=this.commands[check.command];if(!command)throw Error('Command configuration is unavailable');
  const step:CheckStep={step_id:'step_'+inputs.configuration.check_id,check_id:inputs.configuration.check_id,adapter_id:'command',command_id:check.command,depends_on:[],required:true,timeout_ms:command.timeout_seconds*1000,resource_locks:['workspace_'+command.workspace],expected_artifacts:[],expected_test_ids:[],min_tests:null,parameters:{adapter_id:'command',result_kind:'exit-code'}};
  const checked=validateSchema<CheckStep>('check-step',step);if(!checked.ok)throw Error('Invalid command plan');return [checked.value];
 }
 async *execute(step:CheckStep,context:ExecutionContext):AsyncIterable<RunEvent>{assertCommandStep(step);yield*executeReviewedCommand(step,context);}
 async collect(step:CheckStep,context:CollectionContext):Promise<CheckResult>{assertCommandStep(step);return commandCheckResult(step,context,await readCommandExecution(step,context));}
}
