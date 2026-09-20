import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import capability from '../../../../tools/oasdiff/capabilities.json';
import {hashBytes} from '../storage/hash.js';
import {resolveWithin} from '../storage/safe-path.js';
declare const STACKGATE_BUNDLED:boolean;
export interface TestedToolCapability {name:string;version:string;platform:string;expected_sha256:string}
export interface ResolvedTrustedTool {name:string;executable:string;version:string;digest:string;platform:string}
export type ToolResolution={status:'VERIFIED';tool:ResolvedTrustedTool}|{status:'BLOCKED';reason:'PLATFORM_UNVERIFIED'|'NOT_INSTALLED'|'DIGEST_MISMATCH'|'UNSAFE_INSTALLATION';platform:string};
/** Installation-owned roots only. Callers must never derive options from candidate config or PATH. */
export class ToolRegistryService {
 readonly root:string;
 constructor(readonly options:{installationRoot?:string;platform?:string}={}){
  const bundled=typeof STACKGATE_BUNDLED!=='undefined'&&STACKGATE_BUNDLED;
  this.root=path.resolve(options.installationRoot??fileURLToPath(new URL(bundled?'./':'../../../../',import.meta.url)));
 }
 async resolveOasdiff():Promise<ToolResolution>{
  const platform=this.options.platform??process.platform+'-'+process.arch;
  if(platform!==capability.platform)return {status:'BLOCKED',reason:'PLATFORM_UNVERIFIED',platform};
  const relative=`tools/bin/oasdiff-${capability.version}/oasdiff${platform.startsWith('win32-')?'.exe':''}`;
  try{
   const executable=await resolveWithin(this.root,relative),stat=await fs.lstat(executable);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>150*1024*1024)return {status:'BLOCKED',reason:'UNSAFE_INSTALLATION',platform};
   const digest=hashBytes(await fs.readFile(executable));
   if(digest!==capability.expected_sha256)return {status:'BLOCKED',reason:'DIGEST_MISMATCH',platform};
   return {status:'VERIFIED',tool:{name:capability.name,executable,version:capability.version,digest,platform}};
  }catch(error){return {status:'BLOCKED',reason:(error as NodeJS.ErrnoException).code==='ENOENT'?'NOT_INSTALLED':'UNSAFE_INSTALLATION',platform};}
 }
}
