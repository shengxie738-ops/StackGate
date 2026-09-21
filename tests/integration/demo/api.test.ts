import {expect,it,vi} from 'vitest';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {loadContract} from '../../../packages/adapter-oasdiff/src/load-contract.js';
import {validatePayload} from '../../../packages/adapter-oasdiff/src/runtime-validator.js';
import {compareContractBehavior} from '../../../packages/core/src/domain/contract-projection.js';
import {withTestDirectory} from '../../support/test-paths.js';
// Every case starts a real interpreter, a real HTTP listener or a real export process.
vi.setConfig({testTimeout:180000});
const apiRoot=path.resolve('examples/contract-drift-demo/apps/api');
const python=process.platform==='win32'?'python':'python3';
// Windows CPython only discovers its per-user site-packages through %APPDATA%; without it the pinned
// FastAPI install is invisible and every export fails as an import error.
const baseEnv:NodeJS.ProcessEnv={SystemRoot:process.env.SystemRoot??'',PATH:process.env.PATH??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',APPDATA:process.env.APPDATA??'',PYTHONIOENCODING:'utf-8'};
/** -B keeps __pycache__ out of the sample tree; -E ignores ambient PYTHON* settings. */
function runPython(args:string[],options:{cwd?:string;env?:Record<string,string>}={}):Promise<{code:number|null;stdout:string;stderr:string}>{
 return new Promise(resolve=>{
  const child=spawn(python,['-B','-E',...args],{cwd:options.cwd??apiRoot,env:{...baseEnv,...(options.env??{})},stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});
  let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk.toString();});child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  child.on('error',error=>resolve({code:null,stdout,stderr:`${stdout}${error.message}`}));
  child.on('close',code=>resolve({code,stdout,stderr}));
 });
}
async function freePort():Promise<number>{
 const server=net.createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(address===null||typeof address==='string')throw Error('Loopback port was not assigned');
 const port=address.port;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 return port;
}
/** Readiness is polled against the real socket; a fixed sleep cannot prove the server accepted connections. */
async function waitForReady(port:number):Promise<void>{
 const deadline=Date.now()+90000;let last='no attempt';
 while(Date.now()<deadline){
  try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(3000)});if(response.status===200)return;last=`status ${response.status}`;}
  catch(error){last=error instanceof Error?error.name:'unknown';}
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 throw Error(`API never became ready on 127.0.0.1:${port}: ${last}`);
}
async function withApiServer<R>(work:(port:number)=>Promise<R>):Promise<R>{
 const port=await freePort();
 const child=spawn(python,['-B','-E','-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(port),'--log-level','warning'],{cwd:apiRoot,env:baseEnv,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk.toString();});child.stdout.on('data',()=>{});
 child.on('error',error=>{stderr+=error.message;});
 const exited=new Promise<number|null>(resolve=>child.on('close',code=>resolve(code)));
 try{
  const raced=await Promise.race<{state:'ready'}|{state:'exit';code:number|null}>([waitForReady(port).then(()=>({state:'ready' as const})),exited.then(code=>({state:'exit' as const,code}))]);
  if(raced.state==='exit')throw Error(`API process exited with code ${raced.code} before readiness: ${stderr}`);
  return await work(port);
 }finally{child.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(()=>resolve('timeout'),15000))]);}
}
async function targetDocument(){
 const contract=loadContract(new Uint8Array(await fs.readFile('tests/fixtures/contracts/target.json')),'target.json');
 if(!contract.document)throw Error(`Target contract fixture is unsupported: ${contract.diagnostics.map(item=>item.message).join('; ')}`);
 return contract.document;
}
async function exportCandidate(output:string,cwd=apiRoot,env:Record<string,string>={}){
 const run=await runPython(['scripts/export_openapi.py'],{cwd,env:{STACKGATE_OUTPUT_DIR:output,...env}});
 return {...run,bytes:await fs.readFile(path.join(output,'candidate-openapi.json')).catch(()=>null)};
}
it('serves the confirmed performance response from a real API process',async()=>{
 await withApiServer(async port=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/performance`);
  expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/json');
  const body=await response.json() as {data:{performance:{total_return:unknown}}};
  expect(typeof body.data.performance.total_return).toBe('number');expect(body.data.performance.total_return).toBe(0.1234);
  const target=await targetDocument();
  const validation=validatePayload({contract:loadContract(Buffer.from(JSON.stringify(target)),'target.json'),operation_key:'GET /api/performance',direction:'response',status_code:200,media_type:'application/json',payload:body});
  expect(validation.violations).toEqual([]);expect(validation).toMatchObject({supported:true,status:'PASS'});
  expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
 });
});
it('exports the application contract into the injected attempt directory only',async()=>{
 await withTestDirectory(async root=>{
  const output=path.join(root,'attempt');await fs.mkdir(output);
  const run=await exportCandidate(output);
  expect(run.code,run.stderr).toBe(0);expect(run.stdout).toContain('candidate-openapi.json');
  const document=JSON.parse(run.bytes!.toString()) as {openapi:string;paths:Record<string,unknown>;components?:{schemas?:Record<string,unknown>}};
  expect(document.openapi).toMatch(/^3\.1\./);
  expect(Object.keys(document.paths)).toEqual(['/api/performance']);
  const target=await targetDocument();
  expect(compareContractBehavior(target,document)).toEqual({aligned:true,changed_operations:[]});
  expect(await fs.readdir(root)).toEqual(['attempt']);
 });
});
it('ignores a stale candidate in the tree and refuses an unusable output target',async()=>{
 await withTestDirectory(async root=>{
  const output=path.join(root,'attempt');await fs.mkdir(output);
  const stale=path.join(apiRoot,'candidate-openapi.json');
  const staleBytes=Buffer.from('{"openapi":"3.1.1","paths":{},"injected":"stale-repo-copy"}');
  await fs.writeFile(stale,staleBytes);
  try{
   const run=await exportCandidate(output);expect(run.code,run.stderr).toBe(0);
   expect(run.bytes!.toString()).not.toContain('stale-repo-copy');
   expect(await fs.readFile(stale)).toEqual(staleBytes);
   expect(JSON.parse(run.bytes!.toString()).paths).toHaveProperty('/api/performance');
  }finally{await fs.unlink(stale);}
  expect((await runPython(['scripts/export_openapi.py'],{env:{}})).code).toBe(64);
  const outside=path.join(root,'outside');
  expect((await runPython(['scripts/export_openapi.py'],{env:{STACKGATE_OUTPUT_DIR:outside}})).code).toBe(64);
  expect((await exportCandidate(output)).code).toBe(64);
  await expect(fs.stat(outside)).rejects.toThrow();
 });
});
it('fails as an import error instead of producing a compatible looking contract',async()=>{
 await withTestDirectory(async root=>{
  const broken=path.join(root,'api');await fs.mkdir(path.join(broken,'app'),{recursive:true});await fs.mkdir(path.join(broken,'scripts'),{recursive:true});
  await fs.cp(path.join(apiRoot,'scripts','export_openapi.py'),path.join(broken,'scripts','export_openapi.py'));
  await fs.copyFile(path.join(apiRoot,'app','__init__.py'),path.join(broken,'app','__init__.py'));
  await fs.copyFile(path.join(apiRoot,'app','main.py'),path.join(broken,'app','main.py'));
  await fs.writeFile(path.join(broken,'app','models.py'),'this is not valid python\n');
  const output=path.join(root,'attempt');await fs.mkdir(output);
  const run=await exportCandidate(output,broken);
  expect(run.code).toBe(3);expect(run.stderr).toContain('SyntaxError');expect(run.bytes).toBeNull();
  expect(await fs.readdir(output)).toEqual([]);
 });
});
it('detects a real backend response type change against the confirmed target',async()=>{
 const script=[
  'import json,sys',
  "sys.path.insert(0,'.')",
  'from pydantic import BaseModel,ConfigDict',
  'from app.main import create_app',
  'from app.models import inline_schema',
  'class DriftedPerformance(BaseModel):',
  '    model_config=ConfigDict(extra="forbid")',
  '    total_return: str',
  'class DriftedData(BaseModel):',
  '    model_config=ConfigDict(extra="forbid")',
  '    performance: DriftedPerformance',
  'class DriftedEnvelope(BaseModel):',
  '    model_config=ConfigDict(extra="forbid")',
  '    data: DriftedData',
  'app=create_app()',
  'drifted=inline_schema(DriftedEnvelope)',
  "for route in app.routes:",
  "    if getattr(route,'path',None)=='/api/performance':",
  "        declared=route.responses.get(200) or route.responses.get('200')",
  "        declared['content']['application/json']['schema']=drifted",
  'app.openapi_schema=None',
  'sys.stdout.write(json.dumps(app.openapi()))',
 ].join('\n');
 const drift=await runPython(['-c',script]);
 expect(drift.code,drift.stderr).toBe(0);
 const document=JSON.parse(drift.stdout) as {paths:{'/api/performance':{get:{responses:{'200':{content:{'application/json':{schema:{properties:{data:{properties:{performance:{properties:{total_return:{type:string}}}}}}}}}}}}}}};
 expect(document.paths['/api/performance'].get.responses['200'].content['application/json'].schema.properties.data.properties.performance.properties.total_return.type).toBe('string');
 expect(compareContractBehavior(await targetDocument(),document)).toEqual({aligned:false,changed_operations:['GET /api/performance']});
});
