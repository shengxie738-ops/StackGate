import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {GateService} from '../../../packages/core/src/services/gate-service.js';
import {RunService} from '../../../packages/core/src/services/run-service.js';
import {JunitAdapter} from '../../../packages/adapter-junit/src/junit-adapter.js';
import {localRunProject} from '../../support/local-run-project.js';

// A-03: Gate observes the current inputs before it re-collects evidence. A source change that lands
// during re-collection must not be certified with the earlier FRESH observation.
vi.setConfig({testTimeout:600000});

async function sealedPassRun(){const repo=await localRunProject();const plan=await repo.createPlan();const run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.evaluation.decision).toBe('ALLOW');return{repo,run_id:run.run_id!};}

it('keeps a normal sealed run allowed when the collector only observes, without changing inputs',async()=>{
 const {repo,run_id}=await sealedPassRun();const collect=JunitAdapter.prototype.collect;
 try{
  let observed=0;
  vi.spyOn(JunitAdapter.prototype,'collect').mockImplementation(async function(this: JunitAdapter, step, context){observed++;return collect.call(this,step,context);});
  const gate=await new GateService(repo.root,{trustStoreRoot:repo.store}).inspect(run_id);
  expect(observed).toBeGreaterThan(0);
  expect(gate.evaluation).toMatchObject({verdict:'PASS',decision:'ALLOW',freshness:'FRESH',exit_code:0});
 }finally{vi.restoreAllMocks();await repo.cleanup();}
});

it('refuses to certify a protected input that changed during evidence re-collection',async()=>{
 const {repo,run_id}=await sealedPassRun();const collect=JunitAdapter.prototype.collect;
 const target=path.join(repo.root,'apps/web/new-input.ts');
 try{
  let mutated=false;
  vi.spyOn(JunitAdapter.prototype,'collect').mockImplementationOnce(async function(this: JunitAdapter, step, context){
   mutated=true;
   await fs.writeFile(target,'export const changedDuringGate = true;\n');
   return collect.call(this,step,context);
  });
  const gate=await new GateService(repo.root,{trustStoreRoot:repo.store}).inspect(run_id);
  expect(mutated).toBe(true);
  expect(gate.evaluation).toMatchObject({decision:'DENY',freshness:'STALE',exit_code:4});
  expect(gate.evaluation.reasons).toContain('INPUT_CHANGED_DURING_AUTHENTICATION');
 }finally{vi.restoreAllMocks();await fs.rm(target,{force:true});await repo.cleanup();}
});

it('reports an unobservable current input as unverified instead of a tampered history',async()=>{
 const {repo,run_id}=await sealedPassRun();const collect=JunitAdapter.prototype.collect;
 try{
  vi.spyOn(JunitAdapter.prototype,'collect').mockImplementationOnce(async function(this: JunitAdapter, step, context){
   await fs.rm(path.join(repo.root,'.stackgate.yaml'));
   return collect.call(this,step,context);
  });
  const gate=await new GateService(repo.root,{trustStoreRoot:repo.store}).inspect(run_id);
  expect(gate.evaluation.decision).toBe('DENY');
  expect(['UNVERIFIED','STALE']).toContain(gate.evaluation.freshness);
  expect(gate.evaluation.exit_code).not.toBe(0);
 }finally{vi.restoreAllMocks();await repo.cleanup();}
});

it('leaves the sealed run bytes untouched while authenticating',async()=>{
 const {repo,run_id}=await sealedPassRun();
 const runRoot=path.join(repo.root,repo.config.state_dir,'runs',run_id);
 const before=await Promise.all(['manifest.json','seal.json'].map(name=>fs.readFile(path.join(runRoot,name))));
 const collect=JunitAdapter.prototype.collect;
 try{
  vi.spyOn(JunitAdapter.prototype,'collect').mockImplementationOnce(async function(this: JunitAdapter, step, context){await fs.writeFile(path.join(repo.root,'apps/web/late.ts'),'export const late = 1;\n');return collect.call(this,step,context);});
  await new GateService(repo.root,{trustStoreRoot:repo.store}).inspect(run_id);
 }finally{vi.restoreAllMocks();await fs.rm(path.join(repo.root,'apps/web/late.ts'),{force:true});}
 const after=await Promise.all(['manifest.json','seal.json'].map(name=>fs.readFile(path.join(runRoot,name))));
 expect(after.map(bytes=>bytes.toString('hex'))).toEqual(before.map(bytes=>bytes.toString('hex')));
});
