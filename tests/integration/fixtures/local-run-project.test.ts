import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {localRunProject} from '../../support/local-run-project.js';
vi.setConfig({testTimeout:60000});
it('builds a confirmed trusted local fixture whose actual assertion emits stable JUnit',async()=>{
 const f=await localRunProject('pass');try{
  expect((await f.trust.review()).already_trusted).toBe(true);expect(f.config.profiles.local.environment).toBeNull();expect(f.task.constraints.require_backend_observation).toBe(false);expect(f.task.required_test_ids).toEqual(['local-case']);
  const output=path.join(f.root,'.stackgate/state/fixture-output');await fs.mkdir(output,{recursive:true});
  const run=spawnSync(process.execPath,[f.script,'unit'],{cwd:path.dirname(f.script),env:{SystemRoot:process.env.SystemRoot,STACKGATE_OUTPUT_DIR:output},encoding:'utf8'});expect(run.status,run.stderr).toBe(0);
  const report=await fs.readFile(path.join(output,'junit.xml'),'utf8');expect(report).toContain('name="stackgate-id" value="local-case"');expect(report).toContain('tests="1" failures="0"');
 }finally{await f.cleanup();}
});
it('failure fixture reports a real mismatching calculation with process exit one',async()=>{
 const f=await localRunProject('fail',{confirmed:false});try{
  const output=path.join(f.root,'.stackgate/state/fixture-output');await fs.mkdir(output,{recursive:true});const run=spawnSync(process.execPath,[f.script,'unit'],{cwd:path.dirname(f.script),env:{SystemRoot:process.env.SystemRoot,STACKGATE_OUTPUT_DIR:output},encoding:'utf8'});
  expect(run.status).toBe(1);const report=await fs.readFile(path.join(output,'junit.xml'),'utf8');expect(report).toContain('failures="1"');expect(report).toContain('<failure');
 }finally{await f.cleanup();}
});
