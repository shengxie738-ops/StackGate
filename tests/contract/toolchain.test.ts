import { expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';
import ts from 'typescript';
import { parseDocument } from 'yaml';
import { withTestDirectory } from '../support/test-paths.js';
const require = createRequire(import.meta.url);
it('runs pinned Ajv and preserves type/required diagnostics without coercion', () => {
  const ajv = new Ajv2020({strict:true,allErrors:true,coerceTypes:false,useDefaults:false,removeAdditional:false});
  const validate=ajv.compile({type:'object',required:['value'],properties:{value:{type:'number'}},additionalProperties:false});
  const body={value:'0.1234'};expect(validate(body)).toBe(false);expect(body.value).toBe('0.1234');
  expect(validate.errors?.map(e=>({keyword:e.keyword,instancePath:e.instancePath}))).toEqual([{keyword:'type',instancePath:'/value'}]);
  expect(validate({})).toBe(false);expect(validate.errors?.[0]?.keyword).toBe('required');
  expect(require('ajv/package.json').version).toBe('8.20.0');
});
it('runs real TypeScript program and compiler CLI diagnostics', async () => withTestDirectory(async directory => {
  const file=join(directory,'invalid.ts');await writeFile(file,'const count: number = "not a number"; export { count };\n');
  const options={strict:true,noEmit:true,types:[],target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext};
  const program=ts.createProgram([file],options);
  expect(ts.getPreEmitDiagnostics(program).map(d=>d.code)).toContain(2322);
  const cli=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),file,'--noEmit','--strict','--skipLibCheck','--pretty','false'],{encoding:'utf8',cwd:directory});
  expect(cli.status).toBe(2);expect(cli.stdout).toContain('TS2322');
  expect(ts.version).toBe('5.9.3');
}));
it('runs real esbuild to emit a standalone ESM program and observes its result', async () => withTestDirectory(async directory => {
  const input=join(directory,'entry.ts'),output=join(directory,'entry.mjs');
  await writeFile(input,'const value: number = 6 * 7; console.log(JSON.stringify({value}));\n');
  const { build }=await import('esbuild');
  await build({entryPoints:[input],outfile:output,platform:'node',format:'esm',bundle:true,target:'node24'});
  const child=spawnSync(process.execPath,[output],{encoding:'utf8',cwd:directory});
  expect(child.status,child.stderr).toBe(0);expect(JSON.parse(child.stdout)).toEqual({value:42});
  expect((await readFile(output,'utf8')).length).toBeGreaterThan(0);
}));
it('retains YAML duplicate-key diagnostics for the future strict loader', () => {
  const document=parseDocument('checks: []\nchecks: [unit]\n',{uniqueKeys:true});
  expect(document.errors.map(error=>error.code)).toContain('DUPLICATE_KEY');
});
it('build declarations are actually consumable with strict type checking', async () => withTestDirectory(async directory => {
  const entry=join(directory,'consumer.ts');
  const declaration=join(process.cwd(),'dist/types/packages/contracts/src/index').replaceAll('\\','/');
  await writeFile(entry,`import type { GateEvaluation } from "${declaration}"; const evaluation: GateEvaluation = { schema_version: "0.1", verdict: "PASS", freshness: "FRESH", decision: "ALLOW", exit_code: 0, reasons: [] }; export { evaluation };`);
  const program=ts.createProgram([entry],{strict:true,noEmit:true,types:[],module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,resolveJsonModule:true,esModuleInterop:true,target:ts.ScriptTarget.ES2023});
  expect(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n'))).toEqual([]);
}));
