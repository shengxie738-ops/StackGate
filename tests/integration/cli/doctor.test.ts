import { expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withTestDirectory } from '../../support/test-paths.js';
const cli=resolve('dist/cli.mjs');
const configFixture=JSON.parse(await readFile('tests/fixtures/config/original.json','utf8'));
function doctor(root:string){return spawnSync(process.execPath,[cli,'doctor','--root',root,'--json'],{encoding:'utf8'});}
it('rejects semantically missing check references in otherwise valid configuration',async()=>withTestDirectory(async root=>{const config=structuredClone(configFixture);config.profiles.integration.required_checks=['absent'];await writeFile(join(root,'.stackgate.yaml'),JSON.stringify(config));const result=doctor(root);expect(result.status).toBe(64);expect(JSON.parse(result.stdout).diagnostics.some((d:{message:string})=>d.message.includes('absent'))).toBe(true);}));
it('inspects a Chinese project without running postinstall, Python imports or writing state',async()=>withTestDirectory(async parent=>{
  const root=join(parent,'中文 项目');await mkdir(root);
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{postinstall:'node -e "require(\'fs\').writeFileSync(\'PWNED\',\'x\')"'},dependencies:{react:'1'}}));
  await writeFile(join(root,'pyproject.toml'),'[project]\nname="api"\ndependencies=["fastapi"]\n');
  await writeFile(join(root,'main.py'),'open("PYTHON_EXECUTED", "w").write("bad")\n');
  const before=(await readdir(root)).sort();
  const result=doctor(root);expect(result.status,result.stderr).toBe(0);
  const report=JSON.parse(result.stdout);
  expect(report.runtime).toBe('NOT_EXECUTED');expect(report.capabilities).toContain('typescript');expect(report.capabilities).toContain('fastapi');
  expect(report.missing).toContain('OPENAPI_TARGET');expect(report).not.toHaveProperty('decision');expect(report).not.toHaveProperty('verdict');
  expect(report.tools.docker.status).toBe('UNVERIFIED');
  expect(JSON.stringify(report)).not.toContain(root);
  expect((await readdir(root)).sort()).toEqual(before);
}));
it('returns precise invalid-config diagnostics and never scans a parent manifest',async()=>withTestDirectory(async parent=>{
  await writeFile(join(parent,'package.json'),'{"dependencies":{"react":"1"}}');
  const root=join(parent,'child');await mkdir(root);await writeFile(join(root,'.stackgate.yaml'),'schema_version: "0.1"\nunknown: true\n');
  const result=doctor(root);expect(result.status).toBe(64);
  const report=JSON.parse(result.stdout);expect(report.diagnostics.some((d:{code:string;location:string})=>d.code==='CONFIG_INVALID'&&d.location.includes('unknown'))).toBe(true);
  expect(report.capabilities).not.toContain('typescript');expect((await readdir(root))).toEqual(['.stackgate.yaml']);
}));
it('reports conflicting configuration files rather than choosing one',async()=>withTestDirectory(async root=>{
  await writeFile(join(root,'.stackgate.yaml'),'schema_version: "0.1"');await writeFile(join(root,'.stackgate.yml'),'schema_version: "0.1"');
  const result=doctor(root);expect(result.status).toBe(64);expect(JSON.parse(result.stdout).conflicts).toContain('MULTIPLE_CONFIG_FILES');
}));
it('reports declared commands/workspaces missing without executing them',async()=>withTestDirectory(async root=>{
  const config=structuredClone(configFixture);config.commands.web_unit.exec='missing-stackgate-command-123';
  await writeFile(join(root,'.stackgate.yaml'),JSON.stringify(config));
  const result=doctor(root);expect(result.status).toBe(0);const report=JSON.parse(result.stdout);
  expect(report.missing).toContain('COMMAND:web_unit');expect(report.missing).toContain('WORKSPACE:web');
}));
