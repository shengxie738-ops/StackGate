import path from 'node:path';
import fs from 'node:fs/promises';
import {PlanService} from '../../../../packages/core/src/services/plan-service.js';
import {RunService} from '../../../../packages/core/src/services/run-service.js';
import {GateService} from '../../../../packages/core/src/services/gate-service.js';
import {CleanupService} from '../../../../packages/core/src/services/cleanup-service.js';
import {HandoffService,handoffRelativePaths,readHandoffFile,validateHandoff} from '../../../../packages/core/src/services/handoff-service.js';
import {buildReportView} from '../../../../packages/reporters/src/report-view.js';
import {renderJson} from '../../../../packages/reporters/src/json.js';
import {renderTerminal} from '../../../../packages/reporters/src/terminal.js';
import {renderMarkdown} from '../../../../packages/reporters/src/markdown.js';
import {renderJunit} from '../../../../packages/reporters/src/junit-output.js';
import {renderHandoff} from '../../../../packages/reporters/src/handoff.js';
import {writeBytesAtomic,strictPath} from '../../../../packages/core/src/storage/run-layout.js';
import {StorageError} from '../../../../packages/core/src/storage/storage-error.js';
import {ensureDirectoryWithin} from '../../../../packages/core/src/storage/task-revisions.js';
import {configurationError} from '../../../../packages/core/src/services/service-error.js';
import type {CommandResult} from '../output.js';
export async function planCommand(root:string,task:string,profile:string,base?:string):Promise<CommandResult>{const plan=await new PlanService(root).create({task,profile,...(base?{base}:{})});return {data:plan,exit_code:0,diagnostics:[]};}
export async function runCommand(root:string,plan_id:string,previous_run_id?:string):Promise<CommandResult>{
 const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 try{const run=await new RunService(root).execute(plan_id,{signal:controller.signal,...(previous_run_id?{previous_run_id}:{})});return {data:{run_id:run.run_id,gate:run.evaluation,sealed:run.sealed,manifest:run.manifest},runtime:run.run_id?'EXECUTED':'NOT_EXECUTED',exit_code:run.evaluation.exit_code,diagnostics:run.diagnostics};}
 finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
export async function gateCommand(root:string,run_id:string):Promise<CommandResult>{const result=await new GateService(root).evaluate(run_id);return {data:{run_id,gate:result.evaluation,evaluation_path:path.relative(result.state_root,result.evaluation_path).replaceAll(path.sep,'/')},exit_code:result.evaluation.exit_code,diagnostics:result.diagnostics};}
async function saveOutput(root:string,stateRoot:string,output:string,content:string){
 const destination=path.resolve(root,output),relative=path.relative(stateRoot,destination).replaceAll(path.sep,'/');
 if(!relative||relative.startsWith('../')||relative==='..'||path.isAbsolute(relative)||!relative.startsWith('client-output/'))throw configurationError('Report output must be a new file under the configured state_dir/client-output directory');
 await ensureDirectoryWithin(stateRoot,path.posix.dirname(relative));await writeBytesAtomic(stateRoot,relative,Buffer.from(content));return relative;
}
export async function reportCommand(root:string,run_id:string,format:'json'|'terminal'|'markdown'|'junit',output?:string):Promise<CommandResult>{
 const facts=await new GateService(root).inspect(run_id);if(!facts.manifest)return {data:{run_id,gate:facts.evaluation},exit_code:facts.integrity==='INVALID'?3:2,diagnostics:facts.diagnostics};
 const view=buildReportView({manifest:facts.manifest,plan:facts.plan,artifacts:facts.artifacts},facts.evaluation),content=format==='json'?renderJson(view):format==='terminal'?renderTerminal(view):format==='markdown'?renderMarkdown(view):renderJunit(view);
 const saved=output?await saveOutput(root,facts.state_root,output,content):null;
 return {data:{run_id,gate:facts.evaluation,format,view,...(saved?{output:saved}:{content})},text:saved?`Report saved: ${saved}`:content,exit_code:0,diagnostics:facts.diagnostics};
}
/** Derived artifacts are content addressed and never replace different historical bytes. */
async function writeDerived(stateRoot:string,relative:string,content:string):Promise<void>{
 await ensureDirectoryWithin(stateRoot,path.posix.dirname(relative));
 try{await writeBytesAtomic(stateRoot,relative,Buffer.from(content));}
 catch(error){
  if(!(error instanceof StorageError)||error.code!=='TARGET_EXISTS')throw error;
  if((await fs.readFile(await strictPath(stateRoot,relative))).toString()!==content)throw error;
 }
}
export async function handoffCommand(root:string,run_id:string,target:'codex'|'claude'|'manual',output?:string):Promise<CommandResult>{
 const {bundle,state_root}=await new HandoffService(root).publishHandoff(run_id,target),names=handoffRelativePaths(bundle),markdown=renderHandoff(bundle);
 await writeDerived(state_root,names.json,JSON.stringify(bundle)+'\n');await writeDerived(state_root,names.markdown,markdown);
 const prefix=path.relative(root,state_root).split(path.sep).join('/'),derived=(name:string)=>prefix?`${prefix}/${name}`:name;
 const saved=output?await saveOutput(root,state_root,output,markdown):null;
 return {data:{handoff_id:bundle.handoff_id,handoff_json_path:derived(names.json),handoff_markdown_path:derived(names.markdown),freshness:bundle.facts.freshness,bundle,...(saved?{output:saved}:{})},text:markdown,exit_code:0,diagnostics:[]};
}
export async function handoffValidateCommand(root:string,file:string):Promise<CommandResult>{
 const bundle=await readHandoffFile(path.resolve(root,file));
 // A receiver in another clone legitimately lacks the source plan; that is a completed diagnosis, not a CLI error.
 let context:null|{input_manifest:{repo_id:string;worktree_id:string;input_hash:string};task:{task_id:string;revision:number}}=null;
 try{context=(await new PlanService(root).inspectCurrent(bundle.facts.plan_id)).current;}catch{context=null;}
 if(!context)return {data:{valid_for_current_inputs:false,freshness:'STALE',task_revision_matches:false,reasons:['CURRENT_IDENTITY_UNAVAILABLE']},exit_code:0,diagnostics:[]};
 return {data:validateHandoff(bundle,{repo_id:context.input_manifest.repo_id,worktree_id:context.input_manifest.worktree_id,task_id:context.task.task_id,task_revision:context.task.revision,input_hash:context.input_manifest.input_hash}),exit_code:0,diagnostics:[]};
}
export async function cleanCommand(root:string,run_id:string,apply:boolean,digest?:string):Promise<CommandResult>{
 const facts=await new GateService(root).inspect(run_id);if(!facts.manifest)return {data:{run_id},exit_code:2,diagnostics:facts.diagnostics};
 const service=new CleanupService({stateRoot:facts.state_root,owner:facts.manifest}),plan=await service.planCleanup(run_id);
 if(!apply)return {data:plan,exit_code:plan.status==='BLOCKED'?2:0,diagnostics:[]};
 const result=await service.applyCleanup(plan,digest!);return {data:result,exit_code:result.status==='ERROR'?3:0,diagnostics:[]};
}
