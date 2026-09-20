import fs from 'node:fs/promises';
import path from 'node:path';
import type { Diagnostic, ProjectConfig } from '../../../contracts/src/index.js';
import { parseConfiguration } from './config-service.js';
import { inspectRepository } from '../../../adapter-git/src/repository.js';
import { resolveWithin } from '../storage/safe-path.js';
import { discoverCapabilities } from '../domain/capability-discovery.js';
import { parseStrictDocument } from './strict-document.js';
import { configurationError, ServiceError } from './service-error.js';
export interface CapabilitiesReport {
  schema_version:'0.1'; runtime:'NOT_EXECUTED'; capabilities:string[];missing:string[];unsupported:string[];conflicts:string[];diagnostics:Diagnostic[];
  configuration_file:string|null;git:{repo_id:string;worktree_id:string;git_object_format:string}|null;
  tools:Record<string,{status:'PRESENT_UNVERIFIED'|'MISSING'|'UNVERIFIED'}>;
}
export const configNames=['.stackgate.yaml','.stackgate.yml','.stackgate.json'];
async function availableExecutable(name:string):Promise<boolean>{
  // Presence inspection only. This result is never an execution authorization or tool capability proof.
  const candidates=path.isAbsolute(name)?[name]:(process.env.PATH??'').split(path.delimiter).filter(Boolean).flatMap(dir=>[name,...(process.platform==='win32'?['.exe','.cmd','.bat'].map(ext=>name+ext):[])].map(file=>path.join(dir,file)));
  for(const candidate of candidates)try{if((await fs.stat(candidate)).isFile())return true;}catch{/* absent */}
  return false;
}
export class ProjectService {
  async inspect(root:string):Promise<CapabilitiesReport>{
    const report:CapabilitiesReport={schema_version:'0.1',runtime:'NOT_EXECUTED',capabilities:[],missing:[],unsupported:[],conflicts:[],diagnostics:[],configuration_file:null,git:null,tools:{docker:{status:'UNVERIFIED'}}};
    const manifests:Record<string,unknown>={};
    async function read(name:string):Promise<Buffer|null>{
      try {const file=await resolveWithin(root,name);const stat=await fs.stat(file);if(!stat.isFile()||stat.size>1048576)throw configurationError('Manifest size or type is unsupported',name);return await fs.readFile(file);}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
    }
    try{
      for(const name of ['package.json','pyproject.toml','requirements.txt']){const bytes=await read(name);if(bytes)manifests[name]=name.endsWith('.json')?parseStrictDocument(bytes,name):new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
      report.capabilities=discoverCapabilities(manifests);
      const configurations: {name:string;bytes:Buffer}[]=[];
      for(const name of configNames){const bytes=await read(name);if(bytes)configurations.push({name,bytes});}
      if(configurations.length>1){report.conflicts.push('MULTIPLE_CONFIG_FILES');report.diagnostics.push(...configurationError('Multiple configuration files require explicit resolution').diagnostics);}
      else if(configurations[0]){
        const {name,bytes}=configurations[0];report.configuration_file=name;
        await inspectConfiguration(parseConfiguration(bytes,name));
      }else report.missing.push('PROJECT_CONFIG');
    }catch(error){report.diagnostics.push(...(error instanceof ServiceError?error.diagnostics:configurationError('Project input could not be read safely').diagnostics));}
    if(!report.capabilities.includes('openapi'))report.missing.push('OPENAPI_TARGET');
    try{const repository=await inspectRepository(root);report.git={repo_id:repository.repo_id,worktree_id:repository.worktree_id,git_object_format:repository.git_object_format};}catch{report.missing.push('GIT_REPOSITORY');}
    report.unsupported.push('RUNTIME_NOT_EXECUTED');
    if(process.platform!=='win32')report.unsupported.push('PLATFORM_NOT_VERIFIED');
    return report;
    async function inspectConfiguration(config:ProjectConfig){
      for(const [id,workspace]of Object.entries(config.workspaces))try{if(!(await fs.stat(await resolveWithin(root,workspace.path))).isDirectory())report.missing.push('WORKSPACE:'+id);}catch{report.missing.push('WORKSPACE:'+id);}
      for(const [id,contract]of Object.entries(config.contracts)){const bytes=await read(contract.target_file);if(bytes)report.capabilities.push('openapi');else report.missing.push('CONTRACT:'+id);}
      for(const [id,command]of Object.entries(config.commands)){const present=await availableExecutable(command.exec);report.tools[id]={status:present?'PRESENT_UNVERIFIED':'MISSING'};if(!present)report.missing.push('COMMAND:'+id);}
    }
  }
}
