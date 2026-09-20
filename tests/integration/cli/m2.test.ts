import {expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import {localRunProject} from '../../support/local-run-project.js';
// This flow authenticates current inputs separately for every public command;
// its aggregate harness deadline is independent of each business command timeout.
vi.setConfig({testTimeout:600000});
const cli=path.resolve('dist/cli.mjs');
function invoke(root:string,args:string[],expected:number){const result=spawnSync(process.execPath,[cli,...args,'--root',root,'--json'],{encoding:'utf8',timeout:180000,windowsHide:true});expect(result.status,result.stderr+'\n'+result.stdout).toBe(expected);const value=JSON.parse(result.stdout);expect(value).toMatchObject({schema_version:'0.1',exit_code:expected,ok:expected===0});return value;}
it('exposes strict M2 command argument validation in the built CLI',()=>{
 const result=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'});expect(result.stdout).toContain('run --plan');for(const args of [['run'],['gate','--run','../escape'],['report','--run','run_demo','--format','html'],['plan','--profile','local'],['clean','--run','run_demo','--apply']]){const child=spawnSync(process.execPath,[cli,...args,'--json'],{encoding:'utf8'});expect(child.status).toBe(64);expect(JSON.parse(child.stdout).ok).toBe(false);}
});
it('runs the built CLI through plan, real run, report, gate and stale reevaluation',async()=>{
 const repo=await localRunProject('pass',{confirmed:false});try{
  const validation=invoke(repo.root,['task','validate','--file',repo.taskFile],0);invoke(repo.root,['task','confirm','--file',repo.taskFile,'--confirm-digest',validation.data.confirmation_digest],0);
  const review=invoke(repo.root,['trust','--review'],0);invoke(repo.root,['trust','--review','--confirm-digest',review.data.execution_digest],0);
  const plan=invoke(repo.root,['plan','--task',repo.taskFile,'--profile','local'],0).data;
  const run=invoke(repo.root,['run','--plan',plan.plan_id],0).data;expect(run.run_id).toMatch(/^run_/);expect(run.gate.decision).toBe('ALLOW');
  expect(invoke(repo.root,['gate','--run',run.run_id,'--strict'],0).data.gate.decision).toBe('ALLOW');
  for(const format of ['json','terminal','markdown','junit']){const report=invoke(repo.root,['report','--run',run.run_id,'--format',format],0);expect(report.runtime).toBe('NOT_EXECUTED');expect(report.data.gate.decision).toBe('ALLOW');}
  const handoff=invoke(repo.root,['handoff','--run',run.run_id,'--target','codex'],0);expect(handoff.data).toBeDefined();
  await fs.writeFile(path.join(repo.root,'apps/web/new-cli-source.ts'),'export const changed = true');expect(invoke(repo.root,['gate','--run',run.run_id],4).data.gate.freshness).toBe('STALE');expect(invoke(repo.root,['report','--run',run.run_id,'--format','markdown'],0).data.gate.decision).toBe('DENY');
 }finally{await repo.cleanup();}
});
