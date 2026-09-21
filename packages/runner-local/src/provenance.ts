import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashBytes} from '../../core/src/storage/hash.js';
declare const STACKGATE_BUNDLED:boolean;
export async function readRunnerProvenance(){
 const platform=process.platform+'-'+process.arch;
 if(process.platform!=='win32')return {platform,mechanism:'POSIX_PROCESS_GROUP_UNVERIFIED',status:'UNAVAILABLE' as const,files:[] as {path:string;digest:string}[]};
 const bundled=typeof STACKGATE_BUNDLED!=='undefined'&&STACKGATE_BUNDLED;
 const root=fileURLToPath(new URL(bundled?'./runner-local/':'./',import.meta.url));
 const paths=[path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),path.join(root,'windows-job.ps1'),path.join(root,'windows-job.cs')];
 try{
  const files=[];for(const file of paths){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw new Error('Unsafe broker file');files.push({path:await fs.realpath(file),digest:hashBytes(await fs.readFile(file))});}
  return {platform,mechanism:'WINDOWS_JOB_OBJECT',status:'AVAILABLE' as const,files};
 }catch{return {platform,mechanism:'WINDOWS_JOB_OBJECT',status:'UNAVAILABLE' as const,files:[] as {path:string;digest:string}[]};}
}
