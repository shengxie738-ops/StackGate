import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {CheckStep,CheckResult,RunEvent,ProjectConfig,AdapterCapabilities,Diagnostic} from '../../contracts/src/index.js';
import type {Adapter,AdapterConfig,AdapterInputs,ProjectContext,ExecutionContext,CollectionContext} from '../../core/src/ports/adapter.js';
import {executeReviewedCommand,readCommandExecution,commandCheckResult} from '../../adapter-command/src/command-adapter.js';
import {parseJunit,JUNIT_MAX_BYTES} from '../../core/src/domain/junit-parser.js';
import {canonicalJson} from '../../core/src/storage/canonical-json.js';
function assertStep(step:CheckStep){if(step.adapter_id!=='junit'||step.parameters.adapter_id!=='junit'||step.parameters.report_name!=='junit.xml'||step.min_tests===null||step.min_tests<1||!step.command_id)throw Error('Invalid JUnit check plan');}
async function directoryIdentity(directory:string){
 if(!path.isAbsolute(directory))throw Error('JUnit output must be an absolute owned directory');
 let current=directory;while(true){const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Unsafe JUnit output path');const parent=path.dirname(current);if(parent===current)break;current=parent;}
 return fs.lstat(directory,{bigint:true});
}
export class JunitAdapter implements Adapter {
 constructor(readonly commands:ProjectConfig['commands']={}){}
 describe():AdapterCapabilities{return {schema_version:'0.1',adapter_id:'junit',version:'0.1.0',platforms:['win32','linux','darwin'],schema_dialects:[],schema_features:[],evidence_formats:['junit-xml'],provenance_levels:['DECLARED'],status:'SUPPORTED',limitations:['Bounded UTF-8 JUnit testsuite/testsuites dialect; unknown XML elements and DTDs are rejected. Process execution requires a supported reviewed runner.']};}
 async validate(config:AdapterConfig,project:ProjectContext):Promise<Diagnostic[]>{return config.adapter_id==='junit'&&this.commands[config.config.command]&&project.workspaces[this.commands[config.config.command]!.workspace]?[]:[{code:'CONFIG_INVALID',message:'JUnit requires a declared command and workspace',source:'junit-adapter',location:'',observed_facts:{},recommended_action:'Restore confirmed JUnit configuration.'}];}
 async plan(inputs:AdapterInputs):Promise<CheckStep[]>{if(inputs.adapter_id!=='junit')throw Error('Expected JUnit inputs');const config=inputs.configuration.config,command=this.commands[config.command];if(!command)throw Error('Missing JUnit command');return [{step_id:'step_'+inputs.configuration.check_id,check_id:inputs.configuration.check_id,adapter_id:'junit',command_id:config.command,depends_on:[],required:true,timeout_ms:command.timeout_seconds*1000,resource_locks:['workspace_'+command.workspace],expected_artifacts:['junit.xml'],expected_test_ids:[...inputs.required_test_ids],min_tests:config.min_tests,parameters:{adapter_id:'junit',report_name:'junit.xml'}}];}
 async *execute(step:CheckStep,context:ExecutionContext):AsyncIterable<RunEvent>{
  assertStep(step);const directory=context.environment.STACKGATE_OUTPUT_DIR;if(!directory||!context.allowed_paths.some(allowed=>path.resolve(allowed)===path.resolve(directory)))throw Error('JUnit output is not authorized');
  const owner=await directoryIdentity(directory),filename=path.join(directory,'junit.xml');
  try{await fs.lstat(filename);throw Error('Prior JUnit report is not current evidence');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  yield*executeReviewedCommand(step,context);
  const after=await directoryIdentity(directory);if(owner.dev!==after.dev||owner.ino!==after.ino)throw Error('JUnit output ownership changed');
  let stat;try{stat=await fs.lstat(filename,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size>BigInt(JUNIT_MAX_BYTES))throw Error('Unsafe or oversized JUnit report');
  const handle=await fs.open(filename,'r');let bytes:Buffer;
  try{const opened=await handle.stat({bigint:true});if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error('JUnit report changed');bytes=await handle.readFile();const end=await handle.stat({bigint:true});if(end.size!==stat.size||end.mtimeNs!==stat.mtimeNs||end.nlink!==1n||bytes.length>JUNIT_MAX_BYTES)throw Error('JUnit report changed while reading');}finally{await handle.close();}
  const artifact=await context.artifacts.store({name:'junit.xml',bytes,media_type:'application/xml',artifact_kind:'report',sensitivity:'restricted',redaction_state:'UNREDACTED'});
  yield {schema_version:'0.1',event_id:context.ids.create('event'),run_id:context.run_id,seq:2,at:context.clock.now(),type:'artifact.saved',payload:{payload_version:'0.1',artifact}};
 }
 async collect(step:CheckStep,context:CollectionContext):Promise<CheckResult>{
  assertStep(step);const command=await readCommandExecution(step,context),base=commandCheckResult(step,context,command);base.result_kind='junit';
  const reports=(context.artifacts??[]).filter(a=>a.relative_path.endsWith('/junit.xml'));
  const finish=(status:CheckResult['status'],reasons:string[])=>({...base,status,reasons:[...new Set(reasons)],attempts:base.attempts.map(attempt=>({...attempt,status,evidence_refs:base.evidence_refs}))});
  if(command.status!=='FOUND')return finish(base.status,base.reasons);
  if(!reports.length){const toolFailed=command.fact.result.status==='EXITED'&&base.exit_code!==0;return finish(base.status==='ERROR'||toolFailed?'ERROR':'BLOCKED',[...base.reasons,'MISSING_REPORT',...(toolFailed?['TOOL_FAILURE']:[])]);}
  if(reports.length!==1)return finish('ERROR',['REPORT_INVALID']);const artifact=reports[0]!;
  if(artifact.run_id!==context.run_id||artifact.check_id!==context.check_id||artifact.attempt_id!==context.attempt_id||artifact.artifact_kind!=='report'||artifact.retention?.truncated)return finish('ERROR',['REPORT_SCOPE_MISMATCH']);
  base.evidence_refs=[...base.evidence_refs,artifact.artifact_id];
  const read=await context.evidence.read({run_id:context.run_id,relative_path:artifact.relative_path,expected_digest:artifact.digest,max_bytes:JUNIT_MAX_BYTES});
  if(read.status!=='FOUND'||canonicalJson(read.artifact)!==canonicalJson(artifact))return finish('ERROR',['REPORT_INVALID']);
  const parsed=parseJunit(read.bytes);if(!parsed.ok)return finish('ERROR',[parsed.reason]);
  const safe=/^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
  const ids=parsed.cases.map(test=>test.id??(safe.test(test.name)?test.name:'junit_'+createHash('sha256').update(JSON.stringify([test.classname,test.name])).digest('hex')));
  if(ids.some(id=>!safe.test(id))||new Set(ids).size!==ids.length)return finish('ERROR',['REPORT_DUPLICATE_OR_INVALID_ID']);
  base.discovered_tests=parsed.cases.length;base.executed_tests=parsed.cases.filter(test=>test.status!=='SKIPPED').length;base.skipped_tests=parsed.cases.length-base.executed_tests;base.flaky_tests=parsed.cases.filter(test=>test.flaky).length;base.executed_test_ids=ids.filter((_,i)=>parsed.cases[i]!.status!=='SKIPPED');
  if(base.status==='ERROR'||command.fact.result.status!=='EXITED')return finish(base.status,base.reasons);
  if(parsed.cases.some(test=>test.status==='FAIL'))return finish('FAIL',['TEST_FAILURE']);
  if(base.exit_code!==0)return finish('ERROR',['TOOL_FAILURE','COMMAND_NONZERO_EXIT']);
  const reasons:string[]=[];if(!base.executed_tests)reasons.push('NO_TESTS');if(base.executed_tests<step.min_tests!)reasons.push('MIN_TESTS_NOT_MET');if(step.expected_test_ids.some(id=>!base.executed_test_ids.includes(id)))reasons.push('MISSING_REQUIRED_TEST');if(base.flaky_tests)reasons.push('FLAKY_TESTS');return finish(reasons.length?'BLOCKED':'PASS',reasons);
 }
}
