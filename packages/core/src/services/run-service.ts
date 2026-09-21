import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Artifact,CheckResult,CheckStep,Diagnostic,GateEvaluation,RunManifest,RunEvent,RunCompletion} from '../../../contracts/src/index.js';
import {validateSchema} from '../../../contracts/src/index.js';
import {PlanService} from './plan-service.js';
import {CommandResolver} from './command-resolver.js';
import {FileEvidenceStore} from '../storage/file-evidence-store.js';
import {ensureDirectoryWithin} from '../storage/task-revisions.js';
import {strictPath} from '../storage/run-layout.js';
import {canonicalJson} from '../storage/canonical-json.js';
import {BudgetedArtifactWriter,EvidenceBudget} from '../evidence/budget.js';
import type {EvidenceDocument,EvidenceScope} from '../ports/evidence.js';
import type {Adapter,ExecutionContext} from '../ports/adapter.js';
import {LocalRunner} from '../../../runner-local/src/local-runner.js';
import {createRunWorkspace,verifyRunWorkspace} from '../../../runner-local/src/workspace.js';
import {CommandAdapter,emptyCheck} from '../../../adapter-command/src/command-adapter.js';
import {JunitAdapter} from '../../../adapter-junit/src/junit-adapter.js';
import {schedulePlan} from '../execution/scheduler.js';
import {contextIdentity,evaluateRunFacts,knownInputChanged} from './run-evaluation.js';
export interface RunExecutionOutcome {run_id:string|null;manifest:RunManifest|null;evaluation:GateEvaluation;sealed:boolean;diagnostics:Diagnostic[]}
export interface RunServiceOptions {trustStoreRoot?:string;lockRoot?:string;onEvent?:(event:RunEvent)=>void|Promise<void>}
const failure=(message:string):Diagnostic=>({code:'TOOL_FAILURE',rule_id:'SG-RUNTIME-RUN_LIFECYCLE',message,source:'run-service',location:'',observed_facts:{},recommended_action:'Preserve this run and inspect its recorded evidence before a new execution.'});
const now=()=>new Date().toISOString();
export class RunService {
 readonly root:string;
 constructor(root:string,readonly options:RunServiceOptions={}){this.root=path.resolve(root);}
 async execute(plan_id:string,options:{signal?:AbortSignal;concurrency?:number;previous_run_id?:string}={}):Promise<RunExecutionOutcome>{
  const plans=new PlanService(this.root,this.options),inspection=await plans.inspectCurrent(plan_id),{plan,context}=inspection.stored;
  if(!inspection.identity_valid){
   const freshness=inspection.freshness==='UNVERIFIED'&&await knownInputChanged(this.root,context)?'STALE':inspection.freshness;
   return {run_id:null,manifest:null,sealed:false,diagnostics:inspection.diagnostics,evaluation:evaluateRunFacts(context,[],{post_task_confirmed:inspection.task_confirmed,post_trust_valid:inspection.trust_valid,canceled:options.signal?.aborted??false,fatal_error:false},'UNVERIFIED',freshness)};
  }
  const run_id='run_'+randomUUID(),owner_token=randomUUID(),created_at=now(),stateRoot=await strictPath(this.root,context.config.state_dir);
  const store=new FileEvidenceStore({stateRoot,owner:context.input_manifest}),budget=new EvidenceBudget(),runner=new LocalRunner(),resolver=new CommandResolver(this.root,this.options);
  if(options.previous_run_id){const previous=await store.readRun(options.previous_run_id);if(!previous.manifest||previous.manifest.repo_id!==context.input_manifest.repo_id||previous.manifest.worktree_id!==context.input_manifest.worktree_id)throw Error('Previous run must be a readable owned historical run');}
  const callerSignal=options.signal??new AbortController().signal,internal=new AbortController(),signal=AbortSignal.any([callerSignal,internal.signal]);
  const diagnostics:Diagnostic[]=[],artifacts=new Map<string,Artifact>(),checks=new Map<string,CheckResult>(),started=new Set<string>(),finished=new Set<string>(),attempts=new Map(plan.steps.map(step=>[step.step_id,'attempt_'+randomUUID()]));
  let sequence=0,events=Promise.resolve(),fatal=false,sealed=false;
  let manifest:RunManifest={schema_version:'0.1',run_id,plan_id,phase:'CREATED',verdict:'INCOMPLETE',created_at,started_at:null,finished_at:null,task_id:context.task.task_id,task_revision:context.task.revision,repo_id:context.input_manifest.repo_id,worktree_id:context.input_manifest.worktree_id,base_oid:context.input_manifest.base_oid,git_object_format:context.input_manifest.git_object_format,input_hash:plan.input_hash,plan_hash:plan.plan_hash,policy_hash:plan.policy_hash,target_contract_hashes:plan.target_contract_hashes,tool_versions:context.tool_versions,environment_ref:null,data_revision:'local-input-'+plan.input_hash,checks:[],artifact_refs:[],coverage_gaps:context.analysis_gaps.map(gap=>`${gap.workspace}:${gap.reference}:${gap.reason}`),canceled:false};
  if(options.previous_run_id)manifest.previous_run_id=options.previous_run_id;
  const append=(body:Pick<RunEvent,'type'|'payload'>)=>{
   const event={schema_version:'0.1',event_id:'event_'+randomUUID(),run_id,seq:++sequence,at:now(),...body} as RunEvent;
   const next=events.then(async()=>{const result=await store.append(event);if(result.status==='ERROR')throw Error('Run event persistence failed');await this.options.onEvent?.(event);});events=next;return next;
  };
  const saveArtifact=async(artifact:Artifact)=>{const old=artifacts.get(artifact.artifact_id);if(old){if(canonicalJson(old)!==canonicalJson(artifact))throw Error('Conflicting artifact identity');return;}artifacts.set(artifact.artifact_id,artifact);await append({type:'artifact.saved',payload:{payload_version:'0.1',artifact}});};
  const document=async(scope:EvidenceScope,value:EvidenceDocument)=>{budget.retain(Buffer.from(canonicalJson(value.value)+'\n'),true);const artifact=await store.store(scope,{kind:'document',value});await saveArtifact(artifact);return artifact;};
  const transition=async(phase:RunManifest['phase'],patch:Partial<RunManifest>={})=>{const snapshot=await store.readRun(run_id),from=manifest.phase;manifest={...manifest,...patch,phase};await store.updateManifest(manifest,snapshot.manifest_hash!);await append({type:'run.phase_changed',payload:{payload_version:'0.1',from,to:phase}});};
  const scopeFor=(step:CheckStep):EvidenceScope=>({run_id,check_id:step.check_id,attempt_id:attempts.get(step.step_id)!});
  const start=async(step:CheckStep)=>{if(started.has(step.step_id))return;started.add(step.step_id);await append({type:'check.started',payload:{payload_version:'0.1',step_id:step.step_id,check_id:step.check_id,attempt_id:attempts.get(step.step_id)!}});};
  const persist=async(step:CheckStep,result:CheckResult)=>{if(finished.has(step.step_id))throw Error('Check attempt was already finalized');if(!validateSchema('check-result',result).ok)throw Error('Collected check result is invalid');await start(step);await document(scopeFor(step),{kind:'check-result',value:result});await append({type:'check.finished',payload:{payload_version:'0.1',check_result:result}});checks.set(step.check_id,result);finished.add(step.step_id);};
  const blocked=async(step:CheckStep,reasons:string[],status:CheckResult['status']='BLOCKED')=>{
   const scope=scopeFor(step),result=emptyCheck(step,{run_id,check_id:step.check_id,attempt_id:scope.attempt_id!},status,step.adapter_id==='command'?'exit-code':step.adapter_id==='junit'?'junit':step.adapter_id==='stackgate-probe'?'probe':step.adapter_id==='playwright'?'playwright':'contract',reasons);
   await persist(step,result);return result;
  };
  const rootScope:EvidenceScope={run_id,check_id:null,attempt_id:null};
  let completion:RunCompletion={schema_version:'0.1',run_id,plan_id,recorded_at:created_at,pre_context_hash:contextIdentity(context),post_context_hash:null,post_input_hash:null,post_freshness:'UNVERIFIED',post_task_confirmed:false,post_trust_valid:false,canceled:false,fatal_error:false,diagnostics:[],scheduler_timings:{}};
  try{
   await store.createRun(manifest);
   await append({type:'run.started',payload:{payload_version:'0.1',plan_id,input_hash:plan.input_hash}});
   await append({type:'run.phase_changed',payload:{payload_version:'0.1',from:null,to:'CREATED'}});
   await document(rootScope,{kind:'plan',value:plan});await document(rootScope,{kind:'plan-context',value:context});await document(rootScope,{kind:'input-manifest',value:context.input_manifest});
   await createRunWorkspace(stateRoot,{schema_version:'0.1',run_id,repo_id:manifest.repo_id,worktree_id:manifest.worktree_id,owner_token,created_at});
   await transition('PLANNED');await transition('RUNNING',{started_at:now()});
   const scheduled=await schedulePlan(plan,{run_id,repo_root:this.root,worktree_id:manifest.worktree_id,platform_id:context.input_manifest.platform_id,owner_token,signal,...(options.concurrency?{concurrency:options.concurrency}:{}),...(this.options.lockRoot?{lockRoot:this.options.lockRoot}:{}),
    onTransition:async event=>{if(event.type==='started')await start(plan.steps.find(step=>step.step_id===event.step_id)!);},
    execute:async step=>{
     const blockers=context.blockers.filter(item=>item.check_id===step.check_id);if(blockers.length||!['command','junit'].includes(step.adapter_id))return blocked(step,blockers.length?blockers.map(item=>item.code):['UNSUPPORTED_CAPABILITY']);
     const scope=scopeFor(step),output=await ensureDirectoryWithin(stateRoot,`work/${run_id}/${step.check_id}/${scope.attempt_id}`),writer=new BudgetedArtifactWriter(store,scope,budget);
     const adapter:Adapter=step.adapter_id==='command'?new CommandAdapter(context.config.commands):new JunitAdapter(context.config.commands);
     const execution:ExecutionContext={run_id,check_id:step.check_id,attempt_id:scope.attempt_id!,allowed_paths:[output],allowed_origins:[],environment:{STACKGATE_OUTPUT_DIR:output},signal,clock:{now},ids:{create:kind=>`${kind}_${randomUUID()}`},
      log:{async append(){throw Error('Unscoped adapter logging is unavailable; use the reviewed runner streams');}},
      artifacts:{store:async value=>{const artifact=await writer.store(value);await saveArtifact(artifact);return artifact;}},
      commands:{run:async command_id=>{
       if(command_id!==step.command_id)throw Error('Adapter requested a different command');
       const command=await resolver.resolve(command_id,{execution_digest:context.execution_digest,run_id,check_id:step.check_id,attempt_id:scope.attempt_id!,output_dir:output,allowed_origins:[],owner_token});
       if(signal.aborted)return {status:'CANCELED',raw_exit_code:null,signal:null,process:null,artifacts:[],diagnostics:[]};
       const streams:{stdout:Buffer[];stderr:Buffer[]}={stdout:[],stderr:[]};
       const result=await runner.run(command,{run_id,check_id:step.check_id,attempt_id:scope.attempt_id!,signal,async stdout(bytes){streams.stdout.push(Buffer.from(bytes));},async stderr(bytes){streams.stderr.push(Buffer.from(bytes));}});
       const logs:Artifact[]=[];
       for(const stream of ['stdout','stderr'] as const){const bytes=Buffer.concat(streams[stream]),retention=result.output?.streams?.[stream];const artifact=await writer.store({name:stream+'.log',bytes,media_type:'text/plain',artifact_kind:'log',sensitivity:'regular',redaction_state:'REDACTED',...(retention?{retention:{...retention,critical:false}}:{})});logs.push(artifact);await saveArtifact(artifact);}
       return {...result,artifacts:logs};
      }},
     };
     try{
      for await(const event of adapter.execute(step,execution)){if(event.type!=='artifact.saved'||canonicalJson(artifacts.get(event.payload.artifact.artifact_id))!==canonicalJson(event.payload.artifact))throw Error('Adapter emitted an unowned execution fact');}
      await verifyRunWorkspace(stateRoot,{run_id,repo_id:manifest.repo_id,worktree_id:manifest.worktree_id,owner_token});
      const result=await adapter.collect(step,{run_id,check_id:step.check_id,attempt_id:scope.attempt_id!,expected_artifacts:step.expected_artifacts,artifacts:[...artifacts.values()].filter(a=>a.check_id===step.check_id&&a.attempt_id===scope.attempt_id),evidence:store,signal});
      await persist(step,result);return result;
     }catch{fatal=true;internal.abort();diagnostics.push(failure('Adapter execution or evidence collection failed'));if(finished.has(step.step_id))throw Error('Evidence failed after check completion');return blocked(step,['TOOL_FAILURE'],'ERROR');}
    },
   });
   diagnostics.push(...scheduled.diagnostics);if(scheduled.diagnostics.length)fatal=true;
   for(const item of scheduled.blocked)if(!checks.has(item.step.check_id))await blocked(item.step,[item.code],item.code==='TOOL_FAILURE'?'ERROR':'BLOCKED');
   await transition('FINALIZING');
   const post=await plans.inspectCurrent(plan_id);const postFreshness=post.freshness==='UNVERIFIED'&&await knownInputChanged(this.root,context)?'STALE':post.freshness;
   completion={...completion,recorded_at:now(),post_context_hash:post.current?contextIdentity(post.current):null,post_input_hash:post.current?.input_manifest.input_hash??null,post_freshness:postFreshness,post_task_confirmed:post.task_confirmed,post_trust_valid:post.trust_valid,canceled:callerSignal.aborted,fatal_error:fatal,diagnostics:[...diagnostics],scheduler_timings:scheduled.timings};
   await document(rootScope,{kind:'run-completion',value:completion});
   const results=plan.steps.map(step=>checks.get(step.check_id)!).filter(Boolean),prepared=evaluateRunFacts(context,results,{...completion,canceled:callerSignal.aborted},'VALID',completion.post_freshness);
   if(fatal)await append({type:'run.aborted',payload:{payload_version:'0.1',reason:'Execution or evidence failed'}});else if(callerSignal.aborted)await append({type:'run.canceled',payload:{payload_version:'0.1',reason:'Caller canceled execution'}});
   await transition(fatal?'ABORTED':callerSignal.aborted?'CANCELED':'COMPLETED',{verdict:prepared.verdict,finished_at:now(),checks:results,artifact_refs:[...artifacts.keys()].sort(),canceled:callerSignal.aborted});
   await append({type:'run.finalized',payload:{payload_version:'0.1',phase:manifest.phase as 'COMPLETED'|'CANCELED'|'ABORTED',verdict:manifest.verdict}});
   const seal=await store.seal({run_id,input_hash:plan.input_hash,required_artifact_ids:[...artifacts.keys()]});sealed=seal.status==='SEALED';diagnostics.push(...seal.diagnostics);
   // Final event consumers and seal I/O are observable boundaries: the returned
   // current decision must not reuse an earlier freshness/cancellation snapshot.
   const current=await plans.inspectCurrent(plan_id),currentFreshness=current.freshness==='UNVERIFIED'&&await knownInputChanged(this.root,context)?'STALE':current.freshness;
   return {run_id,manifest,sealed,diagnostics,evaluation:evaluateRunFacts(context,results,{...completion,post_task_confirmed:current.task_confirmed,post_trust_valid:current.trust_valid,canceled:callerSignal.aborted,fatal_error:fatal||seal.status==='ERROR'},sealed?'VALID':seal.status==='ERROR'?'INVALID':'UNVERIFIED',completion.post_freshness==='STALE'?'STALE':currentFreshness)};
  }catch{
   internal.abort();fatal=true;diagnostics.push(failure('Run finalization did not complete; existing facts were preserved'));
   // A failed event stream or incomplete atomic write is never repaired by deleting its history.
   try{const current=await store.readRun(run_id);if(current.manifest&&current.manifest_hash&&!['COMPLETED','CANCELED','ABORTED'].includes(current.manifest.phase)){manifest={...current.manifest,phase:'ABORTED',verdict:'ERROR',finished_at:now(),checks:[...checks.values()],artifact_refs:[...artifacts.keys()],canceled:callerSignal.aborted};await store.updateManifest(manifest,current.manifest_hash);}}catch{ /* The readable committed prefix remains diagnostic evidence. */ }
   return {run_id,manifest,sealed:false,diagnostics,evaluation:evaluateRunFacts(context,[...checks.values()],{...completion,fatal_error:true,canceled:callerSignal.aborted},'UNVERIFIED',completion.post_freshness)};
  }
 }
}
