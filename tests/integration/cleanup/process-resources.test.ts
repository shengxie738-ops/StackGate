import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {CleanupService} from '../../../packages/core/src/services/cleanup-service.js';
import {FileEvidenceStore} from '../../../packages/core/src/storage/file-evidence-store.js';
import {createRunWorkspace} from '../../../packages/runner-local/src/workspace.js';
import type {RunManifest} from '../../../packages/contracts/src/index.js';
import {withTestDirectory} from '../../support/test-paths.js';
async function fixture(root:string,sealed=true,unverifiedPid?:number){
 const sample=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8')) as RunManifest,stateRoot=path.join(root,'state');await fs.mkdir(stateRoot);
 const owner={repo_id:sample.repo_id,worktree_id:sample.worktree_id},store=new FileEvidenceStore({stateRoot,owner});let manifest:RunManifest={...sample,phase:'CREATED',verdict:'INCOMPLETE',checks:[],artifact_refs:[],environment_ref:null,started_at:null,finished_at:null};await store.createRun(manifest);
 if(sealed){await store.append({schema_version:'0.1',event_id:'event_start',run_id:sample.run_id,seq:1,at:sample.created_at,type:'run.started',payload:{payload_version:'0.1',plan_id:sample.plan_id,input_hash:sample.input_hash}});
 if(unverifiedPid){const fact={schema_version:'0.1',kind:'stackgate-command-execution',run_id:sample.run_id,check_id:'unit',step_id:'step_unit',attempt_id:'attempt_first',command_id:'unit',started_at:sample.created_at,finished_at:sample.created_at,result:{status:'ERROR',raw_exit_code:null,signal:null,process:{pid:unverifiedPid,creation_identity:'unverified-old-identity',owner_token:randomUUID()},artifacts:[],diagnostics:[],provenance:{mechanism:'WINDOWS_JOB_OBJECT',cleanup:'UNVERIFIED'}}};const artifact=await store.store({run_id:sample.run_id,check_id:'unit',attempt_id:'attempt_first'},{kind:'artifact',value:{name:'command-execution.json',bytes:Buffer.from(JSON.stringify(fact)),media_type:'application/json',artifact_kind:'report',sensitivity:'regular',redaction_state:'NOT_REQUIRED'}});manifest.artifact_refs=[artifact.artifact_id];await store.append({schema_version:'0.1',event_id:'event_artifact',run_id:sample.run_id,seq:2,at:sample.created_at,type:'artifact.saved',payload:{payload_version:'0.1',artifact}});}
 for(const phase of ['PLANNED','RUNNING','FINALIZING','COMPLETED'] as const){const prior=await store.readRun(manifest.run_id);manifest={...manifest,phase,started_at:sample.created_at,finished_at:phase==='COMPLETED'?sample.created_at:null};await store.updateManifest(manifest,prior.manifest_hash!);}
 await store.append({schema_version:'0.1',event_id:'event_final',run_id:sample.run_id,seq:unverifiedPid?3:2,at:sample.created_at,type:'run.finalized',payload:{payload_version:'0.1',phase:'COMPLETED',verdict:'INCOMPLETE'}});expect((await store.seal({run_id:sample.run_id,input_hash:sample.input_hash,required_artifact_ids:manifest.artifact_refs})).status).toBe('SEALED');}
 const work=await createRunWorkspace(stateRoot,{schema_version:'0.1',...owner,run_id:sample.run_id,owner_token:randomUUID(),created_at:sample.created_at});await fs.mkdir(path.join(work,'unit/attempt_first'),{recursive:true});await fs.writeFile(path.join(work,'unit/attempt_first/temp.txt'),'owned temporary bytes');
 const service=new CleanupService({stateRoot,owner});return {service,store,manifest,work,stateRoot,owner};
}
it('defaults to a nonmutating plan and explicitly cleans only the owned terminal workspace',()=>withTestDirectory(async root=>{
 const f=await fixture(root),plan=await f.service.planCleanup(f.manifest.run_id);expect(plan.status).toBe('READY');expect(await fs.readFile(path.join(f.work,'unit/attempt_first/temp.txt'),'utf8')).toBe('owned temporary bytes');
 expect((await f.service.applyCleanup(plan,plan.plan_hash)).status).toBe('APPLIED');await expect(fs.stat(f.work)).rejects.toThrow();expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('VALID');
}));
it.each(['ownerless','foreign','live','changed','hash'])('preserves %s resources',kind=>withTestDirectory(async root=>{
 const f=await fixture(root,kind!=='live'),file=path.join(f.work,'owner.json');
 if(kind==='ownerless')await fs.unlink(file);if(kind==='foreign'){const owner=JSON.parse(await fs.readFile(file,'utf8'));owner.worktree_id='foreign';await fs.writeFile(file,JSON.stringify(owner));}
 const plan=await f.service.planCleanup(f.manifest.run_id);
 if(kind==='changed')await fs.writeFile(path.join(f.work,'unit/attempt_first/temp.txt'),'changed after dry-run');
 const result=await f.service.applyCleanup(plan,kind==='hash'?'0'.repeat(64):plan.plan_hash);expect(result.status).toBe('ERROR');expect((await fs.stat(f.work)).isDirectory()).toBe(true);
}));
it('preserves a user service and refuses stale PID lock ownership',()=>withTestDirectory(async root=>{
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
 try{const f=await fixture(root);await fs.writeFile(path.join(f.work,'process.lock'),JSON.stringify({pid:unrelated.pid,process_creation_identity:'old-reused-pid',run_id:f.manifest.run_id}));const plan=await f.service.planCleanup(f.manifest.run_id);expect(plan.status).toBe('BLOCKED');expect((await f.service.applyCleanup(plan,plan.plan_hash)).status).toBe('ERROR');expect(unrelated.kill(0)).toBe(true);expect(unrelated.exitCode).toBeNull();}finally{unrelated.kill();}
}));
it('rejects a directory junction and never touches its target',()=>withTestDirectory(async root=>{
 const f=await fixture(root),target=path.join(root,'user-data');await fs.mkdir(target);await fs.writeFile(path.join(target,'valuable.txt'),'user');await fs.symlink(target,path.join(f.work,'linked'),'junction');const plan=await f.service.planCleanup(f.manifest.run_id);expect(plan.status).toBe('BLOCKED');expect(plan.resources.every(resource=>resource.action==='PRESERVE')).toBe(true);expect((await f.service.applyCleanup(plan,plan.plan_hash)).status).toBe('ERROR');expect(await fs.readFile(path.join(target,'valuable.txt'),'utf8')).toBe('user');
}));
it('rejects hard-linked files and reports malformed or traversal run identifiers safely',()=>withTestDirectory(async root=>{
 const f=await fixture(root);await fs.link(path.join(f.work,'unit/attempt_first/temp.txt'),path.join(root,'user-link'));expect((await f.service.planCleanup(f.manifest.run_id)).status).toBe('BLOCKED');expect((await f.service.planCleanup('../runs')).status).toBe('BLOCKED');
}));
it('preserves a replaced directory even when copied owner bytes and content match',()=>withTestDirectory(async root=>{
 const f=await fixture(root),plan=await f.service.planCleanup(f.manifest.run_id),prior=f.work+'-preserved';await fs.rename(f.work,prior);await fs.cp(prior,f.work,{recursive:true});expect((await f.service.applyCleanup(plan,plan.plan_hash)).status).toBe('ERROR');expect(await fs.readFile(path.join(f.work,'unit/attempt_first/temp.txt'),'utf8')).toBe('owned temporary bytes');expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('VALID');
}));
it('preserves associated global locks without relying on current PID existence',()=>withTestDirectory(async root=>{
 const f=await fixture(root),lockRoot=path.join(root,'locks');await fs.mkdir(lockRoot);const lock=path.join(lockRoot,'workspace.lock');await fs.writeFile(lock,JSON.stringify({run_id:f.manifest.run_id,pid:process.pid,process_creation_identity:'stale-owner'}));
 const service=new CleanupService({stateRoot:f.stateRoot,owner:f.owner,lockRoot}),plan=await service.planCleanup(f.manifest.run_id);expect(plan.status).toBe('BLOCKED');expect(plan.resources.some(r=>r.kind==='lock'&&r.action==='PRESERVE')).toBe(true);expect((await service.applyCleanup(plan,plan.plan_hash)).status).toBe('ERROR');expect((await fs.stat(lock)).isFile()).toBe(true);
}));
it('keeps evidence readable when apply encounters changed or unverified ownership',()=>withTestDirectory(async root=>{
 const f=await fixture(root),plan=await f.service.planCleanup(f.manifest.run_id);await fs.writeFile(path.join(f.work,'new-unreviewed-file'),'changed');expect((await f.service.applyCleanup(plan,plan.plan_hash)).status).toBe('ERROR');expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('VALID');
}));
it('reports unverified process cleanup but never kills its historical PID',()=>withTestDirectory(async root=>{
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});try{const f=await fixture(root,true,unrelated.pid),plan=await f.service.planCleanup(f.manifest.run_id);expect(plan.status).toBe('BLOCKED');expect(plan.diagnostics).toContain('PROCESS_COMPLETION_UNVERIFIED');expect(plan.resources.some(r=>r.kind==='process'&&r.action==='PRESERVE')).toBe(true);expect((await f.service.applyCleanup(plan,plan.plan_hash)).status).toBe('ERROR');expect(unrelated.kill(0)).toBe(true);expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('VALID');}finally{unrelated.kill();}
}));
