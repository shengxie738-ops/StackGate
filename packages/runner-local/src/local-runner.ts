import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import type {Diagnostic} from '../../contracts/src/index.js';
import type {RunnerPort,RunnerResult,ProcessIdentity,ResolvedCommand,OutputRetention} from '../../core/src/ports/runner.js';
import {hashBytes} from '../../core/src/storage/hash.js';
import {RedactionStream} from '../../core/src/evidence/redaction.js';
import {EvidenceBudget} from '../../core/src/evidence/budget.js';
import {readRunnerProvenance} from './provenance.js';
function diagnostic(code:Diagnostic['code'],message:string,observed_facts:Record<string,unknown>={}):Diagnostic{return {code,rule_id:'SG-RUNTIME-PROCESS',message,source:'local-runner',location:'',observed_facts,recommended_action:'Preserve process evidence and review the exact local execution identity.'};}
async function verify(command:ResolvedCommand){
 if(!path.isAbsolute(command.identity.executable)||!path.isAbsolute(command.cwd)||!Number.isSafeInteger(command.timeout_ms)||command.timeout_ms<1||command.timeout_ms>86400000||/\.(cmd|bat|ps1)$/i.test(command.identity.executable))throw new Error('Invalid resolved command');
 for(const value of command.args)if(value.includes('\0'))throw new Error('Invalid argv');
 for(const [key,value]of Object.entries(command.environment))if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||value.includes('\0'))throw new Error('Invalid environment');
 for(const file of [{path:command.identity.executable,digest:command.identity.digest},...command.verified_inputs??[]]){
  const stat=await fs.lstat(file.path);if(!path.isAbsolute(file.path)||!stat.isFile()||stat.isSymbolicLink()||stat.size>150*1024*1024||hashBytes(await fs.readFile(file.path))!==file.digest)throw new Error('Resolved input identity changed');
 }
}
/** Never accepts a persisted PID as authority: only live child handles/private jobs created here. */
export class LocalRunner implements RunnerPort {
 constructor(readonly options:{max_output_bytes?:number}={}){}
 async run(command:ResolvedCommand,context:Parameters<RunnerPort['run']>[1]):Promise<RunnerResult>{
  command=structuredClone(command);const diagnostics:Diagnostic[]=[];let identity:ProcessIdentity|null=null,finalResult:RunnerResult|undefined,brokerVersion:string|undefined,cleanup:'VERIFIED'|'UNVERIFIED'='UNVERIFIED',original=0,retained=0,outputReason:NonNullable<RunnerResult['output']>['reason']=null;
  const counts:Record<'stdout'|'stderr',OutputRetention>={stdout:{original_bytes:0,retained_bytes:0,truncated:false,reason:null},stderr:{original_bytes:0,retained_bytes:0,truncated:false,reason:null}};
  const result=(status:RunnerResult['status'],exit:number|null=null,signal:string|null=null):RunnerResult=>finalResult={status,raw_exit_code:exit,signal,process:identity,artifacts:[],diagnostics,output:{original_bytes:original,retained_bytes:retained,truncated:outputReason!==null,reason:outputReason,streams:counts},provenance:{mechanism:process.platform==='win32'?'WINDOWS_JOB_OBJECT':'UNSUPPORTED',cleanup,...(brokerVersion?{broker_version:brokerVersion}:{})},execution:{command_id:command.command_id,command_hash:command.command_hash,authorization_hash:command.authorization_hash,executable_digest:command.identity.digest}};
  if(context.signal.aborted){cleanup='VERIFIED';return result('CANCELED');}
  const limit=this.options.max_output_bytes??4*1024*1024;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100*1024*1024){diagnostics.push(diagnostic('CONFIG_INVALID','Invalid runner output budget'));return result('ERROR');}
  try{await verify(command);}catch{diagnostics.push(diagnostic('EXECUTION_UNTRUSTED','Executable or reviewed input identity is missing, unsafe or changed'));return result('ERROR');}
  const provenance=await readRunnerProvenance();if(provenance.status!=='AVAILABLE'){diagnostics.push(diagnostic('UNSUPPORTED_CAPABILITY','Owned process runner is unavailable'));return result('ERROR');}
  let directory:string|undefined,directoryIdentity:Awaited<ReturnType<typeof fs.stat>>|undefined,child:ChildProcess|undefined,stop:'TIMED_OUT'|'CANCELED'|'ERROR'|undefined;
  let killTimer:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setTimeout>|undefined,cancelWritten=false,closedAlready=false;
  const owner=randomUUID(),secrets=Object.entries(command.environment).filter(([key])=>!['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','COMSPEC','PATHEXT','STACKGATE_RUN_ID','STACKGATE_CHECK_ID','STACKGATE_ATTEMPT_ID','STACKGATE_OUTPUT_DIR','STACKGATE_ALLOWED_ORIGINS'].includes(key.toUpperCase())).map(([,value])=>value);
  const streams={stdout:new RedactionStream(secrets),stderr:new RedactionStream(secrets)};
  const budget=new EvidenceBudget({totalBytes:limit,reservedCriticalBytes:0});
  const terminate=(cause:typeof stop)=>{stop??=cause;if(cancelWritten||!directory||!child||child.exitCode!==null||child.signalCode!==null)return;cancelWritten=true;
   void fs.writeFile(path.join(directory,'cancel.tmp'),owner+'\n'+stop,{flag:'wx'}).then(()=>fs.rename(path.join(directory!,'cancel.tmp'),path.join(directory!,'cancel.txt'))).catch(()=>{diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED','Cooperative job cancellation could not be requested'));stop='ERROR';child?.kill();});
   killTimer=setTimeout(()=>{if(child?.exitCode===null&&child.signalCode===null){diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED','Broker did not acknowledge bounded owned-job cleanup'));stop='ERROR';child.kill();}},5000);
  };
  const aborted=()=>terminate('CANCELED');context.signal.addEventListener('abort',aborted,{once:true});
  let poll:ReturnType<typeof setInterval>|undefined,startup:ReturnType<typeof setTimeout>|undefined;
  try{
   if(process.platform==='win32'){
    directory=await fs.mkdtemp(path.join(os.tmpdir(),'stackgate-process-'));
    directoryIdentity=await fs.stat(directory);
    const brokerEnvironment:NodeJS.ProcessEnv={SystemRoot:process.env.SystemRoot??'C:\\Windows',WINDIR:process.env.SystemRoot??'C:\\Windows',TEMP:directory,TMP:directory};
    await verify(command);
    child=spawn(provenance.files[0]!.path,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',provenance.files[1]!.path],{cwd:directory,env:brokerEnvironment,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.stdin!.on('error',()=>{ /* close/error below remains authoritative */ });
    child.stdin!.write(JSON.stringify({executable:command.identity.executable,args:command.args,cwd:command.cwd,environment:command.environment,status_directory:directory,owner_token:owner})+'\n');
    let checking=false;
    const inspect=async()=>{if(checking||identity||!directory||closedAlready)return;checking=true;try{const parsed=JSON.parse(await fs.readFile(path.join(directory,'started.json'),'utf8'));if(closedAlready)return;if(parsed.owner_token!==owner||parsed.job_assigned!==true||!Number.isInteger(parsed.pid)||!/^\d+$/.test(parsed.creation_identity))throw new Error('Invalid broker identity');identity={pid:parsed.pid,creation_identity:parsed.creation_identity,owner_token:owner};brokerVersion=parsed.broker_version;clearTimeout(startup);timer=setTimeout(()=>terminate('TIMED_OUT'),command.timeout_ms);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED','Broker creation identity could not be verified'));terminate('ERROR');}}finally{checking=false;}};
    poll=setInterval(()=>{void inspect();},20);startup=setTimeout(()=>{diagnostics.push(diagnostic('TOOL_FAILURE','Process broker did not establish ownership within the startup deadline'));terminate('ERROR');},15000);
   }else throw new Error('Unverified process ownership platform');
   const active=child;
   const closed=new Promise<{exit:number|null;signal:string|null}>(resolve=>{active.once('error',()=>{diagnostics.push(diagnostic('TOOL_FAILURE','Process could not be started'));stop='ERROR';});active.once('close',(exit,signal)=>{closedAlready=true;resolve({exit,signal});});});
   if(context.signal.aborted)aborted();
   const consume=async(stream:'stdout'|'stderr')=>{
    const source=active[stream]!;
    const deliver=async(bytes:Uint8Array)=>{let timeout:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([context[stream](bytes),new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('Output callback deadline')),5000);})]);}finally{clearTimeout(timeout);}};
    const retain=async(text:string)=>{const kept=budget.retain(Buffer.from(text),false).bytes;if(kept.length)await deliver(kept);retained+=kept.length;counts[stream].retained_bytes+=kept.length;return kept.length<Buffer.byteLength(text);};
    const exceeded=(budgetExceeded:boolean)=>{const reason=budgetExceeded?'ARTIFACT_BUDGET_EXCEEDED':'REDACTION_LINE_LIMIT';outputReason=reason;counts[stream].truncated=true;counts[stream].reason=reason;if(!diagnostics.some(d=>d.code==='ARTIFACT_BUDGET_EXCEEDED'))diagnostics.push(diagnostic('ARTIFACT_BUDGET_EXCEEDED','Process output exceeded the retained evidence budget'));terminate('ERROR');};
    try{for await(const chunk of source){original+=chunk.length;counts[stream].original_bytes+=chunk.length;const text=streams[stream].push(chunk),clipped=await retain(text);
      if(original>limit||clipped||streams[stream].retention().truncated)exceeded(original>limit||clipped);}
     const clipped=await retain(streams[stream].finish());if(clipped||streams[stream].retention().truncated)exceeded(clipped);
    }catch{diagnostics.push(diagnostic('TOOL_FAILURE','Output stream or evidence callback failed'));terminate('ERROR');}
   };
   const [observed]=await Promise.all([closed,consume('stdout'),consume('stderr')]);
   clearInterval(poll);clearTimeout(startup);clearTimeout(timer);clearTimeout(killTimer);
   if(process.platform==='win32'){
    if(!identity)try{const parsed=JSON.parse(await fs.readFile(path.join(directory!,'started.json'),'utf8'));if(parsed.owner_token===owner&&parsed.job_assigned===true){identity={pid:parsed.pid,creation_identity:parsed.creation_identity,owner_token:owner};brokerVersion=parsed.broker_version;}}catch{ /* startup failure has no child identity */ }
    try{const final=JSON.parse(await fs.readFile(path.join(directory!,'finished.json'),'utf8'));if(observed.exit!==0||!identity&&final.not_started!==true||final.owner_token!==owner||final.cleanup_complete!==true||!stop&&!Number.isInteger(final.raw_exit_code))throw new Error('Broker did not seal termination');cleanup='VERIFIED';return result(stop??'EXITED',stop?null:final.raw_exit_code,null);}catch{diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED','Owned job completion could not be verified'));return result('ERROR');}
   }
   return result(stop??'EXITED',stop?null:observed.exit,observed.signal);
  }catch{diagnostics.push(diagnostic('TOOL_FAILURE','Local runner could not complete the reviewed operation'));terminate('ERROR');return result('ERROR');}
  finally{
   context.signal.removeEventListener('abort',aborted);clearInterval(poll);clearTimeout(startup);clearTimeout(timer);clearTimeout(killTimer);
   if(directory)try{const parent=await fs.realpath(os.tmpdir()),actual=path.resolve(directory),stat=await fs.lstat(actual);if(path.dirname(actual)!==parent||!path.basename(actual).startsWith('stackgate-process-')||stat.isSymbolicLink()||stat.dev!==directoryIdentity?.dev||stat.ino!==directoryIdentity?.ino)throw new Error('Changed owner');await fs.rm(actual,{recursive:true,force:true});}catch{diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED','Process temporary directory cleanup ownership could not be verified'));if(finalResult){finalResult.status='ERROR';if(finalResult.provenance)finalResult.provenance.cleanup='UNVERIFIED';}}
  }
 }
}
