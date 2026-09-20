import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'yaml';
const require=createRequire(import.meta.url);
const platform=process.platform+'-'+process.arch;
const pkg=JSON.parse(await readFile('package.json','utf8'));
const lock=parse(await readFile('pnpm-lock.yaml','utf8'));
const evidence=[];
for(const file of await readdir('docs/implementation/evidence')) if(/^sg-\d{3}.*\.json$/.test(file)) {
  const entry=JSON.parse(await readFile('docs/implementation/evidence/'+file,'utf8'));
  if(entry.exit_code===0&&entry.result==='PASSED') evidence.push(entry);
}
evidence.sort((a,b)=>b.finished_at.localeCompare(a.finished_at));
function proof(command) {
  const result=evidence.find(item=>item.command===command);
  if(!result)throw new Error('No observed successful capability evidence for '+command);
  return result;
}
async function digest(file) {return 'sha256:'+createHash('sha256').update(await readFile(file)).digest('hex');}
const tools=[];
const nodeEvidence=proof('node dist/cli.mjs --help');
tools.push({name:'node',version:process.versions.node,platform,source:'https://nodejs.org/download/release/v'+process.versions.node+'/',checksum_or_lock_integrity:await digest(process.execPath),tested_capabilities:['built ESM CLI execution','native test runner'],status:'VERIFIED',verified_at:nodeEvidence.finished_at,evidence_refs:[nodeEvidence.evidence_path]});
let pnpmEntry;
for(const dir of [path.dirname(process.execPath),...(process.env.PATH??'').split(path.delimiter)]) for(const suffix of ['node_modules/pnpm/bin/pnpm.cjs','node_modules/pnpm/bin/pnpm.mjs','node_modules/pnpm/bin/pnpm.js']) if(!pnpmEntry&&existsSync(path.join(dir,suffix))) pnpmEntry=path.join(dir,suffix);
if(!pnpmEntry)throw new Error('pnpm entry UNKNOWN');
const pnpmVersion=spawnSync(process.execPath,[pnpmEntry,'--version'],{encoding:'utf8',shell:false,windowsHide:true});
if(pnpmVersion.status!==0)throw new Error('Cannot read actual pnpm version');
const pv=pnpmVersion.stdout.trim();
if(pkg.packageManager!=='pnpm@'+pv)throw new Error('pnpm differs from packageManager pin');
const installEvidence=proof('pnpm install --frozen-lockfile --registry=https://registry.npmjs.org');
tools.push({name:'pnpm',version:pv,platform,source:'https://registry.npmjs.org/pnpm/'+pv,checksum_or_lock_integrity:await digest(pnpmEntry),tested_capabilities:['frozen lockfile install','Windows JS entry'],status:'VERIFIED',verified_at:installEvidence.finished_at,evidence_refs:[installEvidence.evidence_path]});
const capabilities={
  typescript:['pnpm typecheck','strict noEmit and declarations'],
  ajv:['pnpm verify:schemas','2020-12 strict validation, no coercion'],
  'ajv-formats':['pnpm verify:schemas','UTC date-time and URI formats'],
  vitest:['pnpm test:contract','real contract test execution and exit status'],
  esbuild:['pnpm build','bundled standalone ESM CLI/core/contracts'],
  yaml:['pnpm test:contract','duplicate mapping key diagnostics'],
  eslint:['pnpm lint','source lint'],
  'typescript-eslint':['pnpm lint','TypeScript lint'],
  'json-schema-to-typescript':['pnpm verify:schemas','deterministic schema type generation and drift detection'],
  '@types/node':['pnpm typecheck','Node API TypeScript declarations'],
};
for(const [name,[command,capability]] of Object.entries(capabilities)) {
  const metadata=require(name+'/package.json');
  const expected={...pkg.dependencies,...pkg.devDependencies}[name];
  if(metadata.version!==expected)throw new Error(name+' differs from exact dependency pin');
  const integrity=lock.packages[name+'@'+metadata.version]?.resolution?.integrity;
  if(!integrity)throw new Error('No lock integrity: '+name);
  const record=proof(command);
  tools.push({name,version:metadata.version,platform,source:'https://registry.npmjs.org/'+name+'/'+metadata.version,checksum_or_lock_integrity:integrity,tested_capabilities:[capability],status:'VERIFIED',verified_at:record.finished_at,evidence_refs:[record.evidence_path]});
}
for(const [name,source] of [['oasdiff','https://github.com/oasdiff/oasdiff'],['playwright','https://playwright.dev/docs/intro'],['docker-compose','https://docs.docker.com/compose/']]) {
  const probe= name==='playwright'?{status:existsSync('node_modules/@playwright/test/package.json')?0:null,stdout:''}:spawnSync(name==='docker-compose'?'docker':'oasdiff',name==='docker-compose'?['compose','version']:['--version'],{encoding:'utf8',shell:false,windowsHide:true});
  tools.push({name,version:null,platform,source,checksum_or_lock_integrity:null,tested_capabilities:[],status:'UNKNOWN',verified_at:null,observed_version_output:(probe.stdout??'').trim()||null,observation_exit_code:probe.status??null,reason:'No product adapter contract or integration suite executed; installing/starting a tool alone is not compatibility verification.'});
}
const result={schema_version:'0.1',generated_at:new Date().toISOString(),platform,os_release:os.release(),lockfile_sha256:await digest('pnpm-lock.yaml'),tools,platform_matrix:[{platform,scope:'M0 local development',status:'PENDING_STAGE'},{platform:'linux-x64',scope:'WSL2/Linux CLI and Linux CI',status:'NOT_RUN'}],limitations:['oasdiff/Playwright/Compose integration capabilities remain UNKNOWN','Ajv nested dynamic anchors unsupported: official OpenAPI document meta-schema uses a local static binding only in fixture checks; arbitrary response dynamic refs are NOT validated as supported','No product runner, real browser acceptance, packaging, host loading, release or production deployment claim']};
await mkdir('tools',{recursive:true});
await writeFile('tools/compatibility-lock.json',JSON.stringify(result,null,2)+'\n');
console.log('Recorded '+tools.length+' tools on '+platform+'; UNKNOWN capabilities retained');
