import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {CheckStep,RunManifest,ProbeReport} from '../../packages/contracts/src/index.js';
import {validateSchema} from '../../packages/contracts/src/index.js';
import {loadContract} from '../../packages/adapter-oasdiff/src/load-contract.js';
import {FileEvidenceStore} from '../../packages/core/src/storage/file-evidence-store.js';
import {collectProbe} from '../../packages/core/src/services/adapters/probe-adapter.js';
import {withTestDirectory} from '../support/test-paths.js';
const reportFixture=JSON.parse(await fs.readFile('tests/fixtures/protocols/probe.json','utf8')) as ProbeReport;
const runFixture=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8')) as RunManifest;
const contractBytes=await fs.readFile('tests/fixtures/contracts/target.json');
const step:CheckStep={step_id:'step_runtime',check_id:'runtime',adapter_id:'stackgate-probe',command_id:'probe',depends_on:[],required:true,timeout_ms:1000,resource_locks:[],expected_artifacts:['probe.json'],expected_test_ids:['total-return-is-number'],min_tests:1,parameters:{adapter_id:'stackgate-probe',required_operations:['api:GET /api/performance']}};
async function fixture(root:string,mutate:(report:ProbeReport)=>void=()=>{}){
 const store=new FileEvidenceStore({stateRoot:root,owner:{repo_id:runFixture.repo_id,worktree_id:runFixture.worktree_id}});await store.createRun({...runFixture,phase:'CREATED',verdict:'INCOMPLETE',checks:[],artifact_refs:[],environment_ref:null});
 const report=structuredClone(reportFixture);mutate(report);const artifact=await store.store({run_id:reportFixture.run_id,check_id:'runtime',attempt_id:'attempt_1'},{kind:'artifact',value:{name:'probe.json',bytes:Buffer.from(JSON.stringify(report)),media_type:'application/json',artifact_kind:'report',sensitivity:'regular',redaction_state:'NOT_REQUIRED'}});
 const target=loadContract(contractBytes,'contracts/target.json');
 return {store,artifact,request:{step,context:{run_id:reportFixture.run_id,check_id:'runtime',attempt_id:'attempt_1',expected_artifacts:['probe.json'],evidence:{read:store.read.bind(store)},signal:new AbortController().signal},report:artifact,targets:{api:target},target_hashes:{api:target.raw_hash.slice(7)},started_at:runFixture.created_at,finished_at:runFixture.created_at,raw_exit_code:0}};
}
it('revalidates retained response bytes rather than accepting script schema_valid=true',()=>withTestDirectory(async root=>{
 const f=await fixture(root,report=>{report.operations[0]!.response_body={data:{performance:{total_return:'invalid-number'}}};});const result=await collectProbe(f.request);expect(result.status).toBe('FAIL');expect(result.reasons).toContain('CONTRACT_MISMATCH');expect(result.evidence_refs).toContain(f.artifact.artifact_id);expect(validateSchema('check-result',result).ok).toBe(true);
}));
it('valid report claims remain blocked without authenticated backend provenance',()=>withTestDirectory(async root=>{
 const f=await fixture(root),result=await collectProbe(f.request);expect(result.status).toBe('BLOCKED');expect(result.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');expect(result).toMatchObject({discovered_tests:1,executed_tests:0,executed_test_ids:[]});expect(result.evidence_refs).toEqual([f.artifact.artifact_id]);
}));
it('health-only report does not satisfy the required business operation',()=>withTestDirectory(async root=>{
 const f=await fixture(root,r=>{r.operations[0]!.operation_key='api:GET /health';});const result=await collectProbe(f.request);expect(result.status).toBe('BLOCKED');expect(result.reasons).toContain('REQUIRED_OPERATION_MISSING:api:GET /api/performance');
}));
it.each(['run_id','check_id','attempt_id'] as const)('rejects historical or mismatched report %s',field=>withTestDirectory(async root=>{
 const f=await fixture(root,r=>{r[field]=field==='run_id'?'run_old':field==='attempt_id'?'attempt_old':'old';});expect((await collectProbe(f.request)).status).toBe('ERROR');
}));
it('rejects scope metadata mismatch and corrupt stored bytes',()=>withTestDirectory(async root=>{
 const f=await fixture(root);expect((await collectProbe({...f.request,report:{...f.artifact,attempt_id:'attempt_wrong'}})).status).toBe('ERROR');await fs.appendFile(path.join(root,'runs',runFixture.run_id,f.artifact.relative_path),' ');expect((await collectProbe(f.request)).status).toBe('ERROR');
}));
it('rejects conflicting request identities and duplicate assertion identities',()=>withTestDirectory(async root=>{
 const f=await fixture(root,r=>{r.operations.push({...structuredClone(r.operations[0]!),status_code:201});});expect((await collectProbe(f.request)).status).toBe('ERROR');
}));
it('retains incomplete markers, missing assertions and missing payload as explicit gaps',()=>withTestDirectory(async root=>{
 const f=await fixture(root,r=>{r.completed=false;r.operations[0]!.assertions=[];delete r.operations[0]!.response_body;});const result=await collectProbe(f.request);expect(result.status).toBe('BLOCKED');expect(result.reasons).toEqual(expect.arrayContaining(['REPORT_INCOMPLETE','REQUIRED_TEST_MISSING:total-return-is-number','RESPONSE_BODY_MISSING:api:GET /api/performance']));
}));
it('honors missing report, cancellation and missing process completion',()=>withTestDirectory(async root=>{
 const f=await fixture(root);expect((await collectProbe({...f.request,report:null})).reasons).toContain('MISSING_REPORT');expect((await collectProbe({...f.request,finished_at:null,raw_exit_code:null})).reasons).toContain('PROCESS_NOT_COMPLETED');const controller=new AbortController();controller.abort();expect((await collectProbe({...f.request,context:{...f.request.context,signal:controller.signal}})).reasons).toContain('CANCELED');
}));
it('refuses changed target identity and unsupported target schema',()=>withTestDirectory(async root=>{
 const f=await fixture(root);expect((await collectProbe({...f.request,target_hashes:{api:'0'.repeat(64)}})).status).toBe('ERROR');const doc=JSON.parse(contractBytes.toString());doc.paths['/api/performance'].get.responses['200'].content['application/json'].schema.if={};const target=loadContract(Buffer.from(JSON.stringify(doc)),'target.json');const result=await collectProbe({...f.request,targets:{api:target},target_hashes:{api:target.raw_hash.slice(7)}});expect(result.status).toBe('BLOCKED');expect(result.reasons).toContain('UNSUPPORTED_SCHEMA');
}));
it('failed assertions remain failures even without backend provenance',()=>withTestDirectory(async root=>{const f=await fixture(root,r=>{r.operations[0]!.assertions[0]!.passed=false;});const result=await collectProbe(f.request);expect(result.status).toBe('FAIL');expect(result.reasons).toContain('ASSERTION_FAILED:total-return-is-number');}));
it.each(['status','media'] as const)('revalidates response %s instead of accepting helper claims',field=>withTestDirectory(async root=>{const f=await fixture(root,r=>{if(field==='status')r.operations[0]!.status_code=404;else r.operations[0]!.media_type='text/plain';});expect((await collectProbe(f.request)).status).toBe('FAIL');}));
it('rejects repeated assertion IDs even when passed fields differ',()=>withTestDirectory(async root=>{const f=await fixture(root,r=>{r.operations[0]!.assertions.push({assertion_id:'total-return-is-number',passed:false});});const result=await collectProbe(f.request);expect(result.status).toBe('ERROR');expect(result.reasons).toContain('ASSERTION_IDENTITY_CONFLICT');}));
it('does not follow self-reported backend URLs and ignores false helper schema claims',()=>withTestDirectory(async root=>{
 const f=await fixture(root,r=>{r.operations[0]!.backend_observation_ref='https://untrusted.invalid/secrets';r.operations[0]!.schema_valid=false;});const paths:string[]=[];
 const result=await collectProbe({...f.request,context:{...f.request.context,evidence:{read:async request=>{paths.push(request.relative_path);return f.store.read(request);}}}});expect(result.status).toBe('BLOCKED');expect(paths).toEqual([f.artifact.relative_path]);expect(result.evidence_refs).toEqual([f.artifact.artifact_id]);
}));
