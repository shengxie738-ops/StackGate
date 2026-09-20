import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {withTestDirectory} from '../../support/test-paths.js';
import {taskProject} from '../../support/task-project.js';
vi.setConfig({testTimeout:180000});

// The individual audit regressions retain genuine RED evidence under M1-R01..R04.
// This end-to-end composition verifies their interoperability; no synthetic failure is injected.
it('relocated CLI combines confirmed task, bounded trust inputs, workspace fallback and honest static results',()=>withTestDirectory(async parent=>{
  const installation=path.join(parent,'迁移后的 安装'),repo=await taskProject();
  try{
    await fs.mkdir(installation);await fs.cp('dist',installation,{recursive:true});
    const executable=path.join(installation,'tools/bin/oasdiff-1.32.1/oasdiff.exe');
    await fs.mkdir(path.dirname(executable),{recursive:true});await fs.copyFile('tools/bin/oasdiff-1.32.1/oasdiff.exe',executable);
    const sentinel=path.join(repo.root,'EXECUTED');
    await fs.writeFile(path.join(repo.root,'package.json'),JSON.stringify({scripts:{postinstall:`node -e 'require("fs").writeFileSync(${JSON.stringify(sentinel)},"bad")'`}}));
    await fs.writeFile(path.join(repo.root,'.gitignore'),'node_modules/\n.venv/\n.stackgate/state/\n');
    for(const workspace of Object.values(repo.config.workspaces) as {path:string}[]){
      const directory=path.join(repo.root,workspace.path);await fs.mkdir(directory,{recursive:true});
      await fs.writeFile(path.join(directory,'sentinel.js'),`require('fs').writeFileSync(${JSON.stringify(sentinel)},'bad');`);
      await fs.writeFile(path.join(directory,'main.py'),`open(${JSON.stringify(sentinel)},'w').write('bad')`);
    }
    await fs.writeFile(path.join(repo.root,'apps/web/未知 消费者.ts'),'export const load = (url:string) => fetch(url);');
    for(const command of Object.values(repo.config.commands) as {exec:string;args:string[]}[]){command.exec=process.execPath;command.args=['sentinel.js'];}
    repo.config.profiles.integration.required_checks=['contract'];
    repo.config.profiles.integration.workspace_regression={web:['typecheck','unit'],api:['runtime']};
    repo.task.required_checks=['e2e'];
    await fs.writeFile(path.join(repo.root,'.stackgate.yaml'),JSON.stringify(repo.config));await fs.writeFile(repo.taskFile,JSON.stringify(repo.task));
    const targetPath=path.join(repo.root,'contracts/openapi.json'),target=JSON.parse(await fs.readFile(targetPath,'utf8'));
    target.paths['/api/performance'].get.responses['200'].content['application/json'].schema.properties.data.properties.performance.properties.total_return.type='string';
    await fs.writeFile(targetPath,JSON.stringify(target));
    function run(exit:number,...args:string[]){
      const result=spawnSync(process.execPath,[path.join(installation,'cli.mjs'),...args,'--root',repo.root,'--json'],{encoding:'utf8',timeout:120000});
      expect(result.status,result.stderr).toBe(exit);expect(result.stdout).not.toMatch(/\u001b/);
      const envelope=JSON.parse(result.stdout);expect(envelope).toMatchObject({schema_version:'0.1',ok:exit===0,exit_code:exit,runtime:'NOT_EXECUTED',diagnostics:expect.any(Array)});
      expect(envelope).not.toHaveProperty('decision');expect(envelope).not.toHaveProperty('verdict');return envelope;
    }
    const preview=run(0,'task','validate','--file',repo.taskFile).data;expect(preview.valid).toBe(true);
    expect(run(0,'task','confirm','--file',repo.taskFile,'--confirm-digest',preview.confirmation_digest).data.confirmation_digest).toBe(preview.confirmation_digest);
    const trust=run(0,'trust','--review').data;
    expect(trust.already_trusted).toBe(false);expect(trust.execution_preview.analysis_tools.oasdiff.status).toBe('VERIFIED');
    expect(trust.execution_preview.analysis_tools.oasdiff.tool.executable).toBe(executable);
    const scan=run(0,'scan','--base','HEAD','--task',repo.taskFile,'--profile','integration').data;
    expect(scan.contracts[0].compatibility.status).toBe('FAIL'); // Real relocated oasdiff observes the changed response type.
    expect(scan.selection.required_set).toEqual(['contract','e2e','runtime','typecheck','unit']);
    expect(scan.selection.selected_tests).toContainEqual({id:'performance-summary',sources:['task']});
    expect(scan.impacts.unresolved.length).toBeGreaterThan(0);expect(scan.coverage_gaps).toContainEqual(expect.objectContaining({code:'RUNTIME_NOT_EXECUTED'}));
    expect(scan.candidate_export).toBe('NOT_EXECUTED');expect(scan.contracts[0].runtime_validation.status).toBe('NOT_EXECUTED');
    expect(scan.acceptance_drift.some((finding:{decision:string})=>finding.decision==='DENY')).toBe(false);
    for(const directory of ['apps/web/node_modules','apps/api/.venv']){await fs.mkdir(path.join(repo.root,directory,'nested'),{recursive:true});await fs.writeFile(path.join(repo.root,directory,'nested/cache.js'),'rebuilt cache');}
    expect(run(0,'trust','--review').data.execution_digest).toBe(trust.execution_digest);
    await fs.appendFile(path.join(repo.root,'apps/web/sentinel.js'),'\n// changed executable input');
    expect(run(0,'trust','--review').data.execution_digest).not.toBe(trust.execution_digest);
    expect(run(64,'unknown').diagnostics[0].code).toBe('CONFIG_INVALID');
    expect(run(64,'task','confirm','--file',repo.taskFile).diagnostics[0].message).toContain('CONFIRMATION_REQUIRED');
    await expect(fs.access(sentinel)).rejects.toThrow();
  }finally{await repo.cleanup();}
}));
