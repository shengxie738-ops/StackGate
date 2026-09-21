import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import type {RunManifest,RunEvent} from '../../packages/contracts/src/index.js';
import {FileEvidenceStore} from '../../packages/core/src/storage/file-evidence-store.js';
export async function prepareWorker(root:string){
 const file=path.join(root,'worker.mjs');await build({entryPoints:['tests/support/reliability-child.ts'],outfile:file,bundle:true,platform:'node',format:'esm',target:'node24',define:{STACKGATE_BUNDLED:'false'},banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
 for(const name of ['windows-job.cs','windows-job.ps1'])await fs.copyFile(path.join('packages/runner-local/src',name),path.join(root,name));return file;
}
export function worker(file:string,mode:string,args:unknown){
 const child=spawn(process.execPath,[file,mode,JSON.stringify(args)],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true}),messages:Record<string,unknown>[]=[];let stderr='';const listeners=new Set<()=>void>();
 child.stderr?.on('data',chunk=>{stderr+=chunk.toString();});child.on('message',message=>{messages.push(message as Record<string,unknown>);for(const listener of listeners)listener();});
 const closed=new Promise<number|null>(resolve=>child.once('close',code=>resolve(code)));
 const wait=(type:string,timeout=20000)=>new Promise<Record<string,unknown>>((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(check);reject(Error(`Worker ${mode} did not emit ${type}: ${stderr}`));},timeout);const check=()=>{const found=messages.find(message=>message.type===type||message.type==='error');if(found){clearTimeout(timer);listeners.delete(check);resolve(found);}};listeners.add(check);check();});
 return {child,closed,wait,async start(){await wait('ready');child.send('go');},messages};
}
export async function runFixture(root:string,terminal=false){
 const sample=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8')) as RunManifest,stateRoot=path.join(root,'state'),owner={repo_id:sample.repo_id,worktree_id:sample.worktree_id};await fs.mkdir(stateRoot);
 const store=new FileEvidenceStore({stateRoot,owner});let manifest:RunManifest={...sample,phase:'CREATED',verdict:'INCOMPLETE',checks:[],artifact_refs:[],canceled:false,environment_ref:null,started_at:null,finished_at:null};await store.createRun(manifest);
 const event=(type:RunEvent['type'],payload:unknown,seq:number)=>({schema_version:'0.1',event_id:'event_'+seq,run_id:manifest.run_id,seq,at:sample.created_at,type,payload}) as RunEvent;
 const started=event('run.started',{payload_version:'0.1',plan_id:manifest.plan_id,input_hash:manifest.input_hash},1);await store.append(started);
 if(terminal){for(const phase of ['PLANNED','RUNNING','FINALIZING','COMPLETED'] as const){const current=await store.readRun(manifest.run_id);manifest={...manifest,phase,started_at:sample.created_at,finished_at:phase==='COMPLETED'?sample.created_at:null};await store.updateManifest(manifest,current.manifest_hash!);}await store.append(event('run.finalized',{payload_version:'0.1',phase:'COMPLETED',verdict:'INCOMPLETE'},2));}
 return {store,stateRoot,owner,manifest,started,request:{run_id:manifest.run_id,input_hash:manifest.input_hash,required_artifact_ids:[] as string[]}};
}
