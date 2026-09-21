import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {inspectPathWithin} from './safe-path.js';
import {ensureDirectoryWithin} from './task-revisions.js';
import {hashBytes} from './hash.js';
import {StorageError} from './storage-error.js';
export async function strictPath(root:string,relative:string):Promise<string>{const p=await inspectPathWithin(root,relative);if(p.links.length)throw new StorageError('UNSAFE_PATH','Evidence paths cannot contain links');return p.path;}
export function assertRunId(id:string):void{if(!/^run_[A-Za-z0-9_-]+$/.test(id))throw new StorageError('UNSAFE_PATH','Invalid run identity');}
export async function prepareState(root:string):Promise<void>{
 const absolute=path.resolve(root);if(absolute===path.parse(absolute).root||absolute===path.resolve(os.homedir()))throw new StorageError('UNSAFE_PATH','State requires a dedicated explicit directory');
 // Only the explicit final component may be created; never recursively create arbitrary ancestors.
 const parent=path.dirname(absolute);await strictPath(parent,path.basename(absolute));
 try{await fs.mkdir(absolute);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 await strictPath(absolute,'runs');await ensureDirectoryWithin(absolute,'runs');
}
/** Cooperating process lock; never reap another process's lock using PID guesses. */
export async function withRunLock<T>(root:string,action:()=>Promise<T>):Promise<T>{
 const rootIdentity=await fs.stat(root,{bigint:true}),token=randomUUID();let lockPath='',lock:Awaited<ReturnType<typeof fs.open>>|undefined;
 for(let attempt=0;attempt<200;attempt++){
  try{
   // Resolve a unique missing leaf, never the other writer's concurrently removed lock.
   // Exclusive creation cannot follow an existing file or symlink at the lock path.
   const probe=await strictPath(root,'.sg-lock-probe-'+token),identity=await fs.stat(root,{bigint:true});
   if(identity.dev!==rootIdentity.dev||identity.ino!==rootIdentity.ino)throw new StorageError('UNSAFE_PATH','Lock directory changed before acquisition');
   lockPath=path.join(path.dirname(probe),'.write-lock');lock=await fs.open(lockPath,'wx',0o600);break;
  }catch(error){
   // Windows can report sharing violations while the prior owner closes/unlinks its lock.
   const transient=['EEXIST','ENOENT',...(process.platform==='win32'?['EPERM','EACCES']:[])];
   if(!transient.includes((error as NodeJS.ErrnoException).code??''))throw error;await new Promise(resolve=>setTimeout(resolve,10));
  }
 }
 if(!lock)throw new StorageError('WRITE_BUSY','Run lock is busy or needs explicit ownership recovery');
 const acquiredRoot=await fs.stat(root,{bigint:true});if(acquiredRoot.dev!==rootIdentity.dev||acquiredRoot.ino!==rootIdentity.ino){await lock.close();throw new StorageError('UNSAFE_PATH','Lock directory changed during acquisition');}
 const record=JSON.stringify({token,pid:process.pid,process_started_at:Math.floor(Date.now()-process.uptime()*1000),created_at:new Date().toISOString()});
 await lock.writeFile(record);await lock.sync();await lock.close();
 try{return await action();}finally{
  const identity=await fs.stat(root,{bigint:true});if(identity.dev!==rootIdentity.dev||identity.ino!==rootIdentity.ino)throw new StorageError('UNSAFE_PATH','Lock directory changed; refusing cleanup');
  const checked=await strictPath(root,'.write-lock');if(await fs.readFile(checked,'utf8')!==record)throw new StorageError('TARGET_CHANGED','Lock ownership changed; refusing cleanup');await fs.unlink(checked);
 }
}
/** Must run under an owner lock. Crash can leave a private temp; last committed bytes remain intact. */
export async function writeBytesAtomic(root:string,relative:string,bytes:Uint8Array,expectedHash?:string):Promise<void>{
 const target=await strictPath(root,relative),parent=path.dirname(target),parentIdentity=await fs.stat(parent,{bigint:true}),rootIdentity=await fs.stat(root,{bigint:true});
 const checkDirectory=async()=>{const current=await strictPath(root,relative),identity=await fs.stat(parent,{bigint:true}),currentRoot=await fs.stat(root,{bigint:true});if(current!==target||identity.dev!==parentIdentity.dev||identity.ino!==parentIdentity.ino||currentRoot.dev!==rootIdentity.dev||currentRoot.ino!==rootIdentity.ino)throw new StorageError('UNSAFE_PATH','Evidence directory changed');};
 const check=async()=>{await checkDirectory();
  try{const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new StorageError('UNSAFE_PATH','Evidence target is not an ordinary private file');if(expectedHash===undefined)throw new StorageError('TARGET_EXISTS','Evidence already exists');if(hashBytes(await fs.readFile(target))!==expectedHash)throw new StorageError('TARGET_CHANGED','Evidence changed before atomic update');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(expectedHash!==undefined)throw new StorageError('TARGET_CHANGED','Expected evidence is missing');}};
 await check();const temporary=path.join(parent,'.sg-tmp-'+randomUUID());const handle=await fs.open(temporary,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 try{await check();if(expectedHash===undefined)await fs.link(temporary,target);else await fs.rename(temporary,target);}
 finally{await checkDirectory();await strictPath(root,path.relative(root,temporary));await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
