import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {RunService} from '../../../packages/core/src/services/run-service.js';
import {FileEvidenceStore} from '../../../packages/core/src/storage/file-evidence-store.js';
import {localRunProject} from '../../support/local-run-project.js';
vi.setConfig({testTimeout:240000});
it('produces a sealed real command and JUnit run with complete lifecycle facts',async()=>{
 const repo=await localRunProject();try{
  const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);
  expect(run.evaluation,JSON.stringify({diagnostics:run.diagnostics,checks:run.manifest?.checks})).toMatchObject({verdict:'PASS',freshness:'FRESH',decision:'ALLOW',exit_code:0});expect(run.sealed).toBe(true);
  const manifest=run.manifest!;expect(manifest.environment_ref).toBeNull();expect(manifest.checks.find(c=>c.check_id==='unit')).toMatchObject({status:'PASS',executed_tests:1,executed_test_ids:['local-case']});
  const store=new FileEvidenceStore({stateRoot:path.join(repo.root,repo.config.state_dir),owner:manifest});expect((await store.verifyRun(manifest.run_id)).status).toBe('VALID');
  const snapshot=await store.readRun(manifest.run_id);expect(snapshot.events.at(-1)?.type).toBe('run.finalized');expect(snapshot.events.filter(e=>e.type==='run.phase_changed').map(e=>e.payload.to)).toEqual(['CREATED','PLANNED','RUNNING','FINALIZING','COMPLETED']);
 }finally{await repo.cleanup();}
});
it('rejects stale preflight without starting any business command',async()=>{
 const repo=await localRunProject();try{const plan=await repo.createPlan();await fs.writeFile(path.join(repo.root,'apps/web/new-source.ts'),'export const changed = true');const run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.evaluation).toMatchObject({freshness:'STALE',decision:'DENY',exit_code:4});expect(run.run_id).toBeNull();}finally{await repo.cleanup();}
});
it('keeps failed historical runs immutable when repeated',async()=>{
 const repo=await localRunProject('fail');try{const plan=await repo.createPlan(),service=new RunService(repo.root,{trustStoreRoot:repo.store}),first=await service.execute(plan.plan_id);expect(first.evaluation.exit_code).toBe(1);const file=path.join(repo.root,repo.config.state_dir,'runs',first.run_id!,'manifest.json'),before=await fs.readFile(file);const second=await service.execute(plan.plan_id,{previous_run_id:first.run_id!});expect(second.run_id).not.toBe(first.run_id);expect(second.manifest?.previous_run_id).toBe(first.run_id);expect(second.evaluation.exit_code).toBe(1);expect(await fs.readFile(file)).toEqual(before);}finally{await repo.cleanup();}
});
it('retains the original input identity and reports mutation during execution as stale',async()=>{
 const repo=await localRunProject('mutate-input');try{const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.evaluation).toMatchObject({freshness:'STALE',decision:'DENY',exit_code:4});expect(run.manifest?.input_hash).toBe(plan.input_hash);expect(run.sealed).toBe(true);}finally{await repo.cleanup();}
});
it('retains canceled required checks without launching a new process',async()=>{
 const repo=await localRunProject();try{const plan=await repo.createPlan(),controller=new AbortController();controller.abort();const run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id,{signal:controller.signal});expect(run.evaluation).toMatchObject({verdict:'INCOMPLETE',decision:'DENY',exit_code:2});expect(run.manifest?.phase).toBe('CANCELED');expect(run.manifest?.checks.map(c=>c.check_id).sort()).toEqual([...plan.required_check_ids].sort());}finally{await repo.cleanup();}
});
it('never allows a run when an event consumer fails after a completed check',async()=>{
 const repo=await localRunProject();try{const plan=await repo.createPlan();const run=await new RunService(repo.root,{trustStoreRoot:repo.store,onEvent:event=>{if(event.type==='check.finished')throw Error('Injected consumer failure');}}).execute(plan.plan_id);expect(run.evaluation).toMatchObject({verdict:'ERROR',decision:'DENY',exit_code:3});expect(run.sealed).toBe(false);const events=await fs.readFile(path.join(repo.root,repo.config.state_dir,'runs',run.run_id!,'events.jsonl'),'utf8');expect(events).toContain('check.finished');}finally{await repo.cleanup();}
});
it('detects source changes in the final event callback before returning current approval',async()=>{
 const repo=await localRunProject();try{const plan=await repo.createPlan();const run=await new RunService(repo.root,{trustStoreRoot:repo.store,onEvent:async event=>{if(event.type==='run.finalized')await fs.writeFile(repo.input,'{"numbers":[2,3],"expected":6}');}}).execute(plan.plan_id);expect(run.evaluation).toMatchObject({freshness:'STALE',decision:'DENY',exit_code:4});expect(run.sealed).toBe(true);}finally{await repo.cleanup();}
});
it('cancels during completion persistence without converting cancellation into a tool error',async()=>{
 const repo=await localRunProject();try{const plan=await repo.createPlan(),controller=new AbortController();const run=await new RunService(repo.root,{trustStoreRoot:repo.store,onEvent:event=>{if(event.type==='artifact.saved'&&event.payload.artifact.relative_path==='documents/run-completion.json')controller.abort();}}).execute(plan.plan_id,{signal:controller.signal});expect(run.evaluation).toMatchObject({verdict:'INCOMPLETE',decision:'DENY',exit_code:2});expect(run.manifest).toMatchObject({phase:'CANCELED',canceled:true,verdict:'INCOMPLETE'});expect(run.sealed).toBe(true);}finally{await repo.cleanup();}
});
