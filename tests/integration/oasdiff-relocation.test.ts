import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {withTestDirectory} from '../support/test-paths.js';
import {taskProject} from '../support/task-project.js';
vi.setConfig({testTimeout:180000});
it('copied built CLI uses only its relocated verified native tool',()=>withTestDirectory(async parent=>{
 const installation=path.join(parent,'新 安装'),repo=await taskProject();await fs.mkdir(installation);await fs.cp('dist',installation,{recursive:true});
 const executable=path.join(installation,'tools/bin/oasdiff-1.32.1/oasdiff.exe');await fs.mkdir(path.dirname(executable),{recursive:true});await fs.copyFile('tools/bin/oasdiff-1.32.1/oasdiff.exe',executable);
 const run=()=>{const r=spawnSync(process.execPath,[path.join(installation,'cli.mjs'),'scan','--root',repo.root,'--base','HEAD','--json'],{encoding:'utf8',timeout:120000});expect(r.status,r.stderr).toBe(0);const report=JSON.parse(r.stdout);expect(report.runtime).toBe('NOT_EXECUTED');return report.data.contracts[0].compatibility;};
 try{
 const target=JSON.parse(await fs.readFile(path.join(repo.root,'contracts/openapi.json'),'utf8'));target.paths['/api/performance'].get.responses['200'].content['application/json'].schema.properties.data.properties.performance.properties.total_return.type='string';await fs.writeFile(path.join(repo.root,'contracts/openapi.json'),JSON.stringify(target));
 const finding=run();expect(finding.status).toBe('FAIL');expect(finding.evidence[0]).toMatchObject({command:'version',version:'1.32.1',exit_code:0});expect(finding.findings[0].raw_rule_id).toBe('response-property-type-changed');await fs.rename(executable,executable+'.retained');expect(run().status).toBe('BLOCKED');await fs.writeFile(executable,'same name, wrong binary');expect(run().status).toBe('BLOCKED');
 }finally{await repo.cleanup();}
}));
