import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {RunEvent,RunManifest} from '../../../packages/contracts/src/index.js';
import {FileEvidenceStore} from '../../../packages/core/src/storage/file-evidence-store.js';
import {writeBytesAtomic,withRunLock} from '../../../packages/core/src/storage/run-layout.js';
import {withTestDirectory} from '../../support/test-paths.js';
const fixture=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8')) as RunManifest;
export function initial(run_id='run_fixture'):RunManifest{return {...structuredClone(fixture),run_id,phase:'CREATED',verdict:'INCOMPLETE',started_at:null,finished_at:null,checks:[],artifact_refs:[],environment_ref:null};}
export function started(run_id='run_fixture'):RunEvent{return {schema_version:'0.1',event_id:'event_start',run_id,seq:1,at:'2026-09-20T00:00:00Z',type:'run.started',payload:{payload_version:'0.1',plan_id:'plan_fixture',input_hash:fixture.input_hash}};}
export function store(root:string){return new FileEvidenceStore({stateRoot:root,owner:{repo_id:'repo_fixture',worktree_id:'worktree_fixture'}});}
const artifact={name:'stdout.log',media_type:'text/plain',bytes:Buffer.from('retained evidence'),artifact_kind:'log' as const,sensitivity:'regular' as const,redaction_state:'REDACTED' as const};
const scope={run_id:'run_fixture',check_id:'unit',attempt_id:'attempt_1'};
it('creates independent runs and preserves immutable artifacts with checked bytes',()=>withTestDirectory(async root=>{
 const s=store(root);await s.createRun(initial());await s.createRun(initial('run_other'));
 const a=await s.store(scope,{kind:'artifact',value:artifact}),b=await s.store({...scope,run_id:'run_other'},{kind:'artifact',value:artifact});expect(a.artifact_id).not.toBe(b.artifact_id);
 expect(await s.read({run_id:scope.run_id,relative_path:a.relative_path,expected_digest:a.digest,max_bytes:100})).toMatchObject({status:'FOUND',bytes:artifact.bytes});
 await expect(s.store(scope,{kind:'artifact',value:{...artifact,bytes:Buffer.from('replacement')}})).rejects.toThrow();
 expect(await s.store(scope,{kind:'artifact',value:artifact})).toEqual(a);
 expect((await s.readRun(scope.run_id)).status).toBe('INCOMPLETE');
}));
it.each([1,2,3,4,5])('serializes duplicate parallel events and rejects conflicting IDs, gaps, rollback and foreign scope (round %s)',()=>withTestDirectory(async root=>{
 const s=store(root);await s.createRun(initial());const event=started();
 const results=await Promise.all(Array.from({length:8},()=>s.append(event)));expect(results.filter(r=>r.status==='APPENDED'),JSON.stringify(results)).toHaveLength(1);expect(results.filter(r=>r.status==='DUPLICATE'),JSON.stringify(results)).toHaveLength(7);
 expect(await s.append({...event,at:'2026-09-20T00:00:01Z'})).toMatchObject({status:'ERROR'});
 expect(await s.append({...event,event_id:'event_gap',seq:3})).toMatchObject({status:'ERROR'});
 expect(await s.append({...event,event_id:'event_rollback',seq:1})).toMatchObject({status:'ERROR'});
 expect(await s.append({...event,run_id:'run_missing'})).toMatchObject({status:'ERROR'});
 expect((await s.readRun(scope.run_id)).events).toHaveLength(1);
}));
it('diagnoses truncated JSONL while retaining completed records and refusing further append',()=>withTestDirectory(async root=>{
 const s=store(root);await s.createRun(initial());await s.append(started());await fs.appendFile(path.join(root,'runs/run_fixture/events.jsonl'),'{"event_id":');
 const result=await s.readRun(scope.run_id);expect(result.status).toBe('INVALID');expect(result.events).toHaveLength(1);expect(result.diagnostics.length).toBeGreaterThan(0);
 expect(await s.append({...started(),seq:2,event_id:'event_later'})).toMatchObject({status:'ERROR'});
}));
it('validates event documents and rejects illegal lifecycle or cross-run check results',()=>withTestDirectory(async root=>{
 const s=store(root);await s.createRun(initial());const finished=JSON.parse(await fs.readFile('tests/fixtures/protocols/event.json','utf8'));
 expect(await s.append(finished)).toMatchObject({status:'ERROR'});expect(await s.append({...started(),seq:0})).toMatchObject({status:'ERROR'});
 await s.append(started());const begun:RunEvent={schema_version:'0.1',event_id:'event_check',run_id:scope.run_id,seq:2,at:started().at,type:'check.started',payload:{payload_version:'0.1',check_id:'unit',step_id:'step_unit',attempt_id:'attempt_1'}};
 expect(await s.append(begun)).toMatchObject({status:'APPENDED'});finished.seq=3;finished.payload.check_result.run_id='run_other';expect(await s.append(finished)).toMatchObject({status:'ERROR'});
}));
it('rejects traversal, links, malformed documents and scope mismatch',()=>withTestDirectory(async root=>{
 const s=store(root);await s.createRun(initial());
 await expect(s.store(scope,{kind:'artifact',value:{...artifact,name:'../escape'}})).rejects.toThrow();
 await expect(s.store(scope,{kind:'document',value:{kind:'run',value:initial('run_other')}})).rejects.toThrow();
 await expect(s.store(scope,{kind:'document',value:{kind:'run',value:{...initial(),schema_version:'invalid'} as unknown as RunManifest}})).rejects.toThrow();
 const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.symlink(outside,path.join(root,'runs/run_fixture/artifacts/linked'),'junction');
 await expect(s.store({...scope,check_id:null,attempt_id:null},{kind:'artifact',value:{...artifact,name:'linked/escape'}})).rejects.toThrow();expect(await fs.readdir(outside)).toEqual([]);
}));
it('requires explicit exact manifest CAS and immutable run identity',()=>withTestDirectory(async root=>{
 const s=store(root),manifest=initial();await s.createRun(manifest);const before=await s.readRun(manifest.run_id);
 await expect(s.updateManifest({...manifest,phase:'PLANNED'},'0'.repeat(64))).rejects.toThrow();
 await s.updateManifest({...manifest,phase:'PLANNED'},before.manifest_hash!);
 await expect(s.updateManifest({...manifest,phase:'RUNNING',input_hash:'0'.repeat(64)},(await s.readRun(manifest.run_id)).manifest_hash!)).rejects.toThrow();
 await expect(s.createRun(manifest)).rejects.toThrow();
}));
it('preserves unrelated temp bytes when a parent is replaced during commit',()=>withTestDirectory(async root=>{
 const parent=path.join(root,'owned');await fs.mkdir(parent);const link=fs.link.bind(fs);let victim='';
 const spy=vi.spyOn(fs,'link').mockImplementation(async(source,target)=>{
  if(String(target).endsWith('report.txt')){await fs.rename(parent,parent+'-retained');await fs.mkdir(parent);victim=path.join(parent,path.basename(String(source)));await fs.writeFile(victim,'unrelated owner');throw Object.assign(new Error('interrupted'),{code:'EIO'});}
  return link(source,target);
 });
 try{await expect(writeBytesAtomic(root,'owned/report.txt',Buffer.from('evidence'))).rejects.toThrow();expect(await fs.readFile(victim,'utf8')).toBe('unrelated owner');}finally{spy.mockRestore();}
}));
it('check completion preserves matching step identity and cannot finalize active attempts',()=>withTestDirectory(async root=>{
 const s=store(root);await s.createRun(initial());await s.append(started());
 const event:RunEvent={schema_version:'0.1',event_id:'event_check',run_id:scope.run_id,seq:2,at:started().at,type:'check.started',payload:{payload_version:'0.1',check_id:'unit',step_id:'step_unit',attempt_id:'attempt_1'}};
 await s.append(event);const finished=JSON.parse(await fs.readFile('tests/fixtures/protocols/event.json','utf8'));finished.seq=3;finished.payload.check_result.step_id='step_other';expect(await s.append(finished)).toMatchObject({status:'ERROR'});
 expect(await s.append({schema_version:'0.1',event_id:'event_final',run_id:scope.run_id,seq:3,at:started().at,type:'run.finalized',payload:{payload_version:'0.1',phase:'COMPLETED',verdict:'PASS'}})).toMatchObject({status:'ERROR'});
 finished.payload.check_result.step_id='step_unit';expect(await s.append(finished)).toMatchObject({status:'APPENDED'});expect(await s.append(finished)).toMatchObject({status:'DUPLICATE'});expect((await s.readRun(scope.run_id)).events.filter(e=>e.type==='check.finished')).toHaveLength(1);
}));
it('acquires exclusively without resolving another owner volatile lock leaf',()=>withTestDirectory(async root=>{
 const lock=path.join(root,'.write-lock');await fs.writeFile(lock,'previous owner');const realpath=fs.realpath.bind(fs),open=fs.open.bind(fs);let released=false;
 const spy=vi.spyOn(fs,'realpath').mockImplementation((async(...args:Parameters<typeof fs.realpath>)=>{if(String(args[0])===lock&&!released)return path.dirname(root);return realpath(...args);}) as typeof fs.realpath);
 const opening=vi.spyOn(fs,'open').mockImplementation(async(file,flags,mode)=>{if(String(file)===lock&&!released){released=true;await fs.unlink(lock);}return open(file,flags,mode);});
 try{await expect(withRunLock(root,async()=>42)).resolves.toBe(42);}finally{spy.mockRestore();opening.mockRestore();}
}));
