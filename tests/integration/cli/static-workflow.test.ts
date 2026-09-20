import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {withTestDirectory} from '../../support/test-paths.js';
import {taskProject} from '../../support/task-project.js';
const cli=path.resolve('dist/cli.mjs');
vi.setConfig({testTimeout:180000});
export function runCli(root:string,...args:string[]){return spawnSync(process.execPath,[cli,...args,'--root',root,'--json'],{encoding:'utf8',timeout:120000});}
it('previews init without writes and applies only absent files preserving existing content',async()=>withTestDirectory(async parent=>{
  const root=path.join(parent,'中文 项目');await fs.mkdir(root);await fs.writeFile(path.join(root,'.gitignore'),'# user rules\nsecret/\n');
  const before=await fs.readdir(root),preview=runCli(root,'init','--preset','fastapi-react','--dry-run');expect(preview.status,preview.stderr).toBe(0);expect(await fs.readdir(root)).toEqual(before);
  const proposal=JSON.parse(preview.stdout).data;expect(proposal.files.some((f:{path:string})=>f.path==='.stackgate.yaml')).toBe(true);expect(proposal.gitignore_patch).toContain('.stackgate/state/');
  const applied=runCli(root,'init','--preset','fastapi-react','--apply');expect(applied.status,applied.stderr).toBe(0);const config=await fs.readFile(path.join(root,'.stackgate.yaml'));
  expect(JSON.parse(await fs.readFile(path.join(root,'.stackgate/tasks/example.json'),'utf8')).status).toBe('DRAFT');expect(await fs.readFile(path.join(root,'.gitignore'),'utf8')).toContain('# user rules\nsecret/\n');
  const twice=runCli(root,'init','--preset','fastapi-react','--apply');expect(twice.status,twice.stderr).toBe(0);expect(JSON.parse(twice.stdout).data.conflicts).toContain('.stackgate.yaml');expect(await fs.readFile(path.join(root,'.stackgate.yaml'))).toEqual(config);
}));
it('task and trust machine previews implement required data fields without running code',async()=>{
  const repo=await taskProject();try{
    for(const workspace of Object.values(repo.config.workspaces) as {path:string}[]){await fs.mkdir(path.join(repo.root,workspace.path),{recursive:true});await fs.writeFile(path.join(repo.root,workspace.path,'sentinel.js'),'require("fs").writeFileSync("EXECUTED","bad")');}
    for(const command of Object.values(repo.config.commands) as {exec:string;args:string[]}[]){command.exec=process.execPath;command.args=['sentinel.js'];}await fs.writeFile(path.join(repo.root,'.stackgate.yaml'),JSON.stringify(repo.config));
    const validation=runCli(repo.root,'task','validate','--file',repo.taskFile);expect(validation.status,validation.stderr).toBe(0);const data=JSON.parse(validation.stdout).data;expect(data).toMatchObject({task_id:'performance',revision:1,valid:true});expect(data.confirmation_preview).toBeTruthy();
    const absent=runCli(repo.root,'task','confirm','--file',repo.taskFile);expect(absent.status).toBe(64);expect(absent.stdout).toContain('CONFIRMATION_REQUIRED');
    const confirmed=runCli(repo.root,'task','confirm','--file',repo.taskFile,'--confirm-digest',data.confirmation_digest);expect(confirmed.status,confirmed.stderr).toBe(0);expect(JSON.parse(confirmed.stdout).data.confirmation_ref).toContain('/revisions/1/');
    const trust=runCli(repo.root,'trust','--review');expect(trust.status,trust.stderr).toBe(0);expect(JSON.parse(trust.stdout).data).toMatchObject({already_trusted:false,execution_digest:expect.any(String),execution_preview:expect.any(Object)});
    for(const workspace of Object.values(repo.config.workspaces) as {path:string}[])await expect(fs.access(path.join(repo.root,workspace.path,'EXECUTED'))).rejects.toThrow();
    await fs.appendFile(path.join(repo.root,'tests/acceptance/performance.test.ts'),'\n// changed assertion input');const drift=runCli(repo.root,'scan','--base','HEAD','--task',repo.taskFile);expect(drift.status,drift.stderr).toBe(0);expect(JSON.parse(drift.stdout).data.acceptance_drift.some((finding:{code:string;decision:string})=>finding.code==='REVIEW_REQUIRED'&&finding.decision==='DENY')).toBe(true);
  }finally{await repo.cleanup();}
});
it('scan returns breaking data with exit zero and never claims runtime or gate success',async()=>{
  const repo=await taskProject();try{const target=JSON.parse(await fs.readFile(path.join(repo.root,'contracts/openapi.json'),'utf8'));target.paths['/api/performance'].get.responses['200'].content['application/json'].schema.properties.data.properties.performance.properties.total_return.type='string';await fs.writeFile(path.join(repo.root,'contracts/openapi.json'),JSON.stringify(target));
    const result=runCli(repo.root,'scan','--base','HEAD','--task',repo.taskFile);expect(result.status,result.stderr).toBe(0);const report=JSON.parse(result.stdout);expect(report.runtime).toBe('NOT_EXECUTED');expect(report.data.contracts[0].compatibility.status).toBe('FAIL');expect(report.data.selection.required_set).toContain('e2e');expect(report.data.coverage_gaps.length).toBeGreaterThan(0);expect(report.data.candidate_export).toBe('NOT_EXECUTED');expect(report).not.toHaveProperty('decision');expect(report).not.toHaveProperty('verdict');
  }finally{await repo.cleanup();}
});
