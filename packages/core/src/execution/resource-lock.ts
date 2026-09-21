import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hashBytes} from '../storage/hash.js';
import {UserTrustStore} from '../storage/user-trust-store.js';
import {ensureDirectoryWithin} from '../storage/task-revisions.js';
import {inspectPathWithin} from '../storage/safe-path.js';
const exec=promisify(execFile);
async function processIdentity():Promise<string>{
 if(process.platform==='win32'){
  const executable=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=await exec(executable,['-NoProfile','-NonInteractive','-Command',`[System.Diagnostics.Process]::GetProcessById(${process.pid}).StartTime.ToUniversalTime().Ticks`],{windowsHide:true,timeout:5000,maxBuffer:4096});
  const identity=result.stdout.trim();if(!/^\d+$/.test(identity))throw Error('Process creation identity is unavailable');return identity;
 }
 if(process.platform==='linux'){
  const stat=await fs.readFile(`/proc/${process.pid}/stat`,'utf8'),start=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19],boot=(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();
  if(!start||!/^\d+$/.test(start)||!boot)throw Error('Process creation identity is unavailable');return boot+':'+start;
 }
 throw Error('Process creation identity is unsupported on this platform');
}
export interface LockContext {repo_root:string;worktree_id:string;platform_id:string;run_id:string;owner_token:string;lockRoot?:string}
export interface ResourceLease {release():Promise<void>}
export async function acquireResources(resources:readonly string[],context:LockContext):Promise<ResourceLease|null>{
 if(!context.owner_token||!context.run_id||!context.worktree_id||!context.platform_id)throw Error('Resource owner identity is incomplete');
 if(resources.some(resource=>! /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(resource)))throw Error('Invalid resource identity');
 if(!resources.length)return {async release(){}};
 const root=path.resolve(context.lockRoot??path.join(os.homedir(),process.platform==='win32'?'AppData/Local/StackGate':process.platform==='darwin'?'Library/Application Support/StackGate':'.local/share/StackGate','execution-locks'));
 const ancestor=await new UserTrustStore(context.repo_root,root).checkLocation();
 if(ancestor!==root)await ensureDirectoryWithin(ancestor,path.relative(ancestor,root).replaceAll(path.sep,'/'));
 const directory=hashBytes(Buffer.from(JSON.stringify([context.platform_id,context.worktree_id])));await ensureDirectoryWithin(root,directory);
 const creation=await processIdentity(),held:{relative:string;bytes:Buffer;ino:number;dev:number}[]=[];
 const release=async()=>{
  if(await processIdentity()!==creation)throw Error('Resource owner process creation identity changed');
  const errors:string[]=[];
  for(const lock of [...held].reverse())try{
   const inspected=await inspectPathWithin(root,lock.relative),stat=await fs.lstat(inspected.path);
   if(inspected.links.length||!stat.isFile()||stat.nlink!==1||stat.ino!==lock.ino||stat.dev!==lock.dev||stat.size!==lock.bytes.length||!Buffer.from(await fs.readFile(inspected.path)).equals(lock.bytes))throw Error('Resource ownership record was replaced or modified');
   await fs.unlink(inspected.path);held.splice(held.indexOf(lock),1);
  }catch(error){errors.push(error instanceof Error?error.message:'Resource release failed');}
  if(errors.length)throw Error(errors.join('; '));
 };
 try{
  for(const resource of [...new Set(resources)].sort()){
   const relative=directory+'/'+resource+'.lock',inspected=await inspectPathWithin(root,relative);
   if(inspected.links.length)throw Error('Resource lock paths cannot contain links');
   let handle;try{handle=await fs.open(inspected.path,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST'){await release();return null;}throw error;}
   const bytes=Buffer.from(JSON.stringify({schema_version:'0.1',resource_id:resource,platform_id:context.platform_id,worktree_id:context.worktree_id,run_id:context.run_id,owner_token:context.owner_token,pid:process.pid,process_creation_identity:creation}));
   try{await handle.writeFile(bytes);await handle.sync();const stat=await handle.stat();held.push({relative,bytes,ino:stat.ino,dev:stat.dev});}finally{await handle.close();}
  }
  return {release};
 }catch(error){await release();throw error;}
}
