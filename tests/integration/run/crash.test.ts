import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {withTestDirectory} from '../../support/test-paths.js';
import {prepareWorker,worker,runFixture} from '../../support/reliability.js';
import {createRunWorkspace} from '../../../packages/runner-local/src/workspace.js';
import {commandExecution,commandStep} from '../../support/command-execution.js';
import {CommandAdapter} from '../../../packages/adapter-command/src/command-adapter.js';
vi.setConfig({testTimeout:45000});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(action:()=>Promise<boolean>,ms=10000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await action())return;await delay(40);}throw Error('Observed condition did not become true');}
async function identity(pid:number){if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid test process');const result=await promisify(execFile)(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',`try { [Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks } catch { 'MISSING' }`],{windowsHide:true,timeout:5000});return result.stdout.trim();}
it('hard-killing the runner parent closes its private job lifeline and preserves unrelated service',()=>withTestDirectory(async root=>{
 const file=await prepareWorker(root),parent=worker(file,'runner',{root}),unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
 try{await parent.start();await until(async()=>{try{return (await fs.stat(path.join(root,'business.ticks'))).size>0&&(await fs.stat(path.join(root,'descendant.ticks'))).size>0;}catch{return false;}});
 const business=Number(await fs.readFile(path.join(root,'business.pid'),'utf8')),descendant=Number(await fs.readFile(path.join(root,'descendant.pid'),'utf8')),before=await Promise.all([identity(business),identity(descendant)]);expect(before.every(value=>/^\d+$/.test(value))).toBe(true);
 expect(parent.child.kill()).toBe(true);await parent.closed;
 await until(async()=>{const after=await Promise.all([identity(business),identity(descendant)]);return after.every((value,index)=>value!==before[index]);},5000);
 const ticks=await Promise.all(['business','descendant'].map(name=>fs.readFile(path.join(root,name+'.ticks'))));await delay(150);expect(await fs.readFile(path.join(root,'business.ticks'))).toEqual(ticks[0]);expect(await fs.readFile(path.join(root,'descendant.ticks'))).toEqual(ticks[1]);expect(unrelated.kill(0)).toBe(true);expect(unrelated.exitCode).toBeNull();
 }finally{if(parent.child.exitCode===null&&!parent.child.killed)parent.child.kill();unrelated.kill();}
}));
it('a killed manifest temp writer preserves prior bytes and refuses unsafe lock recovery',()=>withTestDirectory(async root=>{
 const file=await prepareWorker(root),f=await runFixture(root),manifestPath=path.join(f.stateRoot,'runs',f.manifest.run_id,'manifest.json'),before=await fs.readFile(manifestPath),snapshot=await f.store.readRun(f.manifest.run_id);
 const child=worker(file,'partial-manifest',{stateRoot:f.stateRoot,owner:f.owner,manifest:{...f.manifest,phase:'PLANNED'},expected_hash:snapshot.manifest_hash});
 try{await child.start();const partial=await child.wait('partial');expect(partial.type).toBe('partial');expect((await fs.stat(String(partial.path))).size).toBeGreaterThan(0);child.child.kill();await child.closed;expect(await fs.readFile(manifestPath)).toEqual(before);expect((await f.store.verifyRun(f.manifest.run_id)).status).not.toBe('VALID');expect((await fs.stat(path.join(f.stateRoot,'runs',f.manifest.run_id,'.write-lock'))).isFile()).toBe(true);
 await expect(f.store.updateManifest({...f.manifest,phase:'PLANNED'},snapshot.manifest_hash!)).rejects.toThrow('lock');
 const next={...f.manifest,run_id:'run_new_after_crash'};await f.store.createRun(next);expect((await f.store.readRun(next.run_id)).manifest?.phase).toBe('CREATED');expect(await fs.readFile(manifestPath)).toEqual(before);
 }finally{if(child.child.exitCode===null&&!child.child.killed)child.child.kill();}
}));
it('a killed event temp writer cannot publish a partial event or silent completion',()=>withTestDirectory(async root=>{
 const file=await prepareWorker(root),f=await runFixture(root),eventsPath=path.join(f.stateRoot,'runs',f.manifest.run_id,'events.jsonl'),before=await fs.readFile(eventsPath),event={schema_version:'0.1',event_id:'event_phase',run_id:f.manifest.run_id,seq:2,at:f.manifest.created_at,type:'run.phase_changed',payload:{payload_version:'0.1',from:null,to:'CREATED'}},child=worker(file,'partial-event',{stateRoot:f.stateRoot,owner:f.owner,event});
 try{await child.start();expect((await child.wait('partial')).type).toBe('partial');child.child.kill();await child.closed;expect(await fs.readFile(eventsPath)).toEqual(before);const snapshot=await f.store.readRun(f.manifest.run_id);expect(snapshot.status).not.toBe('VALID');expect(snapshot.events).toHaveLength(1);expect(snapshot.manifest?.verdict).toBe('INCOMPLETE');}finally{if(child.child.exitCode===null&&!child.child.killed)child.child.kill();}
}));
it('hard exit after actual failed check persistence preserves the failure without sealing PASS',()=>withTestDirectory(async root=>{
 const file=await prepareWorker(root),h=await commandExecution(root,'process.exit(7)'),adapter=new CommandAdapter(),run_id=h.context.run_id,snapshot=await h.store.readRun(run_id),manifest=snapshot.manifest!;
 await h.store.append({schema_version:'0.1',event_id:'event_start',run_id,seq:1,at:manifest.created_at,type:'run.started',payload:{payload_version:'0.1',plan_id:manifest.plan_id,input_hash:manifest.input_hash}});
 await h.store.append({schema_version:'0.1',event_id:'event_check_start',run_id,seq:2,at:manifest.created_at,type:'check.started',payload:{payload_version:'0.1',check_id:commandStep.check_id,step_id:commandStep.step_id,attempt_id:h.context.attempt_id}});
 for await(const event of adapter.execute(commandStep,h.context))await h.store.append({...event,seq:3});
 const result=await adapter.collect(commandStep,{...h.collection,artifacts:h.artifacts});expect(result.status).toBe('FAIL');
 const child=worker(file,'append-wait',{stateRoot:path.join(root,'state'),owner:manifest,event:{schema_version:'0.1',event_id:'event_failed',run_id,seq:4,at:manifest.created_at,type:'check.finished',payload:{payload_version:'0.1',check_result:result}}});
 try{await child.start();expect(await child.wait('checkpoint')).toMatchObject({result:{status:'APPENDED'}});child.child.kill();await child.closed;const recorded=await h.store.readRun(run_id);expect(recorded.status).not.toBe('VALID');expect(recorded.events.at(-1)).toMatchObject({type:'check.finished',payload:{check_result:{status:'FAIL',exit_code:7}}});expect(recorded.manifest?.verdict).toBe('INCOMPLETE');}finally{if(child.child.exitCode===null&&!child.child.killed)child.child.kill();}
}));
it.each(['before','after'])('crashing %s cleanup never removes sealed evidence',when=>withTestDirectory(async root=>{
 const file=await prepareWorker(root),f=await runFixture(root,true);expect((await f.store.seal(f.request)).status).toBe('SEALED');const work=await createRunWorkspace(f.stateRoot,{schema_version:'0.1',...f.owner,run_id:f.manifest.run_id,owner_token:randomUUID(),created_at:f.manifest.created_at});await fs.writeFile(path.join(work,'temporary'),'owned');
 const child=worker(file,'cleanup-'+when,{stateRoot:f.stateRoot,owner:f.owner,run_id:f.manifest.run_id});try{await child.start();const checkpoint=await child.wait('checkpoint');expect(checkpoint.type).toBe('checkpoint');if(when==='after')expect(checkpoint.result).toMatchObject({status:'APPLIED'});child.child.kill();await child.closed;expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('VALID');if(when==='before')expect(await fs.readFile(path.join(work,'temporary'),'utf8')).toBe('owned');else await expect(fs.stat(work)).rejects.toThrow();}finally{if(child.child.exitCode===null&&!child.child.killed)child.child.kill();}
}));
