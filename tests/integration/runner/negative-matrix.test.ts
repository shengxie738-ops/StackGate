import {afterAll,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CommandAdapter} from '../../../packages/adapter-command/src/command-adapter.js';
import {JunitAdapter} from '../../../packages/adapter-junit/src/junit-adapter.js';
import {evaluateGate} from '../../../packages/core/src/domain/evaluate-gate.js';
import {GateService} from '../../../packages/core/src/services/gate-service.js';
import {RunService} from '../../../packages/core/src/services/run-service.js';
import {buildReportView} from '../../../packages/reporters/src/report-view.js';
import {renderJson} from '../../../packages/reporters/src/json.js';
import {commandExecution,commandStep} from '../../support/command-execution.js';
import {localRunProject} from '../../support/local-run-project.js';
import {withTestDirectory} from '../../support/test-paths.js';
import type {ProjectConfig,CheckPlan,CheckResult,CheckStep,GateEvaluation,RunEvent,RunManifest} from '../../../packages/contracts/src/index.js';
vi.setConfig({testTimeout:240000,hookTimeout:240000});
type Expectation={status:CheckResult['status'];verdict:GateEvaluation['verdict'];freshness:GateEvaluation['freshness'];decision:GateEvaluation['decision'];exit:0|1|2|3|4;reason:string|null};
type Case={id:string;layer:'process'|'current';expected:Expectation;junit?:boolean;code?:string;fixture?:string;timeout?:number;cancel?:'before'|'during';spawn?:boolean;overflow?:boolean;backend?:boolean;duplicate?:boolean;report?:boolean};
const pass:Expectation={status:'PASS',verdict:'PASS',freshness:'FRESH',decision:'ALLOW',exit:0,reason:null};
const fail:Expectation={status:'FAIL',verdict:'FAIL',freshness:'FRESH',decision:'DENY',exit:1,reason:'CHECK_FAILED:build'};
const incomplete=(reason:string):Expectation=>({status:'BLOCKED',verdict:'INCOMPLETE',freshness:'FRESH',decision:'DENY',exit:2,reason});
const error=(reason:string):Expectation=>({status:'ERROR',verdict:'ERROR',freshness:'FRESH',decision:'DENY',exit:3,reason});
const stale:Expectation={status:'PASS',verdict:'INCOMPLETE',freshness:'STALE',decision:'DENY',exit:4,reason:'INPUT_STALE'};
const xml=(body:string,exit=0)=>`require('fs').writeFileSync(require('path').join(process.env.STACKGATE_OUTPUT_DIR,'junit.xml'),${JSON.stringify(body)});process.exitCode=${exit};`;
/** Exactly the twenty v0.2 cases; additional original-card counterexamples follow below. */
export const negativeMatrix:Case[]=[
 {id:'command 0',layer:'process',code:"require('node:assert/strict').equal(2+3,5)",expected:pass},
 {id:'command nonzero',layer:'process',code:"require('node:assert/strict').equal(2+4,5)",expected:fail},
 {id:'spawn failure',layer:'process',spawn:true,expected:error('CHECK_ERROR:build')},
 {id:'timeout',layer:'process',code:'setInterval(()=>{},1000)',timeout:150,expected:incomplete('build:COMMAND_TIMED_OUT')},
 {id:'cancel',layer:'process',code:'setInterval(()=>console.log("ready"),20)',cancel:'during',expected:incomplete('CANCELED')},
 {id:'output overflow',layer:'process',code:'for(let i=0;i<10000;i++)console.log("actual output line");setInterval(()=>{},1000)',overflow:true,expected:error('build:ARTIFACT_BUDGET_EXCEEDED')},
 {id:'missing junit',layer:'process',junit:true,fixture:'missing-report',expected:incomplete('build:MISSING_REPORT')},
 {id:'malformed junit',layer:'process',junit:true,fixture:'broken-report',expected:error('CHECK_ERROR:build')},
 {id:'zero junit',layer:'process',junit:true,fixture:'no-tests',expected:incomplete('NO_TESTS:build')},
 {id:'skipped required',layer:'process',junit:true,code:xml('<testsuite><testcase name="required-case"><skipped/></testcase></testsuite>'),expected:incomplete('REQUIRED_TEST_SKIPPED:build')},
 {id:'evidence corrupt',layer:'current',expected:{...pass,verdict:'ERROR',freshness:'UNVERIFIED',decision:'DENY',exit:3,reason:'REPORT_INVALID'}},
 {id:'seal missing',layer:'current',expected:{...pass,verdict:'INCOMPLETE',decision:'DENY',exit:2,reason:'REPORT_UNVERIFIED'}},
 {id:'duplicate event',layer:'process',code:'console.log("one observed process")',duplicate:true,expected:pass},
 {id:'stale input',layer:'current',expected:stale},
 {id:'task revision changed',layer:'current',expected:stale},
 {id:'policy changed',layer:'current',expected:stale},
 {id:'tool binary changed',layer:'current',expected:stale},
 {id:'missing environment provenance',layer:'process',code:'console.log("local process only")',backend:true,expected:{...pass,verdict:'INCOMPLETE',decision:'DENY',exit:2,reason:'ENV_PROVENANCE_INSUFFICIENT'}},
 {id:'user canceled',layer:'process',code:'throw Error("must never execute")',cancel:'before',expected:incomplete('CANCELED')},
 {id:'report reads failed run',layer:'process',code:"require('node:assert/strict').equal(7,8)",report:true,expected:fail},
];
function assertOutcome(check:CheckResult|undefined,evaluation:GateEvaluation,expected:Expectation){
 expect(check?.status).toBe(expected.status);expect(evaluation).toMatchObject({verdict:expected.verdict,freshness:expected.freshness,decision:expected.decision,exit_code:expected.exit});if(expected.reason===null)expect(evaluation.reasons).toEqual([]);else expect(evaluation.reasons).toContain(expected.reason);
}
async function processCase(root:string,row:Case){
 const controller=new AbortController();if(row.cancel==='before')controller.abort();let outputObserved=false;
 const code=row.fixture?`import(${JSON.stringify(pathToFileURL(path.resolve('tests/support/process-fixtures/'+row.fixture+'.mjs')).href)});`:row.code??'console.log("startup")';
 const harness=await commandExecution(root,code,{signal:controller.signal,...(row.timeout?{timeout:row.timeout}:{}),...(row.spawn?{invalidExecutable:true}:{}),...(row.overflow?{maxOutputBytes:1024}:{}),onOutput(){outputObserved=true;if(row.cancel==='during')controller.abort();}});
 const step:CheckStep=row.junit?{...commandStep,adapter_id:'junit',expected_artifacts:['junit.xml'],expected_test_ids:['required-case'],min_tests:1,parameters:{adapter_id:'junit',report_name:'junit.xml'}}:commandStep;
 const adapter=row.junit?new JunitAdapter():new CommandAdapter();let seq=0;const run_id=harness.context.run_id;
 const append=async(type:string,payload:unknown)=>{const event={schema_version:'0.1',run_id,event_id:'event_matrix_'+(++seq),seq,at:new Date().toISOString(),type,payload} as RunEvent;expect(await harness.store.append(event)).toMatchObject({status:'APPENDED'});return event;};
 let manifest=(await harness.store.readRun(run_id)).manifest!;
 const started=await append('run.started',{payload_version:'0.1',plan_id:manifest.plan_id,input_hash:manifest.input_hash});if(row.duplicate)expect(await harness.store.append(started)).toMatchObject({status:'DUPLICATE'});
 await append('check.started',{payload_version:'0.1',step_id:step.step_id,check_id:step.check_id,attempt_id:harness.context.attempt_id});
 for await(const event of adapter.execute(step,harness.context))await append(event.type,event.payload);
 const result=await adapter.collect(step,{...harness.collection,artifacts:harness.artifacts});await append('check.finished',{payload_version:'0.1',check_result:result});
 if(row.cancel)await append('run.canceled',{payload_version:'0.1',reason:'Actual abort signal observed'});
 if(row.cancel==='during')expect(outputObserved).toBe(true);if(row.cancel==='before')expect(harness.output.stdout).toBe('');
 const verdict:RunManifest['verdict']=result.status==='ERROR'?'ERROR':row.cancel?'INCOMPLETE':result.status==='FAIL'?'FAIL':result.status==='PASS'&&!row.backend?'PASS':'INCOMPLETE';
 for(const phase of ['PLANNED','RUNNING','FINALIZING',row.cancel?'CANCELED':'COMPLETED'] as const){const previous=await harness.store.readRun(run_id);manifest={...manifest,phase,started_at:started.at,finished_at:new Date().toISOString(),checks:[result],artifact_refs:harness.artifacts.map(a=>a.artifact_id),canceled:!!row.cancel,verdict};await harness.store.updateManifest(manifest,previous.manifest_hash!);}
 await append('run.finalized',{payload_version:'0.1',phase:manifest.phase,verdict});expect((await harness.store.seal({run_id,input_hash:manifest.input_hash,required_artifact_ids:manifest.artifact_refs})).status).toBe('SEALED');
 const integrity=await harness.store.verifyRun(run_id);expect(integrity.status).toBe('VALID');
 const evaluation=evaluateGate({checks:[result],required_check_ids:[step.check_id],configuration_valid:true,report_integrity:integrity.status==='VALID'?'VALID':'INVALID',freshness:'FRESH',inputs_complete:true,task_confirmed:true,policy_confirmed:true,environment_satisfied:!row.backend,acceptance_inputs_approved:true,canceled:!!row.cancel,fatal_error:false,deterministic_denials:[]});
 assertOutcome(result,evaluation,row.expected);
 if(row.duplicate)expect((await harness.store.readRun(run_id)).events.filter(e=>e.type==='run.started')).toHaveLength(1);
 if(row.report){const snapshot=await harness.store.readRun(run_id),plan=JSON.parse(await fs.readFile('tests/fixtures/protocols/plan.json','utf8')) as CheckPlan;plan.required_check_ids=[step.check_id];plan.steps=[step];const report=JSON.parse(renderJson(buildReportView({manifest:snapshot.manifest!,plan,artifacts:snapshot.artifacts},evaluation)));expect(report).toMatchObject({verdict:'FAIL',decision:'DENY',exit_code:1});expect(report.failures[0].check_id).toBe('build');expect((await harness.store.verifyRun(run_id)).status).toBe('VALID');}
 return {result,evaluation};
}
type State=Awaited<ReturnType<typeof makeCurrentFixture>>;let shared:Promise<State>|undefined;
async function makeCurrentFixture(){const repo=await localRunProject('pass',{confirmed:false});try{
 const executable=path.join(repo.store,process.platform==='win32'?'matrix-node.exe':'matrix-node');await fs.copyFile(process.execPath,executable);if(process.platform!=='win32')await fs.chmod(executable,0o700);for(const command of Object.values(repo.config.commands as ProjectConfig['commands']))command.exec=executable;await fs.writeFile(path.join(repo.root,'.stackgate.yaml'),JSON.stringify(repo.config));
 const task=await repo.taskService.validate(repo.taskFile);expect(task.valid).toBe(true);await repo.taskService.confirm(repo.taskFile,task.confirmation_digest!,{authorized:true,source:'local-review'});const trust=await repo.trust.review();await repo.trust.confirm(trust.execution_digest,{authorized:true});
 const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.evaluation).toMatchObject({decision:'ALLOW',exit_code:0});expect(run.sealed).toBe(true);return {repo,executable,run,gate:new GateService(repo.root,{trustStoreRoot:repo.store}),runRoot:path.join(repo.root,repo.config.state_dir,'runs',run.run_id!)};
 }catch(error){await repo.cleanup();throw error;}}
afterAll(async()=>{if(shared){const f=await shared;await f.repo.cleanup();}});
async function currentCase(row:Case){const f=await(shared??=makeCurrentFixture()),run_id=f.run.run_id!;let file:string;
 if(row.id==='evidence corrupt'){const gate=await f.gate.inspect(run_id);file=path.join(f.runRoot,gate.artifacts.find(a=>a.relative_path.endsWith('/stdout.log'))!.relative_path);}
 else if(row.id==='seal missing')file=path.join(f.runRoot,'seal.json');else if(row.id==='stale input')file=f.repo.input;else if(row.id==='task revision changed')file=f.repo.taskFile;else if(row.id==='policy changed')file=path.join(f.repo.root,'.stackgate.yaml');else file=f.executable;
 const bytes=await fs.readFile(file);try{
  if(row.id==='seal missing')await fs.unlink(file);else if(row.id==='task revision changed'){const task=JSON.parse(bytes.toString());task.revision++;await fs.writeFile(file,JSON.stringify(task));}
  else if(row.id==='policy changed'){const config=JSON.parse(bytes.toString());config.profiles.local.workspace_regression.web=['smoke','unit'];await fs.writeFile(file,JSON.stringify(config));}
  else if(row.id==='stale input')await fs.writeFile(file,'{"numbers":[2,3],"expected":6}');else await fs.writeFile(file,'modified bytes, never executed');
  const observed=await f.gate.inspect(run_id);assertOutcome(observed.checks.find(c=>c.check_id==='unit'),observed.evaluation,row.expected);
 }finally{await fs.writeFile(file,bytes);}
}
it('registers exactly the twenty required v0.2 scenarios without duplicates',()=>{expect(negativeMatrix).toHaveLength(20);expect(new Set(negativeMatrix.map(row=>row.id)).size).toBe(20);});
for(const row of negativeMatrix)it(row.id,()=>row.layer==='current'?currentCase(row):withTestDirectory(root=>processCase(root,row)));
for(const row of [
 {id:'report FAIL with process zero',junit:true,code:xml('<testsuite><testcase name="required-case"><failure>actual observed failure</failure></testcase></testsuite>'),expected:fail},
 {id:'process nonzero with PASS report',junit:true,fixture:'contradictory-exit',expected:error('build:TOOL_FAILURE')},
 {id:'missing required ID despite one executed case',junit:true,code:xml('<testsuite><testcase name="another-case"/></testsuite>'),expected:incomplete('REQUIRED_TEST_MISSING:build')},
 {id:'nonzero without trusted report',junit:true,code:'process.exitCode=7',expected:error('build:TOOL_FAILURE')},
 {id:'flaky retry report does not satisfy required check',junit:true,code:xml('<testsuite><testcase name="required-case"><flakyFailure/></testcase></testsuite>'),expected:incomplete('FLAKY_REQUIRED_TEST:build')},
] satisfies Omit<Case,'layer'>[])it(row.id,()=>withTestDirectory(root=>processCase(root,{...row,layer:'process'})));
it('baseline failure provenance never exempts the current failing required check',async()=>{for(const provenance of ['baseline','candidate'])await withTestDirectory(async root=>{const facts=await processCase(root,{id:provenance,layer:'process',code:"require('node:assert/strict').equal(1,2)",expected:fail});expect(facts.result.evidence_refs.length).toBeGreaterThan(0);expect(facts.evaluation.decision).toBe('DENY');});});
