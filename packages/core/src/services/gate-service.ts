import fs from 'node:fs/promises';
import path from 'node:path';
import type {Artifact,CheckPlan,CheckResult,Diagnostic,PlanContext,RunCompletion,RunEvent,RunManifest,InputManifest,GateEvaluation} from '../../../contracts/src/index.js';
import {validateSchema} from '../../../contracts/src/index.js';
import type {GateEvaluationDocument} from '../../../contracts/src/generated/gate-evaluation.js';
import {FileEvidenceStore} from '../storage/file-evidence-store.js';
import {strictPath} from '../storage/run-layout.js';
import {canonicalJson} from '../storage/canonical-json.js';
import {hashBytes} from '../storage/hash.js';
import {storeEvaluation} from '../storage/evaluations.js';
import {ensureDirectoryWithin} from '../storage/task-revisions.js';
import {loadConfiguration} from './config-service.js';
import {configNames} from './project-service.js';
import {configurationError} from './service-error.js';
import {parseStrictDocument} from './strict-document.js';
import {inspectRepository} from '../../../adapter-git/src/repository.js';
import {PlanService,authenticateStoredPlan} from './plan-service.js';
import {evaluateRunFacts,contextIdentity,knownInputChanged} from './run-evaluation.js';
import {CommandAdapter,readCommandExecution} from '../../../adapter-command/src/command-adapter.js';
import {JunitAdapter} from '../../../adapter-junit/src/junit-adapter.js';
import {inspectToolProvenance} from '../domain/tool-provenance.js';
import {evaluateGate} from '../domain/evaluate-gate.js';
import {validateCommandProvenance} from './command-provenance.js';
import {TrustService} from './trust-service.js';
export interface LoadedRunFacts {manifest:RunManifest|null;plan:CheckPlan|null;context:PlanContext|null;completion:RunCompletion|null;artifacts:Artifact[];checks:CheckResult[];events:RunEvent[];integrity:'VALID'|'MISSING'|'INVALID';diagnostics:Diagnostic[]}
export interface GateInspection extends LoadedRunFacts {evaluation:GateEvaluationDocument;state_root:string}
const diagnostic=(message:string):Diagnostic=>({code:'REPORT_INVALID',message,location:'',source:'gate-service',observed_facts:{},recommended_action:'Preserve the historical run and create a new verified execution.'});
export function validateCheckPlanBinding(plan:CheckPlan,checks:readonly CheckResult[]):Diagnostic[]{
 const errors:Diagnostic[]=[],seen=new Set<string>();
 for(const check of checks){const step=plan.steps.find(s=>s.check_id===check.check_id);if(seen.has(check.check_id)||!step){errors.push(diagnostic('Unknown or duplicated check identity'));continue;}seen.add(check.check_id);
  const kind=step.adapter_id==='command'?'exit-code':step.adapter_id==='junit'?'junit':step.adapter_id==='stackgate-probe'?'probe':step.adapter_id==='playwright'?'playwright':'contract';
  if(check.step_id!==step.step_id||check.required!==step.required||check.result_kind!==kind||canonicalJson([...check.expected_test_ids].sort())!==canonicalJson([...step.expected_test_ids].sort()))errors.push(diagnostic('Check scope, required tests or collector differ from the fixed plan'));
  if(check.status==='PASS'&&step.min_tests!==null&&check.executed_tests<step.min_tests)errors.push(diagnostic('Successful check did not satisfy the confirmed minimum test count'));
  if(['PASS','FAIL'].includes(check.status)&&(!['command','junit'].includes(step.adapter_id)||!check.attempts.length))errors.push(diagnostic('Successful or failed business result has no supported observed attempt'));
 }
 return errors;
}
export class GateService {
 constructor(readonly root:string,readonly options:{trustStoreRoot?:string}={}){}
 async inspect(run_id:string):Promise<GateInspection>{
  if(!/^run_[A-Za-z0-9_-]+$/.test(run_id))throw configurationError('Invalid run identity');
  const names:string[]=[];for(const name of configNames)try{await fs.access(await strictPath(this.root,name));names.push(name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(names.length!==1)throw configurationError('Exactly one configuration is required to locate run evidence');
  const config=await loadConfiguration(path.join(this.root,names[0]!),this.root),state_root=await strictPath(this.root,config.state_dir),owner=await inspectRepository(this.root),store=new FileEvidenceStore({stateRoot:state_root,owner});
  let missingRoot=false;try{await fs.lstat(path.join(state_root,'runs',run_id));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')missingRoot=true;else throw error;}
  const integrity=missingRoot?{status:'MISSING' as const,manifest:null,artifacts:[],seal:null,diagnostics:[{...diagnostic('Run evidence is missing'),code:'MISSING_REPORT' as const}]}:await store.verifyRun(run_id),snapshot=missingRoot?{events:[]}:await store.readRun(run_id);
  const facts:LoadedRunFacts={manifest:integrity.manifest,plan:null,context:null,completion:null,artifacts:integrity.artifacts,checks:integrity.manifest?.checks??[],events:snapshot.events,integrity:integrity.status,diagnostics:[...integrity.diagnostics]};
  const policy_hash=facts.manifest?.policy_hash??hashBytes(Buffer.from(canonicalJson(config)));
  const finish=(evaluation:GateEvaluation):GateInspection=>({...facts,state_root,evaluation:{...evaluation,run_id,policy_hash,evaluated_at:new Date().toISOString()}});
  const unavailable=(invalid:boolean)=>finish(evaluateGate({checks:[],required_check_ids:[],configuration_valid:true,report_integrity:invalid?'INVALID':'UNVERIFIED',freshness:'UNVERIFIED',inputs_complete:false,task_confirmed:false,policy_confirmed:false,environment_satisfied:false,acceptance_inputs_approved:false,canceled:facts.manifest?.canceled??false,fatal_error:facts.manifest?.phase==='ABORTED',deterministic_denials:[]}));
  if(integrity.status==='INVALID')return unavailable(true);
  if(!facts.manifest)return unavailable(false);
  const readDocument=async<T>(kind:string):Promise<T|null>=>{
   const found=facts.artifacts.filter(a=>a.relative_path===`documents/${kind}.json`&&a.check_id===null&&a.attempt_id===null);if(!found.length)return null;if(found.length!==1)throw Error('Ambiguous root evidence document');
   const artifact=found[0]!,read=await store.read({run_id,relative_path:artifact.relative_path,expected_digest:artifact.digest,max_bytes:16*1024*1024});
   if(read.status!=='FOUND')throw Error('Root evidence document bytes cannot be authenticated');
   const result=validateSchema<T>(kind,parseStrictDocument(read.bytes,kind,{maxBytes:16*1024*1024}));if(!result.ok)throw Error('Root evidence document schema is invalid');return result.value;
  };
  try{
   facts.plan=await readDocument<CheckPlan>('plan');facts.context=await readDocument<PlanContext>('plan-context');facts.completion=await readDocument<RunCompletion>('run-completion');const inputs=await readDocument<InputManifest>('input-manifest');
   if(!facts.plan||!facts.context||!facts.completion||!inputs){if(integrity.status==='VALID')throw Error('Sealed run is missing required authentication documents');return unavailable(false);}
   const {plan,context,completion,manifest}=facts;authenticateStoredPlan({plan,context});
   const match=[manifest.plan_id===plan.plan_id,manifest.plan_hash===plan.plan_hash,manifest.input_hash===plan.input_hash,manifest.policy_hash===plan.policy_hash,manifest.task_id===plan.task_id,manifest.task_revision===plan.task_revision,manifest.base_oid===context.input_manifest.base_oid,manifest.git_object_format===context.input_manifest.git_object_format,manifest.repo_id===context.input_manifest.repo_id,manifest.worktree_id===context.input_manifest.worktree_id,canonicalJson(manifest.target_contract_hashes)===canonicalJson(plan.target_contract_hashes),canonicalJson(manifest.tool_versions)===canonicalJson(context.tool_versions),canonicalJson(inputs)===canonicalJson(context.input_manifest),completion.run_id===run_id,completion.plan_id===plan.plan_id,completion.pre_context_hash===contextIdentity(context)];
   if(match.some(value=>!value))throw Error('Run identity differs from its sealed plan, context or completion');
   if(completion.post_freshness==='FRESH'&&(completion.post_context_hash!==contextIdentity(context)||completion.post_input_hash!==plan.input_hash))throw Error('Completion freshness contradicts its observed identities');
   const bindings=validateCheckPlanBinding(plan,facts.checks);if(bindings.length){facts.diagnostics.push(...bindings);throw Error('Check evidence differs from fixed plan requirements');}
   const current=await new PlanService(this.root,this.options).inspectStored({plan,context});
   const capture=current.freshness==='FRESH'?await new TrustService(this.root,this.options.trustStoreRoot?{storeRoot:this.options.trustStoreRoot}:{}).capture():null;
   const matchingPreview=capture?.execution_digest===context.execution_digest?capture.execution_preview:null;
   for(const check of facts.checks){
    const step=plan.steps.find(s=>s.check_id===check.check_id)!;if(!['command','junit'].includes(step.adapter_id)||!check.attempts.length)continue;
    const collection={run_id,check_id:check.check_id,attempt_id:check.attempt_id,expected_artifacts:step.expected_artifacts,evidence:store,signal:new AbortController().signal,artifacts:facts.artifacts.filter(a=>a.check_id===check.check_id&&a.attempt_id===check.attempt_id)};
    const observed=await readCommandExecution(step,collection);if(observed.status!=='FOUND')throw Error('Observed command evidence is missing or invalid');
    const executable_digest=matchingPreview?.tools[step.command_id!]?.invocation?.identity.digest;
    const provenanceErrors=validateCommandProvenance(observed.fact.result,{command_id:step.command_id!,authorization_hash:context.execution_digest,platform_id:context.input_manifest.platform_id,...(executable_digest?{executable_digest}:{})});
    if(provenanceErrors.length){facts.diagnostics.push(...provenanceErrors);throw Error('Observed execution provenance cannot be authenticated');}
    const adapter=step.adapter_id==='command'?new CommandAdapter(context.config.commands):new JunitAdapter(context.config.commands),recollected=await adapter.collect(step,collection);
    if(canonicalJson(recollected)!==canonicalJson(check))throw Error('Stored check claims differ from independently recollected evidence');
   }
   let freshness=capture&&!matchingPreview?'STALE' as const:current.freshness;
   if(freshness==='UNVERIFIED'&&await knownInputChanged(this.root,context))freshness='STALE';
   if(completion.post_freshness==='STALE'||completion.post_input_hash!==null&&completion.post_input_hash!==plan.input_hash)freshness='STALE';else if(completion.post_freshness==='UNVERIFIED'&&freshness!=='STALE')freshness='UNVERIFIED';
   facts.diagnostics.push(...current.diagnostics);
   const provenance=inspectToolProvenance(context.tool_versions,plan.steps.flatMap(step=>step.command_id?[step.command_id]:[]));facts.diagnostics.push(...provenance.diagnostics);
   const policyContext={...context,blockers:[...context.blockers,...provenance.diagnostics.map(item=>({code:item.code,message:item.message,check_id:null}))]};
   const evaluation=evaluateRunFacts(policyContext,facts.checks,{post_task_confirmed:completion.post_task_confirmed&&current.task_confirmed,post_trust_valid:completion.post_trust_valid&&current.trust_valid,canceled:manifest.canceled||manifest.phase==='CANCELED'||completion.canceled,fatal_error:manifest.phase==='ABORTED'||completion.fatal_error},integrity.status==='VALID'?'VALID':'UNVERIFIED',freshness);
   const final=await store.verifyRun(run_id);if(final.status==='INVALID'||final.status==='VALID'&&integrity.status==='VALID'&&canonicalJson(final.seal)!==canonicalJson(integrity.seal))throw Error('Sealed run changed during Gate authentication');
   if(final.status!=='VALID'&&integrity.status==='VALID'){facts.integrity=final.status;return unavailable(false);}
   return finish(evaluation);
  }catch(error){facts.integrity='INVALID';facts.diagnostics.push(diagnostic(error instanceof Error?error.message:'Run evidence could not be authenticated'));return unavailable(true);}
 }
 async evaluate(run_id:string):Promise<GateInspection&{evaluation_path:string}>{const observed=await this.inspect(run_id);await ensureDirectoryWithin(this.root,path.relative(this.root,observed.state_root).replaceAll(path.sep,'/'));return {...observed,evaluation_path:await storeEvaluation(observed.state_root,observed.evaluation)};}
}
