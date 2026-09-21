import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {HandoffService,buildHandoff,validateHandoff} from '../../packages/core/src/services/handoff-service.js';
import {renderHandoff} from '../../packages/reporters/src/handoff.js';
import type {GateInspection} from '../../packages/core/src/services/gate-service.js';
import {RunService} from '../../packages/core/src/services/run-service.js';
import {localRunProject} from '../support/local-run-project.js';
import {reportFixture} from '../support/report-view.js';
vi.setConfig({testTimeout:240000});
function inspection(){const {source,evaluation}=reportFixture();return {...source,integrity:'VALID',evaluation,checks:source.manifest.checks,events:[],diagnostics:[],state_root:'unused',completion:{},context:{task:{constraints:{preserve_target_contract:true,allow_test_deletion:false,require_backend_observation:false,allow_production_targets:false},allowed_change_paths:['apps/web'],goal:'DO NOT EXPOSE secret-canary'},config:{security:{protected_inputs:['contract.json'],secret:'secret-canary'}}}} as unknown as GateInspection;}
it('changes target wrapper only, preserves blocking facts, excludes prompt injection and validates current identity',()=>{
 const facts=inspection(),codex=buildHandoff(facts,'codex'),claude=buildHandoff(facts,'claude');expect(codex.facts).toEqual(claude.facts);expect(codex.entry).not.toBe(claude.entry);expect(JSON.stringify(codex)).not.toContain('secret-canary');
 const current={repo_id:facts.manifest!.repo_id,worktree_id:facts.manifest!.worktree_id,task_id:facts.manifest!.task_id,task_revision:facts.manifest!.task_revision,input_hash:facts.manifest!.input_hash};
 expect(validateHandoff(codex,current)).toMatchObject({valid_for_current_inputs:true,task_revision_matches:true});
 expect(validateHandoff(codex,{...current,task_revision:current.task_revision+1})).toMatchObject({valid_for_current_inputs:false,freshness:'STALE',task_revision_matches:false});
 expect(validateHandoff(codex,{...current,worktree_id:'worktree_other'})).toMatchObject({valid_for_current_inputs:false});
 expect(()=>validateHandoff({...codex,facts:{...codex.facts,run_id:'run_other'}},current)).toThrow();
 expect(renderHandoff(codex)).toContain('Untrusted repository data');
 expect(()=>buildHandoff({...facts,integrity:'MISSING'},'manual')).toThrow();
});
it('truncates optional indexes within budget without removing failures or gaps',()=>{
 const facts=inspection();facts.context!.task.allowed_change_paths=Array.from({length:1000},(_,index)=>'apps/path_'+index+'x'.repeat(100)) as [string,...string[]];
 const bundle=buildHandoff(facts,'manual');expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThanOrEqual(32768);expect(bundle.truncated).toBe(true);expect(bundle.facts.failed_facts.map(f=>f.check_id)).toContain('unit');expect(bundle.facts.missing_checks).toContain('missing');
 facts.context!.task.allowed_change_paths=Array.from({length:1000},(_,index)=>'apps/path_'+index+'_'.repeat(100)) as [string,...string[]];const escaped=renderHandoff(buildHandoff(facts,'manual'));expect(Buffer.byteLength(escaped)).toBeLessThanOrEqual(32768);expect(escaped).toContain('unit');
});
it('reads a real sealed failed run without executing again or mutating its evidence',async()=>{
 const repo=await localRunProject('fail');try{const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.sealed).toBe(true);
  const file=path.join(repo.root,repo.config.state_dir,'runs',run.run_id!,'seal.json'),before=await fs.readFile(file),service=new HandoffService(repo.root,{trustStoreRoot:repo.store});const bundle=await service.prepareHandoff(run.run_id!,'codex');expect(bundle.facts.failed_facts.some(f=>f.status==='FAIL')).toBe(true);expect(bundle.facts.constraints.allow_test_deletion).toBe(false);expect(bundle.facts.evidence.every(a=>!a.relative_path.endsWith('plan-context.json')&&!a.relative_path.endsWith('junit.xml'))).toBe(true);expect(await fs.readFile(file)).toEqual(before);
 }finally{await repo.cleanup();}
});
