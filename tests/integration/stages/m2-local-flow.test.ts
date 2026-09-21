import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {localRunProject} from '../../support/local-run-project.js';
import {RunService} from '../../../packages/core/src/services/run-service.js';
import {GateService} from '../../../packages/core/src/services/gate-service.js';
vi.setConfig({testTimeout:240000});
for(const mode of ['zero','missing'] as const)it(`M2 real ${mode} JUnit run remains sealed but cannot be allowed`,async()=>{
 const repo=await localRunProject(mode);try{const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store}).execute(plan.plan_id);expect(run.sealed).toBe(true);expect(run.evaluation).toMatchObject({verdict:'INCOMPLETE',freshness:'FRESH',decision:'DENY',exit_code:2});expect(run.manifest?.checks.find(check=>check.check_id==='unit')).toMatchObject({status:'BLOCKED',executed_tests:0});const gate=await new GateService(repo.root,{trustStoreRoot:repo.store}).inspect(run.run_id!);expect(gate.evaluation.exit_code).toBe(2);}finally{await repo.cleanup();}
});
it('M2 caller cancellation after the business process starts preserves denying sealed evidence',async()=>{
 const repo=await localRunProject('timeout');let observer:Promise<void>|undefined,observed=false;const controller=new AbortController();
 try{const plan=await repo.createPlan(),run=await new RunService(repo.root,{trustStoreRoot:repo.store,onEvent:event=>{
  if(event.type!=='check.started'||event.payload.check_id!=='unit')return;
  const marker=path.join(repo.root,repo.config.state_dir,'work',event.run_id,event.payload.check_id,event.payload.attempt_id,'started.marker');
  observer=(async()=>{const deadline=Date.now()+60000;while(Date.now()<deadline){try{if((await fs.readFile(marker,'utf8'))==='business process started'){observed=true;controller.abort();return;}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Business start was never observed');})();
 }}).execute(plan.plan_id,{signal:controller.signal});await observer;expect(observed).toBe(true);expect(run.sealed).toBe(true);expect(run.manifest?.phase).toBe('CANCELED');expect(run.evaluation).toMatchObject({verdict:'INCOMPLETE',decision:'DENY',exit_code:2});expect(run.manifest?.checks.find(check=>check.check_id==='unit')?.reasons).toContain('COMMAND_CANCELED');
 }finally{controller.abort();await observer?.catch(()=>{});await repo.cleanup();}
});
