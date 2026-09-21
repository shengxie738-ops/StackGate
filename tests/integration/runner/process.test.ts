import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {withTestDirectory} from '../../support/test-paths.js';
import {hashBytes} from '../../../packages/core/src/storage/hash.js';
import {LocalRunner} from '../../../packages/runner-local/src/local-runner.js';
import type {ResolvedCommand} from '../../../packages/core/src/ports/runner.js';
vi.setConfig({testTimeout:45000});
async function run(directory:string,code:string,options:{timeout?:number;controller?:AbortController;budget?:number;onOutput?:(text:string)=>void|Promise<void>;args?:string[];prepare?:(command:ResolvedCommand)=>Promise<void>}={}){
 const script=path.join(directory,'process.cjs');await fs.writeFile(script,code);const controller=options.controller??new AbortController();
 const command:ResolvedCommand={command_id:'command',identity:{executable:process.execPath,version:process.version.slice(1),digest:hashBytes(await fs.readFile(process.execPath))},args:[script,...options.args??[]],cwd:directory,environment:{SystemRoot:process.env.SystemRoot!,TEMP:directory,TMP:directory,STACKGATE_RUN_ID:'run_test',STACKGATE_OUTPUT_DIR:directory,SECRET:'private-token'},timeout_ms:options.timeout??10000,authorization_hash:'1'.repeat(64),command_hash:'2'.repeat(64),verified_inputs:[{path:script,digest:hashBytes(await fs.readFile(script))}]};
 await options.prepare?.(command);
 let stdout='',stderr='';const result=await new LocalRunner({max_output_bytes:options.budget??1048576}).run(command,{run_id:'run_test',check_id:'check',attempt_id:'attempt_one',signal:controller.signal,async stdout(chunk){const text=Buffer.from(chunk).toString();stdout+=text;await options.onOutput?.(text);},async stderr(chunk){stderr+=Buffer.from(chunk).toString();}});return {result,stdout,stderr,command};
}
it.each([0,1,7])('preserves actual exit %s and separate sanitized streams',exit=>withTestDirectory(async directory=>{
 const observed=await run(directory,`console.log('stdout');console.error('stderr Authorization: private-token');process.exit(${exit});`);expect(observed.result.status).toBe('EXITED');expect(observed.result.raw_exit_code).toBe(exit);expect(observed.stdout).toContain('stdout');expect(observed.stderr).toContain('[REDACTED]');expect(observed.stderr).not.toContain('private-token');expect(observed.result.process?.creation_identity).toBeTruthy();expect(observed.result.provenance).toMatchObject({cleanup:'VERIFIED',broker_version:expect.stringMatching(/^\d+\./)});expect(observed.result.diagnostics).toEqual([]);expect(observed.result.output?.original_bytes).toBeGreaterThan(0);expect(observed.result.execution?.command_id).toBe('command');
}));
it('keeps exact Unicode argv and does not interpret shell syntax',()=>withTestDirectory(async directory=>{
 const observed=await run(directory,'console.log(JSON.stringify(process.argv.slice(2)))',{args:['中文 空格','a&b','a;b','quote"slash\\']});expect(observed.result.raw_exit_code).toBe(0);expect(JSON.parse(observed.stdout)).toEqual(['中文 空格','a&b','a;b','quote"slash\\']);
}));
it('distinguishes timeout from cancellation and stops late writes',()=>withTestDirectory(async directory=>{
 const timed=await run(directory,'setInterval(()=>console.log("alive"),25)',{timeout:150});expect(timed.result.status).toBe('TIMED_OUT');
 const controller=new AbortController();const canceled=await run(directory,'setInterval(()=>console.log("alive"),25)',{controller,onOutput(){controller.abort();}});expect(canceled.result.status).toBe('CANCELED');
}));
it('bounds both huge stdout and stderr without pipe deadlock',()=>withTestDirectory(async directory=>{
 const observed=await run(directory,'for(let i=0;i<10000;i++){process.stdout.write("stdout line\\n");process.stderr.write("stderr line\\n");}setInterval(()=>{},1000)',{budget:2048});expect(observed.result.status).toBe('ERROR');expect(observed.result.diagnostics.some(d=>d.code==='ARTIFACT_BUDGET_EXCEEDED')).toBe(true);expect(Buffer.byteLength(observed.stdout+observed.stderr)).toBeLessThanOrEqual(2048);
}));
it.each(['cancel','timeout'])('kills only its owned job including detached descendants on %s and leaves unrelated process alive',mode=>withTestDirectory(async directory=>{
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
 const marker=path.join(directory,'descendant-ticks');const controller=new AbortController();
 try{const observed=await run(directory,`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'tick'),20)`)}],{detached:true,stdio:'ignore'}).unref();const wait=setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(marker)})){clearInterval(wait);console.log('ready')}},20);setInterval(()=>{},1000);`,{controller,timeout:mode==='timeout'?500:10000,onOutput(){if(mode==='cancel')controller.abort();}});
 expect(observed.result.status).toBe(mode==='cancel'?'CANCELED':'TIMED_OUT');expect(observed.result.provenance?.cleanup).toBe('VERIFIED');const before=await fs.readFile(marker,'utf8');await new Promise(r=>setTimeout(r,150));expect(await fs.readFile(marker,'utf8')).toBe(before);expect(unrelated.exitCode).toBeNull();expect(unrelated.kill(0)).toBe(true);
 }finally{unrelated.kill();}
}));
it('records actual native spawn failure without inventing an exit code',()=>withTestDirectory(async directory=>{
 const observed=await run(directory,'console.log("NEVER")',{async prepare(command){const executable=path.join(directory,'not-a-native-program.exe');await fs.writeFile(executable,'invalid PE image');command.identity={executable,digest:hashBytes(await fs.readFile(executable)),version:'UNKNOWN'};}});expect(observed.result.status).toBe('ERROR');expect(observed.result.raw_exit_code).toBeNull();expect(observed.result.process).toBeNull();expect(observed.stdout).not.toContain('NEVER');
}));
it.each(['executable','entry'])('rejects changed %s bytes before launching a process',kind=>withTestDirectory(async directory=>{
 const observed=await run(directory,'console.log("NEVER")',{async prepare(command){if(kind==='executable')command.identity.digest='0'.repeat(64);else await fs.appendFile(command.args[0]!,'\n// changed after review');}});expect(observed.result.status).toBe('ERROR');expect(observed.result.process).toBeNull();expect(observed.stdout).toBe('');expect(observed.result.diagnostics[0]?.code).toBe('EXECUTION_UNTRUSTED');
}));
it('does not start pre-canceled work',()=>withTestDirectory(async directory=>{
 const controller=new AbortController();controller.abort();const observed=await run(directory,'console.log("NEVER")',{controller});expect(observed.result.status).toBe('CANCELED');expect(observed.result.process).toBeNull();expect(observed.stdout).toBe('');
}));
it('awaits output callbacks with bounded backpressure and retains all lines',()=>withTestDirectory(async directory=>{
 let active=0,maximum=0;const observed=await run(directory,'for(let i=0;i<10000;i++)console.log("line "+i)',{async onOutput(){maximum=Math.max(maximum,++active);await new Promise(r=>setTimeout(r,5));active--;}});expect(observed.result.status).toBe('EXITED');expect(observed.stdout.trim().split('\n')).toHaveLength(10000);expect(maximum).toBe(1);
}));
it('treats failed evidence callbacks as errors and still cleans the owned job',()=>withTestDirectory(async directory=>{
 const observed=await run(directory,'setInterval(()=>console.log("line"),10)',{onOutput(){throw new Error('failed evidence sink');}});expect(observed.result.status).toBe('ERROR');expect(observed.result.provenance?.cleanup).toBe('VERIFIED');
}));
it('records separate original and retained bytes for stdout and stderr after redaction',()=>withTestDirectory(async directory=>{
 const observed=await run(directory,'process.stdout.write("private-token\\n");process.stderr.write("error\\n")');
 expect(observed.result.output).toMatchObject({original_bytes:20,streams:{stdout:{original_bytes:14,retained_bytes:Buffer.byteLength(observed.stdout),truncated:false,reason:null},stderr:{original_bytes:6,retained_bytes:6,truncated:false,reason:null}}});
}));
