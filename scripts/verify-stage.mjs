import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const registry = {
  source: ['scripts/verify-source.mjs'], tasks: ['scripts/verify-tasks.mjs'],
  schemas: ['scripts/verify-schemas.mjs'], boundaries: ['scripts/verify-boundaries.mjs'],
  build: ['scripts/build.mjs'], typecheck: ['node_modules/typescript/bin/tsc','--noEmit'],
  unit: ['scripts/test-unit.mjs'], lint: ['node_modules/eslint/bin/eslint.js','.'],
  contract: ['node_modules/vitest/vitest.mjs','run','tests/contract'],
  integration: ['node_modules/vitest/vitest.mjs','run','tests/integration'],
  'm2-runner': ['node_modules/vitest/vitest.mjs','run','tests/integration/runner/process.test.ts','tests/compatibility/command-resolver.test.ts'],
  'm2-evidence': ['node_modules/vitest/vitest.mjs','run','tests/integration/storage','tests/security','tests/contract/schema-compatibility.test.ts'],
  'm2-gate': ['node_modules/vitest/vitest.mjs','run','tests/integration/gate','tests/unit/run-evaluation.test.ts'],
};
const requiredChecks = ['source','tasks','schemas','boundaries','build','typecheck','unit','lint','contract'];
const requiredTools = ['node','pnpm','typescript','ajv','vitest','esbuild'];
export function validateStageManifest(manifest,requestedStage=manifest?.stage) {
  const errors=[];
  if(manifest?.stage!==requestedStage)errors.push('Stage identity does not match requested stage');
  if(manifest?.schema_version!=='0.1'||!['M0','M1','M2'].includes(manifest.stage)) return ['Unimplemented stage; only M0, M1 and M2 have registered checks'];
  if(!Array.isArray(manifest.checks)||new Set(manifest.checks).size!==manifest.checks.length) errors.push('Invalid or duplicate checks');
  for(const check of requiredChecks) if(!manifest.checks?.includes(check)) errors.push('Missing mandatory check: '+check);
  if(['M1','M2'].includes(manifest.stage)&&!manifest.checks?.includes('integration'))errors.push('Missing mandatory check: integration');
  if(manifest.stage==='M2')for(const id of ['m2-runner','m2-evidence','m2-gate'])if(!manifest.checks?.includes(id))errors.push('Missing mandatory check: '+id);
  for(const check of manifest.checks??[]) if(!Object.hasOwn(registry,check)) errors.push('Unregistered check: '+check);
  if(!Array.isArray(manifest.required_tools)||new Set(manifest.required_tools).size!==manifest.required_tools.length) errors.push('Invalid or duplicate required tools');
  for(const tool of requiredTools) if(!manifest.required_tools?.includes(tool)) errors.push('Missing mandatory tool: '+tool);
  if(['M1','M2'].includes(manifest.stage)&&!manifest.required_tools?.includes('oasdiff'))errors.push('Missing mandatory tool: oasdiff');
  if(manifest.stage==='M2'&&!manifest.required_tools?.includes('saxes'))errors.push('Missing mandatory tool: saxes');
  return errors;
}
export function validateToolRequirements(manifest,lock) {
  const errors=[];
  for(const name of manifest.required_tools??[]) {
    const entries=(lock.tools??[]).filter(tool=>tool.name===name);
    const tool=entries[0];
    if(entries.length!==1||tool.status!=='VERIFIED'||!tool.version||tool.version==='latest'||!tool.tested_capabilities?.length||!tool.verified_at||!tool.checksum_or_lock_integrity) errors.push('Tool capability UNKNOWN or unverified: '+name);
  }
  return errors;
}
export async function runRegisteredChecks(ids,{cwd=process.cwd(),quiet=false}={}) {
  const checks=[];
  for(const id of ids) {
    if(!Object.hasOwn(registry,id)) return {exit_code:64,checks,error:'Unregistered check: '+id};
    const args=registry[id],started_at=new Date().toISOString();
    if(!quiet) console.log('Stage check: node '+args.join(' '));
    const result=await new Promise(done=>{
      let output='';
      const child=spawn(process.execPath,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(!quiet)process.stdout.write(chunk);});
      child.stderr.on('data',chunk=>{output+=chunk.toString();if(!quiet)process.stderr.write(chunk);});
      child.on('error',error=>done({exit_code:3,output:output+error.message}));
      child.on('close',code=>done({exit_code:code??3,output}));
    });
    checks.push({id,command:'node '+args.join(' '),started_at,finished_at:new Date().toISOString(),...result});
    if(result.exit_code!==0) return {exit_code:result.exit_code,checks};
  }
  return {exit_code:0,checks};
}
async function main(argv) {
  const args=argv.filter(arg=>arg!=='--');
  if(args.length!==2||args[0]!=='--stage') { console.error('Usage: pnpm verify:stage -- --stage M0|M1|M2');return 64; }
  if(!['M0','M1','M2'].includes(args[1])) { console.error('Unimplemented stage '+args[1]+': NOT VERIFIED');return 2; }
  const stage=args[1];
  const root=resolve('.');
  const manifest=JSON.parse(await readFile('tests/fixtures/stages/'+stage+'.json','utf8'));
  const lock=JSON.parse(await readFile('tools/compatibility-lock.json','utf8'));
  const errors=[...validateStageManifest(manifest,stage),...validateToolRequirements(manifest,lock)];
  const ledger=JSON.parse(await readFile('docs/implementation/tasks.json','utf8'));
  for(let index=1;index<=(stage==='M0'?9:stage==='M1'?27:49);index++) {
    const id='SG-'+String(index).padStart(3,'0');
    if(ledger.tasks.find(task=>task.task_id===id)?.status!=='DONE') errors.push('Stage prerequisite incomplete: '+id);
  }
  if(errors.length) {console.error(errors.join('\n'));return 2;}
  const result=await runRegisteredChecks(manifest.checks,{cwd:root});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const path='docs/implementation/evidence/'+stage.toLowerCase()+'-stage-'+stamp+'.json';
  await mkdir('docs/implementation/evidence',{recursive:true});
  await writeFile(path,JSON.stringify({schema_version:'0.1',stage,platform:process.platform+'-'+process.arch,runtime:stage==='M2'?'EXECUTED':'NOT_EXECUTED',...result},null,2)+'\n');
  console.log(stage+' stage exit='+result.exit_code+'; child command evidence: '+path);
  return result.exit_code;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {process.exitCode=await main(process.argv.slice(2));} catch(error){console.error(error.message);process.exitCode=3;}
}
