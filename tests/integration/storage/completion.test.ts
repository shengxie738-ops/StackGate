import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import {validateSchema,type RunManifest,type RunEvent} from '../../../packages/contracts/src/index.js';
import {FileEvidenceStore} from '../../../packages/core/src/storage/file-evidence-store.js';
import {validateLifecycle} from '../../../packages/core/src/storage/event-log.js';
import {withTestDirectory} from '../../support/test-paths.js';
import {canonicalJson} from '../../../packages/core/src/storage/canonical-json.js';
import {hashBytes} from '../../../packages/core/src/storage/hash.js';
const sample=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8')) as RunManifest;
const completion={schema_version:'0.1',run_id:sample.run_id,plan_id:sample.plan_id,recorded_at:sample.created_at,pre_context_hash:'a'.repeat(64),post_context_hash:null,post_input_hash:null,post_freshness:'UNVERIFIED',post_task_confirmed:false,post_trust_valid:false,canceled:false,fatal_error:true,diagnostics:[],scheduler_timings:{}};
const event=(type:string,payload:unknown,seq:number)=>({schema_version:'0.1',event_id:'event_'+seq,run_id:sample.run_id,seq,at:sample.created_at,type,payload}) as RunEvent;
const started=event('run.started',{payload_version:'0.1',plan_id:sample.plan_id,input_hash:sample.input_hash},1);
const phase=(from:string|null,to:string,seq:number)=>event('run.phase_changed',{payload_version:'0.1',from,to},seq);
it('validates strict completion facts and persists them bound to the run plan',()=>withTestDirectory(async root=>{
 expect(validateSchema('run-completion',completion).ok).toBe(true);
 expect(validateSchema('run-completion',{...completion,extra:true}).ok).toBe(false);
 expect(validateSchema('run-completion',{...completion,recorded_at:'2026-01-01T12:00:00+08:00'}).ok).toBe(false);
 const store=new FileEvidenceStore({stateRoot:root,owner:{repo_id:sample.repo_id,worktree_id:sample.worktree_id}});await store.createRun({...sample,phase:'CREATED'});
 const scope={run_id:sample.run_id,check_id:null,attempt_id:null};
 const document={kind:'run-completion' as const,value:completion};
 await expect(store.store(scope,{kind:'document',value:document as never})).resolves.toMatchObject({relative_path:'documents/run-completion.json'});
 await expect(store.store(scope,{kind:'document',value:{...document,value:{...completion,plan_id:'plan_wrong'}} as never})).rejects.toThrow();
}));
it('accepts continuous phase events and rejects jumps, duplicate initialization, and mismatched finalization',()=>{
 const good=[started,phase(null,'CREATED',2),phase('CREATED','PLANNED',3),phase('PLANNED','RUNNING',4),phase('RUNNING','FINALIZING',5),phase('FINALIZING','COMPLETED',6),event('run.finalized',{payload_version:'0.1',phase:'COMPLETED',verdict:'PASS'},7)];
 expect(validateSchema('event',good[1]).ok).toBe(true);expect(validateLifecycle(good)).toEqual([]);
 expect(validateLifecycle([started,phase(null,'CREATED',2),phase('CREATED','COMPLETED',3)])).not.toEqual([]);
 expect(validateLifecycle([started,phase(null,'CREATED',2),phase(null,'CREATED',3)])).not.toEqual([]);
 expect(validateLifecycle([...good.slice(0,-1),event('run.finalized',{payload_version:'0.1',phase:'ABORTED',verdict:'ERROR'},7)])).not.toEqual([]);
 expect(validateLifecycle([started])).toEqual([]);
});
it('binds restricted context bytes and completion to the sealed manifest, retaining old event compatibility',()=>withTestDirectory(async root=>{
 const read=async(file:string)=>JSON.parse(await fs.readFile(file,'utf8'));
 const hash='a'.repeat(64),context={schema_version:'0.1',task_file:'.stackgate/tasks/test.json',base_ref:'HEAD',profile:'local',config:await read('tests/fixtures/config/original.json'),task:await read('tests/fixtures/tasks/draft.json'),input_manifest:await read('tests/fixtures/protocols/input-manifest.json'),configuration_hash:hash,confirmation_digest:hash,execution_digest:hash,policy_hash:hash,toolchain_hash:hash,tool_versions:{node:'24'},target_contract_hashes:{api:hash},environment_requirements:{required:false},required_check_ids:['unit'],test_assignments:{unit:['local-case']},selection_sources:{unit:['required']},analysis_gaps:[],workspace_resource_ids:{web:'workspace_web'},blockers:[]};
 expect(validateSchema('plan-context',context).ok).toBe(true);
 const plan_id='plan_'+hashBytes(Buffer.from(canonicalJson(context))),store=new FileEvidenceStore({stateRoot:root,owner:{repo_id:sample.repo_id,worktree_id:sample.worktree_id}});
 let manifest:RunManifest={...sample,plan_id,phase:'CREATED',checks:[],artifact_refs:[],canceled:false,verdict:'INCOMPLETE'};await store.createRun(manifest);const scope={run_id:sample.run_id,check_id:null,attempt_id:null};
 await expect(store.store(scope,{kind:'document',value:{kind:'plan-context',value:{...context,base_ref:'wrong'}} as never})).rejects.toThrow();
 const document=await store.store(scope,{kind:'document',value:{kind:'plan-context',value:context} as never});expect(document).toMatchObject({sensitivity:'restricted',redaction_state:'UNREDACTED',relative_path:'documents/plan-context.json'});
 const done=await store.store(scope,{kind:'document',value:{kind:'run-completion',value:{...completion,plan_id}} as never});
 let seq=0;const append=async(type:string,payload:unknown)=>expect(await store.append(event(type,payload,++seq))).toMatchObject({status:'APPENDED'});
 await append('run.started',{payload_version:'0.1',plan_id,input_hash:manifest.input_hash});
 for(const artifact of [document,done])await append('artifact.saved',{payload_version:'0.1',artifact});
 for(const phase of ['PLANNED','RUNNING','FINALIZING','COMPLETED'] as const){const previous=await store.readRun(manifest.run_id);manifest={...manifest,phase,artifact_refs:[document.artifact_id,done.artifact_id]};await store.updateManifest(manifest,previous.manifest_hash!);}
 await append('run.finalized',{payload_version:'0.1',phase:'COMPLETED',verdict:'INCOMPLETE'});
 expect(await store.seal({run_id:manifest.run_id,input_hash:manifest.input_hash,required_artifact_ids:manifest.artifact_refs})).toMatchObject({status:'SEALED'});
 expect((await store.verifyRun(manifest.run_id)).status).toBe('VALID');
}));
