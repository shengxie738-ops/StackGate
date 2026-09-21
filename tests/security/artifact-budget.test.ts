import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EvidenceBudget,BudgetedArtifactWriter} from '../../packages/core/src/evidence/budget.js';
import {RedactionStream} from '../../packages/core/src/evidence/redaction.js';
import {FileEvidenceStore} from '../../packages/core/src/storage/file-evidence-store.js';
import {withTestDirectory} from '../support/test-paths.js';
import type {RunManifest} from '../../packages/contracts/src/index.js';
const manifest=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8')) as RunManifest;
it('reserves structure capacity and fails critical reports rather than truncating them',()=>{
 const budget=new EvidenceBudget({totalBytes:100,reservedCriticalBytes:20});expect(budget.retain(Buffer.alloc(90),false)).toMatchObject({original_bytes:90,retained_bytes:80,truncated:true,reason:'ARTIFACT_BUDGET_EXCEEDED'});
 expect(budget.retain(Buffer.alloc(15),true)).toMatchObject({retained_bytes:15,truncated:false});expect(()=>budget.retain(Buffer.alloc(6),true)).toThrow(/ARTIFACT_BUDGET_EXCEEDED/);
});
it('retains valid UTF-8 under truncation and reports exact bytes',()=>{const budget=new EvidenceBudget({totalBytes:5,reservedCriticalBytes:0}),result=budget.retain(Buffer.from('中文'),false);expect(new TextDecoder('utf8',{fatal:true}).decode(result.bytes)).toBe('中');expect(result).toMatchObject({original_bytes:6,retained_bytes:3,truncated:true});});
it('ordinary evidence never receives unredacted logs; restricted binary remains excluded',()=>withTestDirectory(async root=>{
 const store=new FileEvidenceStore({stateRoot:root,owner:{repo_id:manifest.repo_id,worktree_id:manifest.worktree_id}});await store.createRun({...manifest,phase:'CREATED',verdict:'INCOMPLETE',checks:[],artifact_refs:[]});
 const writer=new BudgetedArtifactWriter(store,{run_id:manifest.run_id,check_id:'unit',attempt_id:'attempt_1'},new EvidenceBudget({totalBytes:400,reservedCriticalBytes:100}),['tiny-secret']);
 const artifact=await writer.store({name:'stdout.log',bytes:Buffer.from('Authorization: Bearer tiny-secret\n'+ 'z'.repeat(500)),media_type:'text/plain',artifact_kind:'log',sensitivity:'regular',redaction_state:'UNREDACTED'});
 const raw=await fs.readFile(path.join(root,'runs',manifest.run_id,artifact.relative_path),'utf8');expect(raw).not.toContain('tiny-secret');expect(artifact).toMatchObject({redaction_state:'REDACTED',retention:{original_bytes:534,retained_bytes:300,truncated:true,reason:'ARTIFACT_BUDGET_EXCEEDED',critical:false}});
 await expect(writer.store({name:'report.xml',bytes:Buffer.from('x'.repeat(101)),media_type:'application/xml',artifact_kind:'report',sensitivity:'regular',redaction_state:'NOT_REQUIRED'})).rejects.toThrow(/ARTIFACT_BUDGET_EXCEEDED/);
 const screenshot=await writer.store({name:'page.png',bytes:Buffer.from([0,1]),media_type:'image/png',artifact_kind:'screenshot',sensitivity:'restricted',redaction_state:'UNKNOWN'});expect(screenshot.relative_path).toMatch(/^restricted\//);
}));
it('preserves valid structured JSON while redacting secret header keys recursively',()=>withTestDirectory(async root=>{
 const store=new FileEvidenceStore({stateRoot:root,owner:{repo_id:manifest.repo_id,worktree_id:manifest.worktree_id}});await store.createRun({...manifest,phase:'CREATED',checks:[],artifact_refs:[]});
 const writer=new BudgetedArtifactWriter(store,{run_id:manifest.run_id,check_id:null,attempt_id:null},new EvidenceBudget());
 const artifact=await writer.store({name:'report.json',bytes:Buffer.from('{"headers":{"Authorization":"HEADER_CANARY","Cookie":"COOKIE_CANARY","Set-Cookie":"SESSION_CANARY"},"password":"DB_CANARY","safe":42}'),media_type:'application/json',artifact_kind:'report',sensitivity:'regular',redaction_state:'UNREDACTED'});
 const raw=await fs.readFile(path.join(root,'runs',manifest.run_id,artifact.relative_path),'utf8');expect(raw).not.toMatch(/HEADER_CANARY|COOKIE_CANARY|SESSION_CANARY|DB_CANARY/);expect(JSON.parse(raw)).toMatchObject({safe:42,headers:{Authorization:'[REDACTED]'}});
}));
it('streamed raw counts and discarded long lines remain visible in stored metadata',()=>withTestDirectory(async root=>{
 const store=new FileEvidenceStore({stateRoot:root,owner:{repo_id:manifest.repo_id,worktree_id:manifest.worktree_id}});await store.createRun({...manifest,phase:'CREATED',checks:[],artifact_refs:[]});
 const stream=new RedactionStream(['CREDENTIAL'],{maxLineBytes:32}),chunks=['Authorization: CREDENTIAL\n','x'.repeat(100)+'\n'],safe=chunks.map(c=>stream.push(Buffer.from(c))).join('')+stream.finish();
 const writer=new BudgetedArtifactWriter(store,{run_id:manifest.run_id,check_id:null,attempt_id:null},new EvidenceBudget());const artifact=await writer.store({name:'stream.log',bytes:Buffer.from(safe),media_type:'text/plain',artifact_kind:'log',sensitivity:'regular',redaction_state:'REDACTED',retention:stream.retention()});
 expect(artifact.retention).toMatchObject({original_bytes:Buffer.byteLength(chunks.join('')),retained_bytes:artifact.size,truncated:true,reason:'REDACTION_LINE_LIMIT'});expect(await fs.readFile(path.join(root,'runs',manifest.run_id,artifact.relative_path),'utf8')).not.toContain('CREDENTIAL');
}));
it('preserves sensitive XML original bytes only in restricted evidence',()=>withTestDirectory(async root=>{
 const store=new FileEvidenceStore({stateRoot:root,owner:{repo_id:manifest.repo_id,worktree_id:manifest.worktree_id}});await store.createRun({...manifest,phase:'CREATED',checks:[],artifact_refs:[]});const writer=new BudgetedArtifactWriter(store,{run_id:manifest.run_id,check_id:null,attempt_id:null},new EvidenceBudget());
 const bytes=Buffer.from('<testsuite><testcase><failure>Authorization: private-token</failure></testcase></testsuite>');const artifact=await writer.store({name:'junit.xml',bytes,media_type:'application/xml',artifact_kind:'report',sensitivity:'regular',redaction_state:'UNREDACTED'});
 expect(artifact.sensitivity).toBe('restricted');expect(artifact.redaction_state).toBe('UNREDACTED');expect(await fs.readFile(path.join(root,'runs',manifest.run_id,artifact.relative_path))).toEqual(bytes);
}));
