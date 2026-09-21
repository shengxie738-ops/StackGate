import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {FileEvidenceStore} from '../../../packages/core/src/storage/file-evidence-store.js';
import {withTestDirectory} from '../../support/test-paths.js';
import type {RunManifest,RunEvent} from '../../../packages/contracts/src/index.js';
const sample=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8')) as RunManifest;
async function completed(root:string,retries=false){
 const store=new FileEvidenceStore({stateRoot:root,owner:{repo_id:sample.repo_id,worktree_id:sample.worktree_id}});
 let manifest:RunManifest={...structuredClone(sample),phase:'CREATED',verdict:'INCOMPLETE',checks:[],artifact_refs:[],environment_ref:null,started_at:null,finished_at:null};await store.createRun(manifest);
 const update=async(changes:Partial<RunManifest>)=>{const snapshot=await store.readRun(manifest.run_id);manifest={...manifest,...changes};await store.updateManifest(manifest,snapshot.manifest_hash!);};
 await update({phase:'PLANNED'});await update({phase:'RUNNING',started_at:sample.created_at});let seq=0;
 const append=async(value:Pick<RunEvent,'type'|'payload'>)=>{const event={schema_version:'0.1',event_id:'event_'+(++seq),run_id:sample.run_id,seq,at:sample.created_at,...value} as RunEvent;expect(await store.append(event)).toMatchObject({status:'APPENDED'});};
 await append({type:'run.started',payload:{payload_version:'0.1',plan_id:manifest.plan_id,input_hash:manifest.input_hash}});
 const previousArtifacts:string[]=[],previousAttempts:RunManifest['checks'][number]['attempts']=[];
 if(retries){
  const oldScope={run_id:manifest.run_id,check_id:'unit',attempt_id:'attempt_0'},log=await store.store(oldScope,{kind:'artifact',value:{name:'stdout.log',bytes:Buffer.from('first attempt failure'),media_type:'text/plain',artifact_kind:'log',sensitivity:'regular',redaction_state:'REDACTED'}});await append({type:'artifact.saved',payload:{payload_version:'0.1',artifact:log}});await append({type:'check.started',payload:{payload_version:'0.1',check_id:'unit',step_id:'step_unit',attempt_id:'attempt_0'}});
  const old=structuredClone(sample.checks[0]!);old.attempt_id='attempt_0';old.status='FAIL';old.exit_code=1;old.evidence_refs=[log.artifact_id];old.attempts[0]!.attempt_id='attempt_0';old.attempts[0]!.status='FAIL';old.attempts[0]!.raw_exit_code=1;old.attempts[0]!.evidence_refs=[log.artifact_id];previousAttempts.push(...old.attempts);
  await append({type:'check.finished',payload:{payload_version:'0.1',check_result:old}});const document=await store.store(oldScope,{kind:'document',value:{kind:'check-result',value:old}});await append({type:'artifact.saved',payload:{payload_version:'0.1',artifact:document}});previousArtifacts.push(log.artifact_id,document.artifact_id);
 }
 const scope={run_id:manifest.run_id,check_id:'unit',attempt_id:'attempt_1'},artifact=await store.store(scope,{kind:'artifact',value:{name:'stdout.log',bytes:Buffer.from('actual fixture evidence'),media_type:'text/plain',artifact_kind:'log',sensitivity:'regular',redaction_state:'REDACTED'}});
 await append({type:'artifact.saved',payload:{payload_version:'0.1',artifact}});
 await append({type:'check.started',payload:{payload_version:'0.1',check_id:'unit',step_id:'step_unit',attempt_id:'attempt_1'}});
 const check=structuredClone(sample.checks[0]!);check.evidence_refs=[artifact.artifact_id];for(const attempt of check.attempts)attempt.evidence_refs=[artifact.artifact_id];if(retries){check.attempts=[...previousAttempts,...check.attempts];check.flaky_tests=1;}
 await append({type:'check.finished',payload:{payload_version:'0.1',check_result:check}});
 const document=await store.store(scope,{kind:'document',value:{kind:'check-result',value:check}});await append({type:'artifact.saved',payload:{payload_version:'0.1',artifact:document}});
 await update({phase:'FINALIZING',checks:[check],artifact_refs:[...previousArtifacts,artifact.artifact_id,document.artifact_id],verdict:'PASS'});await update({phase:'COMPLETED',finished_at:sample.created_at});
 await append({type:'run.finalized',payload:{payload_version:'0.1',phase:'COMPLETED',verdict:'PASS'}});
 return {store,manifest,artifact,document,request:{run_id:manifest.run_id,input_hash:manifest.input_hash,required_artifact_ids:manifest.artifact_refs}};
}
it('seals immutable facts, supports identical repeat, and exposes verified readonly snapshots',()=>withTestDirectory(async root=>{
 const f=await completed(root);expect((await f.store.readRun(f.manifest.run_id)).status).toBe('INCOMPLETE');expect(await f.store.seal(f.request)).toMatchObject({status:'SEALED',manifest_hash:expect.any(String)});expect(await f.store.verifyRun(f.manifest.run_id)).toMatchObject({status:'VALID'});expect((await f.store.readRun(f.manifest.run_id)).status).toBe('VALID');
 const before=await fs.readFile(path.join(root,'runs',f.manifest.run_id,'seal.json'));expect((await Promise.all([f.store.seal(f.request),f.store.seal(f.request)])).map(result=>result.status)).toEqual(['SEALED','SEALED']);expect(await fs.readFile(path.join(root,'runs',f.manifest.run_id,'seal.json'))).toEqual(before);
 expect((await f.store.append({schema_version:'0.1',event_id:'event_after',run_id:f.manifest.run_id,seq:7,at:sample.created_at,type:'run.canceled',payload:{payload_version:'0.1',reason:'late'}})).status).toBe('ERROR');
 await expect(f.store.store({run_id:f.manifest.run_id,check_id:null,attempt_id:null},{kind:'document',value:{kind:'run',value:f.manifest}})).rejects.toThrow();
}));
it.each(['manifest.json','events.jsonl','artifact-index.json','document','artifact'])('detects modified sealed %s without overwriting history',file=>withTestDirectory(async root=>{
 const f=await completed(root);expect((await f.store.seal(f.request)).status).toBe('SEALED');const relative=file==='document'?f.document.relative_path:file==='artifact'?f.artifact.relative_path:file;
 await fs.appendFile(path.join(root,'runs',f.manifest.run_id,relative),' ');expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('INVALID');expect((await f.store.readRun(f.manifest.run_id)).status).toBe('INVALID');expect((await f.store.seal(f.request)).status).toBe('ERROR');
}));
it('rejects missing required artifacts and preserves readable unsealed facts',()=>withTestDirectory(async root=>{
 const f=await completed(root);expect((await f.store.seal({...f.request,required_artifact_ids:['artifact_absent']})).status).toBe('BLOCKED');expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('MISSING');
 await fs.unlink(path.join(root,'runs',f.manifest.run_id,f.artifact.relative_path));expect((await f.store.seal(f.request)).status).toBe('ERROR');
}));
it('rejects internally contradictory facts even when each document has a valid schema',()=>withTestDirectory(async root=>{
 const f=await completed(root),file=path.join(root,'runs',f.manifest.run_id,'manifest.json'),manifest=JSON.parse(await fs.readFile(file,'utf8'));manifest.checks[0].status='FAIL';await fs.writeFile(file,JSON.stringify(manifest));expect((await f.store.seal(f.request)).status).toBe('ERROR');
}));
it('refuses to seal undeclared orphan evidence or an incomplete event log',()=>withTestDirectory(async root=>{
 const f=await completed(root);await fs.writeFile(path.join(root,'runs',f.manifest.run_id,'artifacts/orphan.txt'),'lost indexing write');expect((await f.store.seal(f.request)).status).toBe('ERROR');
}));
it('retains failed retry documents alongside the final check without rewriting history',()=>withTestDirectory(async root=>{const f=await completed(root,true);expect((await f.store.seal(f.request)).status).toBe('SEALED');const snapshot=await f.store.readRun(f.manifest.run_id);expect(snapshot.events.filter(e=>e.type==='check.finished')).toHaveLength(2);expect(snapshot.manifest?.checks[0]?.flaky_tests).toBe(1);expect(snapshot.artifacts.filter(a=>a.relative_path.endsWith('check-result.json'))).toHaveLength(2);}));
