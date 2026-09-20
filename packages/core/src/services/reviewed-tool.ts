import fs from 'node:fs/promises';
import path from 'node:path';
import {hashBytes} from '../storage/hash.js';
import {configurationError} from './service-error.js';
import {resolveWithin} from '../storage/safe-path.js';
import type {CommandIdentity} from '../ports/runner.js';
export interface ReviewedTool {executable:string;digest:string;invocation?:{identity:CommandIdentity;args_prefix:string[];verified_inputs:{path:string;digest:string}[];package_version?:string}}
const inside=(root:string,file:string)=>{const rel=path.relative(root,file);return !rel||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
export async function reviewedPathDirectories(root:string){
 const result:string[]=[];
 for(const dir of (process.env.PATH??'').split(path.delimiter)){
  if(!dir||!path.isAbsolute(dir))continue;
  try{const actual=await fs.realpath(dir);if(!inside(await fs.realpath(root),actual)&&(await fs.stat(actual)).isDirectory()&&!result.includes(actual))result.push(actual);}catch(error){if(!['ENOENT','EACCES','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
 }
 return result;
}
export async function fileIdentity(executable:string){
 const stat=await fs.lstat(executable);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>150*1024*1024)throw configurationError('Tool must be an ordinary bounded file');
 return {executable:await fs.realpath(executable),digest:hashBytes(await fs.readFile(executable))};
}
export async function resolveReviewedTool(exec:string,cwd:string,root:string,directories:readonly string[]):Promise<ReviewedTool>{
 const extensions=process.platform==='win32'?['.exe','.cmd','.bat','']:[''];
 const candidates=path.isAbsolute(exec)?[exec]:/[\\/]/.test(exec)?[await resolveWithin(cwd,exec)]:directories.flatMap(dir=>extensions.map(ext=>path.join(dir,exec.endsWith(ext)&&ext?exec:exec+ext)));
 let tool:ReviewedTool|undefined;
 for(const candidate of candidates)try{tool=await fileIdentity(candidate);break;}catch(error){if(!['ENOENT','EACCES','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
 if(!tool)throw configurationError('Tool could not be resolved from reviewed paths: '+exec);
 const current=await fileIdentity(process.execPath);
 const version=tool.digest===current.digest?process.version.slice(1):'UNKNOWN';
 if(!/\.(?:cmd|bat|ps1)$/i.test(tool.executable))return {...tool,invocation:{identity:{...tool,version},args_prefix:[],verified_inputs:[]}};
 const name=path.basename(tool.executable).toLowerCase();
 if(!['npm.cmd','pnpm.cmd'].includes(name)||inside(await fs.realpath(root),tool.executable))throw configurationError('Unsupported batch wrapper; register a native executable or reviewed Node entry explicitly');
 const manager=name.slice(0,-4),directory=path.dirname(tool.executable);
 const text=(await fs.readFile(tool.executable,'utf8')).replaceAll('\r\n','\n');
 if(!text.includes('node_modules\\'+manager+'\\bin\\')||!/%(?:~dp0|dp0%)/i.test(text))throw configurationError('Unrecognized package-manager wrapper layout');
 const packageRoot=path.join(directory,'node_modules',manager),metadata=await fileIdentity(path.join(packageRoot,'package.json'));
 const pkg=JSON.parse(await fs.readFile(metadata.executable,'utf8')) as {name?:string;version?:string;bin?:unknown};
 if(pkg.name!==manager||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pkg.version??''))throw configurationError('Package-manager metadata is not recognized');
 const entries=manager==='npm'?['bin/npm-cli.js']:['bin/pnpm.mjs','bin/pnpm.cjs','bin/pnpm.js'];
 let entry:Awaited<ReturnType<typeof fileIdentity>>|undefined;
 for(const relative of entries)try{entry=await fileIdentity(await resolveWithin(packageRoot,relative));break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(!entry)throw configurationError('Package-manager JavaScript entry is missing');
 let node=current;try{node=await fileIdentity(path.join(directory,'node.exe'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return {...tool,invocation:{identity:{...node,version:node.digest===current.digest?process.version.slice(1):'UNKNOWN'},args_prefix:[entry.executable],verified_inputs:[{path:tool.executable,digest:tool.digest},{path:entry.executable,digest:entry.digest},{path:metadata.executable,digest:metadata.digest}],package_version:pkg.version!}};
}
