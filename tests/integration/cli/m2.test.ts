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
it('separates a failing real run exit from the read-only report exit at the CLI boundary',async()=>{
 const repo=await localRunProject('fail',{confirmed:false});try{
  const validation=invoke(repo.root,['task','validate','--file',repo.taskFile],0);invoke(repo.root,['task','confirm','--file',repo.taskFile,'--confirm-digest',validation.data.confirmation_digest],0);
  const review=invoke(repo.root,['trust','--review'],0);invoke(repo.root,['trust','--review','--confirm-digest',review.data.execution_digest],0);
  const plan=invoke(repo.root,['plan','--task',repo.taskFile,'--profile','local'],0).data;
  const run=invoke(repo.root,['run','--plan',plan.plan_id],1).data;
  expect(run.gate).toMatchObject({verdict:'FAIL',decision:'DENY',exit_code:1});
  expect(run.sealed).toBe(true);
  for(const format of ['json','markdown','junit'])expect(invoke(repo.root,['report','--run',run.run_id,'--format',format],0).data.gate.decision).toBe('DENY');
  expect(invoke(repo.root,['gate','--run',run.run_id,'--strict'],1).data.gate.exit_code).toBe(1);
  // Absent evidence is INCOMPLETE/2 at the CLI boundary, never a silent zero.
  expect(invoke(repo.root,['report','--run','run_absent_marker'],2).runtime).toBe('NOT_EXECUTED');
  const check=run.manifest.checks.find((item:{check_id:string})=>item.check_id==='unit');expect(check.status).toBe('FAIL');expect(check.raw_exit_code).not.toBe(0);
 }finally{await repo.cleanup();}
});
it('exposes strict M2 command argument validation in the built CLI',()=>{
 const result=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'});expect(result.stdout).toContain('run --plan');for(const args of [['run'],['gate','--run','../escape'],['report','--run','run_demo','--format','html'],['plan','--profile','local'],['clean','--run','run_demo','--apply'],['handoff'],['handoff','--run','run_demo','--validate','bundle.json'],['handoff','--validate'],['handoff','--validate','bundle.json','--output','out.md']]){const child=spawnSync(process.execPath,[cli,...args,'--json'],{encoding:'utf8'});expect(child.status).toBe(64);expect(JSON.parse(child.stdout).ok).toBe(false);}
});
it('runs the built CLI through plan, real run, report, gate and stale reevaluation',async()=>{
 const repo=await localRunProject('pass',{confirmed:false});try{
  const validation=invoke(repo.root,['task','validate','--file',repo.taskFile],0);invoke(repo.root,['task','confirm','--file',repo.taskFile,'--confirm-digest',validation.data.confirmation_digest],0);
  const review=invoke(repo.root,['trust','--review'],0);invoke(repo.root,['trust','--review','--confirm-digest',review.data.execution_digest],0);
  const plan=invoke(repo.root,['plan','--task',repo.taskFile,'--profile','local'],0).data;
  const run=invoke(repo.root,['run','--plan',plan.plan_id],0).data;expect(run.run_id).toMatch(/^run_/);expect(run.gate.decision).toBe('ALLOW');
  expect(invoke(repo.root,['gate','--run',run.run_id,'--strict'],0).data.gate.decision).toBe('ALLOW');
  for(const format of ['json','terminal','markdown','junit']){const report=invoke(repo.root,['report','--run',run.run_id,'--format',format],0);expect(report.runtime).toBe('NOT_EXECUTED');expect(report.data.gate.decision).toBe('ALLOW');}
  const handoff=invoke(repo.root,['handoff','--run',run.run_id,'--target','codex'],0);
  expect(handoff.data).toMatchObject({handoff_id:expect.any(String),handoff_json_path:expect.any(String),handoff_markdown_path:expect.any(String),freshness:'FRESH'});
  const jsonPath=path.join(repo.root,handoff.data.handoff_json_path),markdownPath=path.join(repo.root,handoff.data.handoff_markdown_path);
  expect(handoff.data.handoff_json_path.startsWith(repo.config.state_dir+'/handoffs/')).toBe(true);
  const bundleBytes=await fs.readFile(jsonPath),sealedManifest=path.join(repo.root,repo.config.state_dir,'runs',run.run_id,'seal.json'),sealBefore=await fs.readFile(sealedManifest);
  expect(JSON.parse(bundleBytes.toString())).toMatchObject({handoff_id:handoff.data.handoff_id,target:'codex'});
  expect((await fs.readFile(markdownPath)).toString()).toContain('Untrusted repository data');
  expect(await fs.readFile(sealedManifest)).toEqual(sealBefore);
  const repeat=invoke(repo.root,['handoff','--run',run.run_id,'--target','codex'],0);expect(repeat.data.handoff_id).toBe(handoff.data.handoff_id);await expect(fs.readFile(jsonPath)).resolves.toEqual(bundleBytes);
  expect(invoke(repo.root,['handoff','--validate',path.relative(repo.root,jsonPath)],0).data).toMatchObject({valid_for_current_inputs:true,freshness:'FRESH',task_revision_matches:true,reasons:[]});
  await fs.writeFile(path.join(repo.root,'apps/web/new-cli-source.ts'),'export const changed = true');expect(invoke(repo.root,['gate','--run',run.run_id],4).data.gate.freshness).toBe('STALE');expect(invoke(repo.root,['report','--run',run.run_id,'--format','markdown'],0).data.gate.decision).toBe('DENY');
  const stale=invoke(repo.root,['handoff','--validate',jsonPath],0);expect(stale.data).toMatchObject({valid_for_current_inputs:false,freshness:'STALE'});expect(stale.data.reasons).toContain('INPUT_HASH_MISMATCH');
  const corrupt=path.join(repo.root,'corrupt-handoff.json');await fs.writeFile(corrupt,bundleBytes.toString().replace(/"task_revision":\s*\d+/,'"task_revision": 99'));
  expect(invoke(repo.root,['handoff','--validate',corrupt],3).data).toBeUndefined();
  // A received Markdown rendering is prose: it never parses as a versioned bundle, so it fails
  // structurally at 64, while a parseable but tampered bundle fails as an integrity error at 3.
  const markdownAttempt=invoke(repo.root,['handoff','--validate',markdownPath],64);expect(markdownAttempt.data).toBeUndefined();
  const plans=path.join(repo.root,repo.config.state_dir,'plans');await fs.rename(plans,plans+'-hidden');
  expect(invoke(repo.root,['handoff','--validate',jsonPath],0).data).toMatchObject({valid_for_current_inputs:false,freshness:'STALE',reasons:['CURRENT_IDENTITY_UNAVAILABLE']});
 }finally{await repo.cleanup();}
});
