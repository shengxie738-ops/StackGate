import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {ProjectConfig,RunManifest} from '../../../packages/contracts/src/index.js';
import {FileEvidenceStore} from '../../../packages/core/src/storage/file-evidence-store.js';
import {inspectRepository} from '../../../packages/adapter-git/src/repository.js';
import {GateService} from '../../../packages/core/src/services/gate-service.js';
import {RunService} from '../../../packages/core/src/services/run-service.js';
import {localRunProject} from '../../support/local-run-project.js';
vi.setConfig({testTimeout:240000});
it('missing run evidence remains unverified and cannot be allowed',async()=>{const repo=await localRunProject('pass',{confirmed:false});try{const gate=await new GateService(repo.root,{trustStoreRoot:repo.store}).inspect('run_missing');expect(gate.integrity).toBe('MISSING');expect(gate.evaluation).toMatchObject({decision:'DENY',exit_code:2});}finally{await repo.cleanup();}});
it('stores a missing-run evaluation outside runs without inventing a run directory',async()=>{const repo=await localRunProject('pass',{confirmed:false});try{const gate=await new GateService(repo.root,{trustStoreRoot:repo.store}).evaluate('run_missing');expect(gate.evaluation.exit_code).toBe(2);expect(JSON.parse(await fs.readFile(gate.evaluation_path,'utf8')).decision).toBe('DENY');await expect(fs.lstat(path.join(repo.root,repo.config.state_dir,'runs','run_missing'))).rejects.toMatchObject({code:'ENOENT'});}finally{await repo.cleanup();}});
it('retains actual unsealed lifecycle prefixes and distinguishes an aborted run from pending work',async()=>{
 const repo=await localRunProject('pass',{confirmed:false});try{const owner=await inspectRepository(repo.root),store=new FileEvidenceStore({stateRoot:path.join(repo.root,repo.config.state_dir),owner}),template:RunManifest=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8'));
  for(const phase of ['CREATED','RUNNING','ABORTED'] as const){let manifest:RunManifest={...template,run_id:'run_prefix_'+phase,repo_id:owner.repo_id,worktree_id:owner.worktree_id,phase:'CREATED',verdict:'INCOMPLETE',checks:[],artifact_refs:[],started_at:null,finished_at:null,canceled:false};await store.createRun(manifest);
   for(const next of phase==='RUNNING'?['PLANNED','RUNNING'] as const:phase==='ABORTED'?['ABORTED'] as const:[]){const snapshot=await store.readRun(manifest.run_id);manifest={...manifest,phase:next,verdict:next==='ABORTED'?'ERROR':'INCOMPLETE',finished_at:next==='ABORTED'?new Date().toISOString():null};await store.updateManifest(manifest,snapshot.manifest_hash!);}
   const observed=await new GateService(repo.root,{trustStoreRoot:repo.store}).inspect(manifest.run_id);expect(observed.manifest?.phase).toBe(phase);expect(observed.plan).toBeNull();expect(observed.evaluation).toMatchObject({decision:'DENY',exit_code:phase==='ABORTED'?3:2});
  }
 }finally{await repo.cleanup();}
});
it('authenticates a real sealed run then reevaluates source, task, policy and evidence without changing historical facts',async()=>{
 const repo=await localRunProject();try{
  const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.evaluation.decision).toBe('ALLOW');
  const service=new GateService(repo.root,{trustStoreRoot:repo.store}),runRoot=path.join(repo.root,repo.config.state_dir,'runs',run.run_id!),manifestFile=path.join(runRoot,'manifest.json'),before=await fs.readFile(manifestFile);
  const first=await service.inspect(run.run_id!);expect(first.evaluation).toMatchObject({verdict:'PASS',decision:'ALLOW',freshness:'FRESH',exit_code:0});expect(first.context?.selection_sources).toBeDefined();
  const persisted=await service.evaluate(run.run_id!);expect(persisted.evaluation_path).not.toContain(path.join('runs',run.run_id!));expect(JSON.parse(await fs.readFile(persisted.evaluation_path,'utf8')).run_id).toBe(run.run_id);
  const outsidePlan=path.join(repo.root,repo.config.state_dir,'plans',plan.plan_id),moved=outsidePlan+'-moved';await fs.rename(outsidePlan,moved);expect((await service.inspect(run.run_id!)).evaluation.decision).toBe('ALLOW');await fs.rename(moved,outsidePlan);
  const freshFile=path.join(repo.root,'apps/web/new-input.ts');await fs.writeFile(freshFile,'export const newer=true');expect((await service.inspect(run.run_id!)).evaluation).toMatchObject({freshness:'STALE',decision:'DENY',exit_code:4});await fs.unlink(freshFile);
  for(const file of [repo.taskFile,path.join(repo.root,'.stackgate.yaml')]){const bytes=await fs.readFile(file),value=JSON.parse(bytes.toString());if(file===repo.taskFile)value.revision++;else value.profiles.local.workspace_regression.web=['smoke','unit'];await fs.writeFile(file,JSON.stringify(value));expect((await service.inspect(run.run_id!)).evaluation).toMatchObject({freshness:'STALE',decision:'DENY',exit_code:4});await fs.writeFile(file,bytes);}
  const sealFile=path.join(runRoot,'seal.json'),seal=await fs.readFile(sealFile);await fs.unlink(sealFile);expect((await service.inspect(run.run_id!)).evaluation).toMatchObject({decision:'DENY',exit_code:2});await fs.writeFile(sealFile,seal);
  const log=first.artifacts.find(a=>a.relative_path.endsWith('/stdout.log'))!,logFile=path.join(runRoot,log.relative_path),logBefore=await fs.readFile(logFile);await fs.writeFile(logFile,'corrupted');await fs.writeFile(freshFile,'stale too');expect((await service.inspect(run.run_id!)).evaluation).toMatchObject({decision:'DENY',exit_code:3});await fs.writeFile(logFile,logBefore);await fs.unlink(freshFile);
  expect(await fs.readFile(manifestFile)).toEqual(before);
 }finally{await repo.cleanup();}
});
async function confirm(repo:Awaited<ReturnType<typeof localRunProject>>){const task=await repo.taskService.validate(repo.taskFile);expect(task.valid).toBe(true);await repo.taskService.confirm(repo.taskFile,task.confirmation_digest!,{authorized:true,source:'local-review'});const trust=await repo.trust.review();await repo.trust.confirm(trust.execution_digest,{authorized:true});}
it('keeps real failed evidence denied and detects changed executable bytes without launching that executable',async()=>{
 const repo=await localRunProject('fail',{confirmed:false});try{
  const executable=path.join(repo.store,process.platform==='win32'?'node.exe':'node');await fs.copyFile(process.execPath,executable);if(process.platform!=='win32')await fs.chmod(executable,0o700);
  for(const command of Object.values(repo.config.commands as ProjectConfig['commands']))command.exec=executable;await fs.writeFile(path.join(repo.root,'.stackgate.yaml'),JSON.stringify(repo.config));await confirm(repo);
  const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.evaluation.exit_code).toBe(1);const service=new GateService(repo.root,{trustStoreRoot:repo.store});expect((await service.inspect(run.run_id!)).evaluation).toMatchObject({verdict:'FAIL',freshness:'FRESH',decision:'DENY',exit_code:1});
  await fs.writeFile(executable,'changed executable identity, never executed by Gate');expect((await service.inspect(run.run_id!)).evaluation).toMatchObject({freshness:'STALE',decision:'DENY',exit_code:4});
 }finally{await repo.cleanup();}
});
it('does not turn local CI environment claims into required backend provenance',async()=>{
 const repo=await localRunProject('pass',{confirmed:false}),before=process.env.CI;try{
  repo.task.constraints.require_backend_observation=true;await fs.writeFile(repo.taskFile,JSON.stringify(repo.task));await confirm(repo);const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.evaluation.exit_code).toBe(2);
  process.env.CI='true';const gate=await new GateService(repo.root,{trustStoreRoot:repo.store}).inspect(run.run_id!);expect(gate.evaluation).toMatchObject({decision:'DENY',exit_code:2});expect(gate.evaluation.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');
 }finally{if(before===undefined)delete process.env.CI;else process.env.CI=before;await repo.cleanup();}
});
