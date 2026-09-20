import fs from 'node:fs/promises';
import path from 'node:path';
import {LocalRunner} from '../../packages/runner-local/src/local-runner.js';
import {FileEvidenceStore} from '../../packages/core/src/storage/file-evidence-store.js';
import {acquireResources} from '../../packages/core/src/execution/resource-lock.js';
import {hashBytes} from '../../packages/core/src/storage/hash.js';
import {CleanupService} from '../../packages/core/src/services/cleanup-service.js';
import type {RunEvent} from '../../packages/contracts/src/index.js';
const mode=process.argv[2]!,args=JSON.parse(process.argv[3]!);
const send=(value:unknown)=>process.send?.(value);
send({type:'ready'});await new Promise<void>(resolve=>process.once('message',()=>resolve()));
try{
 if(mode==='runner'){
  const script=path.join(args.root,'business.cjs'),descendant=path.join(args.root,'descendant.cjs');
  await fs.writeFile(descendant,`const fs=require('fs');fs.writeFileSync(${JSON.stringify(path.join(args.root,'descendant.pid'))},String(process.pid));const t=setInterval(()=>fs.appendFileSync(${JSON.stringify(path.join(args.root,'descendant.ticks'))},'x'),20);setTimeout(()=>{clearInterval(t);process.exit(0)},20000)`);
  await fs.writeFile(script,`const fs=require('fs');fs.writeFileSync(${JSON.stringify(path.join(args.root,'business.pid'))},String(process.pid));require('child_process').spawn(process.execPath,[${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'}).unref();const t=setInterval(()=>fs.appendFileSync(${JSON.stringify(path.join(args.root,'business.ticks'))},'x'),20);setTimeout(()=>{clearInterval(t);process.exit(0)},20000)`);
  const result=await new LocalRunner().run({command_id:'owned',identity:{executable:process.execPath,version:process.version,digest:hashBytes(await fs.readFile(process.execPath))},args:[script],cwd:args.root,environment:{SystemRoot:process.env.SystemRoot!,TEMP:args.root,TMP:args.root},timeout_ms:19000,authorization_hash:'a'.repeat(64),command_hash:'b'.repeat(64)},{run_id:'run_crash',check_id:'owned',attempt_id:'attempt_one',signal:new AbortController().signal,async stdout(){},async stderr(){}});send({type:'result',result});
 }else if(mode==='lock'){
  const lease=await acquireResources(['workspace_shared'],args.context);send({type:'acquired',acquired:!!lease});if(lease){await new Promise<void>(resolve=>process.once('message',()=>resolve()));await lease.release();}send({type:'result',released:!!lease});
 }else{
  const store=new FileEvidenceStore({stateRoot:args.stateRoot,owner:args.owner});
  if(mode==='append')send({type:'result',result:await store.append(args.event as RunEvent)});
  else if(mode==='append-wait'){send({type:'checkpoint',result:await store.append(args.event as RunEvent)});await new Promise(()=>{});}
  else if(mode==='cleanup-before'||mode==='cleanup-after'){const service=new CleanupService({stateRoot:args.stateRoot,owner:args.owner}),plan=await service.planCleanup(args.run_id);if(plan.status!=='READY')throw Error('Cleanup fixture is not ready');const result=mode==='cleanup-after'?await service.applyCleanup(plan,plan.plan_hash):null;send({type:'checkpoint',result});await new Promise(()=>{});}
  else if(mode==='store')send({type:'result',result:await store.store(args.scope,{kind:'artifact',value:{name:'shared.txt',bytes:Buffer.from(args.text),media_type:'text/plain',artifact_kind:'report',sensitivity:'regular',redaction_state:'NOT_REQUIRED'}})});
  else if(mode==='seal')send({type:'result',result:await store.seal(args.request)});
  else if(mode==='finalize'){await store.updateManifest(args.manifest,args.expected_hash);send({type:'result',status:'UPDATED'});}
  else if(mode==='partial-manifest'||mode==='partial-event'){
   const original=fs.open.bind(fs);fs.open=(async(...input:Parameters<typeof fs.open>)=>{const handle=await original(...input);if(!String(input[0]).includes('.sg-tmp-'))return handle;return new Proxy(handle,{get(target,key){if(key==='writeFile')return async(bytes:Uint8Array)=>{await target.writeFile(bytes.subarray(0,Math.max(1,Math.floor(bytes.length/2))));await target.sync();send({type:'partial',path:String(input[0])});await new Promise(()=>{});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}) as typeof fs.open;
   if(mode==='partial-event')await store.append(args.event);else await store.updateManifest(args.manifest,args.expected_hash);
  }else throw Error('Unknown reliability worker');
 }
}catch(error){send({type:'error',code:(error as NodeJS.ErrnoException).code??'ERROR',message:error instanceof Error?error.message:'failed'});}
process.disconnect?.();
