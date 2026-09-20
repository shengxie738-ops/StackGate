import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {withTestDirectory} from '../../support/test-paths.js';
const cli=resolve('dist/cli.mjs');
function invoke(args:string[]){return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:30000});}
function envelope(result:ReturnType<typeof invoke>,operation:string,exit:number){
  expect(result.status,result.stderr).toBe(exit);
  expect(result.stdout).not.toMatch(/\u001b/);
  const value=JSON.parse(result.stdout); // Whole-output parsing rejects trailing progress or a second JSON document.
  expect(value).toMatchObject({schema_version:'0.1',ok:exit===0,operation,runtime:'NOT_EXECUTED',exit_code:exit,diagnostics:expect.any(Array)});
  if(exit!==0)expect(value.diagnostics.length).toBeGreaterThan(0);
  return value;
}
it('unknown command and malformed arguments produce one JSON document with exit 64',()=>{
  envelope(invoke(['unknown','--json']),'unknown',64);
  envelope(invoke(['doctor','--root','--json']),'doctor',64);
  envelope(invoke(['doctor','--json','--json']),'doctor',64);
});
it('configuration diagnostics have uniform envelope and retain doctor details',async()=>withTestDirectory(async root=>{
  await writeFile(join(root,'.stackgate.yaml'),'schema_version: "0.1"\nunknown: true\n');
  const value=envelope(invoke(['doctor','--root',root,'--json']),'doctor',64);
  expect(value.diagnostics.some((d:{code:string})=>d.code==='CONFIG_INVALID')).toBe(true);
  expect(value.data.configuration_file).toBe('.stackgate.yaml');
}));
it('ServiceError retains diagnostics and never prints a second document',()=>{
  const value=envelope(invoke(['task','confirm','--file','task.json','--json']),'task confirm',64);
  expect(value.diagnostics[0].message).toContain('CONFIRMATION_REQUIRED');
});
it('unexpected filesystem exceptions produce safe JSON without raw error details',async()=>withTestDirectory(async root=>{
  const invalid=join(root,'private-location-canary');await writeFile(invalid,'ordinary file');
  const result=invoke(['init','--preset','fastapi-react','--root',invalid,'--json']);
  const value=envelope(result,'init',3);
  expect(value.diagnostics[0].code).toBe('TOOL_FAILURE');
  expect(result.stdout+result.stderr).not.toContain('private-location-canary');
  expect(result.stdout+result.stderr).not.toContain(' at ');
}));
it('success carries structured data and does not invent a Gate decision',async()=>withTestDirectory(async root=>{
  const value=envelope(invoke(['doctor','--root',root,'--json']),'doctor',0);
  expect(value.data.missing).toContain('PROJECT_CONFIG');expect(value).not.toHaveProperty('decision');expect(value).not.toHaveProperty('verdict');
}));
it('help and version honor JSON mode while plain help stays readable',()=>{
  expect(envelope(invoke(['--help','--json']),'help',0).data.help).toContain('Usage:');
  expect(envelope(invoke(['--version','--json']),'version',0).data.version).toBe('0.1.0');
  const result=invoke(['--help']);expect(result.status).toBe(0);expect(result.stdout).toContain('Usage:');expect(result.stdout).not.toContain('"schema_version"');
});
