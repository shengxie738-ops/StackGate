import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {taskProject} from '../../support/task-project.js';
const cli=path.resolve('dist/cli.mjs');
vi.setConfig({testTimeout:180000});
function run(root:string,...args:string[]){const result=spawnSync(process.execPath,[cli,...args,'--root',root,'--json'],{encoding:'utf8',timeout:120000});expect(result.status,result.stderr).toBe(0);const report=JSON.parse(result.stdout);expect(report.runtime).toBe('NOT_EXECUTED');expect(report).not.toHaveProperty('decision');return report;}
it('keeps changed unsupported workspace sources visible even with an explicit mapping file',async()=>{const repo=await taskProject();try{await fs.mkdir(path.join(repo.root,'apps/web'),{recursive:true});await fs.writeFile(path.join(repo.root,'apps/web/consumer.jsx'),'export const load=(url)=>fetch(url);');await fs.writeFile(path.join(repo.root,'.stackgate/mappings.json'),JSON.stringify({schema_version:'0.1',mappings:[]}));const scan=run(repo.root,'scan','--base','HEAD').data;expect(scan.impacts.unresolved.some((gap:{reference:string;kind:string})=>gap.reference==='apps/web/consumer.jsx'&&gap.kind==='scope')).toBe(true);}finally{await repo.cleanup();}});
it('all M1 entrypoints leave postinstall, JavaScript and Python sentinels unexecuted',async()=>{
  const repo=await taskProject();try{
    const sentinel=path.join(repo.root,'EXECUTED');await fs.writeFile(path.join(repo.root,'package.json'),JSON.stringify({scripts:{postinstall:`node -e 'require("fs").writeFileSync(${JSON.stringify(sentinel)},"bad")'`}}));
    for(const workspace of Object.values(repo.config.workspaces) as {path:string}[]){const dir=path.join(repo.root,workspace.path);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'evil.js'),`require('fs').writeFileSync(${JSON.stringify(sentinel)},'bad');`);await fs.writeFile(path.join(dir,'main.py'),`open(${JSON.stringify(sentinel)},'w').write('bad')`);}
    for(const command of Object.values(repo.config.commands) as {exec:string;args:string[]}[]){command.exec=process.execPath;command.args=['evil.js'];}await fs.writeFile(path.join(repo.root,'.stackgate.yaml'),JSON.stringify(repo.config));
    run(repo.root,'init','--preset','fastapi-react','--dry-run');run(repo.root,'init','--preset','fastapi-react','--apply');run(repo.root,'doctor');run(repo.root,'trust','--review');
    const task=run(repo.root,'task','validate','--file',repo.taskFile).data;run(repo.root,'task','confirm','--file',repo.taskFile,'--confirm-digest',task.confirmation_digest);
    const scan=run(repo.root,'scan','--base','HEAD','--task',repo.taskFile).data;expect(scan.candidate_export).toBe('NOT_EXECUTED');expect(scan.contracts[0].runtime_validation.status).toBe('NOT_EXECUTED');expect(scan.coverage_gaps.some((g:{code?:string})=>g.code==='RUNTIME_NOT_EXECUTED')).toBe(true);
    await expect(fs.access(sentinel)).rejects.toThrow();
  }finally{await repo.cleanup();}
});
it('reports no baseline, untracked Chinese consumers, changed target and unknown schema honestly',async()=>{
  const repo=await taskProject();try{
    const missing=run(repo.root,'scan','--base','missing-ref').data;expect(missing.baseline).toBeNull();expect(missing.coverage_gaps[0].code).toBe('BASELINE_MISSING');
    await fs.mkdir(path.join(repo.root,'apps/web'),{recursive:true});await fs.writeFile(path.join(repo.root,'apps/web/新 组件.ts'),'export const request=(url:string)=>fetch(url);');
    const before=run(repo.root,'scan','--base','HEAD','--task',repo.taskFile).data;expect(before.input_manifest.files.some((f:{relative_path:string;tracked:boolean})=>f.relative_path==='apps/web/新 组件.ts'&&!f.tracked)).toBe(true);expect(before.impacts.unresolved.length).toBeGreaterThan(0);
    const target=JSON.parse(await fs.readFile(path.join(repo.root,'contracts/openapi.json'),'utf8'));target.paths['/api/performance'].get.responses['200'].content['application/json'].schema.properties.data.properties.performance.properties.total_return.format='invented';await fs.writeFile(path.join(repo.root,'contracts/openapi.json'),JSON.stringify(target));
    const after=run(repo.root,'scan','--base','HEAD','--task',repo.taskFile).data;expect(after.input_manifest.input_hash).not.toBe(before.input_manifest.input_hash);expect(after.contracts[0].compatibility.status).toBe('BLOCKED');expect(after.contracts[0].compatibility.diagnostics.some((d:{code:string})=>d.code==='UNSUPPORTED_SCHEMA')).toBe(true);expect(after.candidate_export).toBe('NOT_EXECUTED');
  }finally{await repo.cleanup();}
});
