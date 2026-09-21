import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readVersionedDocument} from '../../packages/core/src/storage/schema-reader.js';
import {exportBundle,writeExportBundle} from '../../packages/core/src/storage/export-bundle.js';
import {inspectToolProvenance} from '../../packages/core/src/domain/tool-provenance.js';
import {FileEvidenceStore} from '../../packages/core/src/storage/file-evidence-store.js';
import {withTestDirectory} from '../support/test-paths.js';
import type {RunManifest,RunEvent} from '../../packages/contracts/src/index.js';
const json=(value:unknown)=>Buffer.from(JSON.stringify(value));
const read=async(file:string)=>JSON.parse(await fs.readFile(file,'utf8'));
it('rejects unsupported versions, undeclared fields, invalid UTF8 and duplicate JSON keys',async()=>{
 const artifact=await read('tests/fixtures/protocols/artifact.json');
 expect(readVersionedDocument(json({...artifact,schema_version:'2.0'}),'artifact')).toMatchObject({status:'UNSUPPORTED_VERSION'});
 expect(readVersionedDocument(json({...artifact,schema_version:'0.2'}),'artifact')).toMatchObject({status:'UNSUPPORTED_VERSION'});
 expect(readVersionedDocument(json({...artifact,new_field:1}),'artifact')).toMatchObject({status:'INVALID'});
 expect(readVersionedDocument(Buffer.from([255]),'artifact')).toMatchObject({status:'INVALID'});
 expect(readVersionedDocument(Buffer.from('{"schema_version":"0.1","schema_version":"2.0"}'),'artifact')).toMatchObject({status:'INVALID'});
 const config=await read('tests/fixtures/config/original.json');expect(readVersionedDocument(json({...config,new_field:1}),'project-config')).toMatchObject({status:'INVALID'});
});
it('preserves declared extensions and converts supported older optional-retention views without changing source bytes',async()=>{
 const task=await read('tests/fixtures/tasks/draft.json');const extension={vendor:{label:'retained'}};
 expect(readVersionedDocument(json({...task,extensions:extension}),'task')).toMatchObject({status:'SUPPORTED',document:{extensions:extension}});
 const bytes=await fs.readFile('tests/fixtures/protocols/artifact.json'),original=Buffer.from(bytes),result=readVersionedDocument(bytes,'artifact');
 expect(result).toMatchObject({status:'SUPPORTED',source_schema_version:'0.1',conversion:{id:'artifact-retention-view',version:'1'},view:{retention:null}});expect(bytes).toEqual(original);
});
it('requires explicit exact core and command versions and never assumes UNKNOWN or latest succeeds',()=>{
 const versions={node:'24.11.1',stackgate:'0.1.0',typescript:'5.9.3',oasdiff:'1.11.7',command_unit:'24.11.1'};
 expect(inspectToolProvenance(versions,['unit'])).toMatchObject({complete:true,diagnostics:[]});
 for(const value of ['UNKNOWN','latest','unknown-but-assumed',''])expect(inspectToolProvenance({...versions,oasdiff:value},['unit'])).toMatchObject({complete:false,versions:{oasdiff:'UNKNOWN'}});
 expect(inspectToolProvenance(versions,['missing'])).toMatchObject({complete:false,versions:{command_missing:'UNKNOWN'}});
 expect(inspectToolProvenance({...versions,command_auxiliary:'UNKNOWN'},['unit'])).toMatchObject({complete:false});
});
it('exports only verified safe artifacts to a new directory, preserving exact sealed source bytes',()=>withTestDirectory(async root=>{
 const state=path.join(root,'state');await fs.mkdir(state);const sample=await read('tests/fixtures/protocols/run.json') as RunManifest;
 const store=new FileEvidenceStore({stateRoot:state,owner:{repo_id:sample.repo_id,worktree_id:sample.worktree_id}});
 let manifest:RunManifest={...sample,phase:'CREATED',checks:[],artifact_refs:[],verdict:'INCOMPLETE',canceled:false};await store.createRun(manifest);
 const scope={run_id:manifest.run_id,check_id:null,attempt_id:null};
 const safe=await store.store(scope,{kind:'artifact',value:{name:'stdout.log',bytes:Buffer.from('safe original bytes\r\n'),media_type:'text/plain',artifact_kind:'log',sensitivity:'regular',redaction_state:'REDACTED'}});
 const secret=await store.store(scope,{kind:'artifact',value:{name:'trace.txt',bytes:Buffer.from('private trace'),media_type:'text/plain',artifact_kind:'log',sensitivity:'restricted',redaction_state:'UNREDACTED'}});
 let seq=0;const append=async(type:string,payload:unknown)=>expect(await store.append({schema_version:'0.1',run_id:sample.run_id,event_id:'event_'+(++seq),seq,at:sample.created_at,type,payload} as RunEvent)).toMatchObject({status:'APPENDED'});
 await append('run.started',{payload_version:'0.1',plan_id:manifest.plan_id,input_hash:manifest.input_hash});for(const artifact of [safe,secret])await append('artifact.saved',{payload_version:'0.1',artifact});
 for(const phase of ['PLANNED','RUNNING','FINALIZING','COMPLETED'] as const){const previous=await store.readRun(manifest.run_id);manifest={...manifest,phase,artifact_refs:[safe.artifact_id,secret.artifact_id]};await store.updateManifest(manifest,previous.manifest_hash!);}
 await append('run.finalized',{payload_version:'0.1',phase:'COMPLETED',verdict:'INCOMPLETE'});expect((await store.seal({run_id:manifest.run_id,input_hash:manifest.input_hash,required_artifact_ids:manifest.artifact_refs})).status).toBe('SEALED');
 const source=path.join(state,'runs',manifest.run_id),originalSeal=await fs.readFile(path.join(source,'seal.json'));
 const plan=await exportBundle(store,{run_id:manifest.run_id});expect(plan.files.map(file=>file.artifact.artifact_id)).toEqual([safe.artifact_id]);expect(plan.excluded.map(file=>file.artifact_id)).toContain(secret.artifact_id);
 await expect(writeExportBundle(plan,{root:source,directory:'export-inside-sealed-run'})).rejects.toThrow();
 await writeExportBundle(plan,{root,directory:'export'});expect(await fs.readFile(path.join(root,'export',safe.relative_path))).toEqual(await fs.readFile(path.join(source,safe.relative_path)));await expect(fs.stat(path.join(root,'export',secret.relative_path))).rejects.toThrow();
 await expect(writeExportBundle(plan,{root,directory:'export'})).rejects.toThrow();expect(await fs.readFile(path.join(source,'seal.json'))).toEqual(originalSeal);expect((await store.verifyRun(manifest.run_id)).status).toBe('VALID');
 await fs.appendFile(path.join(source,safe.relative_path),'changed');await expect(exportBundle(store,{run_id:manifest.run_id})).rejects.toThrow();
}));
