import fs from 'node:fs/promises';
import path from 'node:path';
import type {ProjectConfig,TrustRecord} from '../../../contracts/src/index.js';
import {validateSchema} from '../../../contracts/src/index.js';
import {resolveBaseline} from '../../../adapter-git/src/baseline.js';
import {captureInputs} from '../../../adapter-git/src/input-manifest.js';
import {canonicalJson} from '../storage/canonical-json.js';
import {hashBytes} from '../storage/hash.js';
import {resolveWithin} from '../storage/safe-path.js';
import {UserTrustStore} from '../storage/user-trust-store.js';
import {loadConfiguration} from './config-service.js';
import {configNames} from './project-service.js';
import {configurationError} from './service-error.js';
const digest=(value:unknown)=>hashBytes(Buffer.from(canonicalJson(value)));
export interface ToolIdentity {executable:string;digest:string}
export interface ExecutionPermissions {allowed_origins:readonly string[];allowed_paths:readonly string[]}
export function buildExecutionPreview(config:ProjectConfig,policy:ExecutionPermissions,tools:Record<string,ToolIdentity>){
  const commands=Object.entries(config.commands).sort(([a],[b])=>a.localeCompare(b)).map(([id,c])=>({id,executable:tools[id]?.executable??null,tool_hash:tools[id]?.digest??null,args:[...c.args],cwd:config.workspaces[c.workspace]!.path,timeout_seconds:c.timeout_seconds}));
  return {commands,tools,environment_names:[...config.security.env_allowlist].sort(),network_targets:[...policy.allowed_origins].sort(),writable_paths:[...policy.allowed_paths].sort(),docker_operations:Object.entries(config.environments).filter(([,e])=>e.mode==='compose').map(([id,e])=>({environment:id,operation:'compose up/down',configuration:e.mode==='compose'?e.compose_file:'',services:e.mode==='compose'?e.services:[]})),runtime:'NOT_EXECUTED' as const};
}
export class TrustService {
  readonly root:string;readonly store:UserTrustStore;
  constructor(root:string,readonly options:{storeRoot?:string;additionalTools?:Record<string,string>}={}){this.root=path.resolve(root);this.store=new UserTrustStore(this.root,options.storeRoot);}
  private async snapshot(){
    await this.store.checkLocation();const names:string[]=[];
    for(const name of configNames)try{await fs.access(await resolveWithin(this.root,name));names.push(name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(names.length!==1)throw configurationError('Exactly one configuration is required');
    const config=await loadConfiguration(path.join(this.root,names[0]!),this.root),tools:Record<string,ToolIdentity>={},scriptInputs=new Set<string>();
    const resolveTool=async(exec:string,cwd:string)=>{
      const directories=(process.env.PATH??'').split(path.delimiter).filter(Boolean),extensions=process.platform==='win32'?['','.exe','.cmd','.bat']:[''];
      const candidates=path.isAbsolute(exec)?[exec]:/[\\/]/.test(exec)?[await resolveWithin(cwd,exec)]:directories.flatMap(dir=>extensions.map(ext=>path.join(dir,exec+ext)));
      for(const candidate of candidates)try{const executable=await fs.realpath(candidate),stat=await fs.stat(executable);if(!stat.isFile()||stat.size>150*1024*1024)continue;return {executable,digest:hashBytes(await fs.readFile(executable))};}catch(error){if(!['ENOENT','EACCES'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
      throw configurationError('Tool could not be resolved without execution: '+exec);
    };
    for(const [id,command] of Object.entries(config.commands)){
      const cwd=await resolveWithin(this.root,config.workspaces[command.workspace]!.path);if(!(await fs.stat(cwd)).isDirectory())throw configurationError('Command workspace is not a directory');tools[id]=await resolveTool(command.exec,cwd);
      const toolName=path.basename(tools[id]!.executable).toLowerCase().replace(/\.exe$/,'');
      const inlineFlags=/^node(?:js)?$/.test(toolName)?['-e','--eval','-p','--print']:/^python(?:\d+(?:\.\d+)*)?$/.test(toolName)?['-c']:/^(?:ba|z|da|k)?sh$/.test(toolName)?['-c']:/^(?:pwsh|powershell)$/.test(toolName)?['-Command','-command','-c']:toolName==='cmd'?['/c','/C']:[];
      let inline=false;
      for(const argument of command.args){
        if(inline){inline=false;continue;}
        if(inlineFlags.includes(argument)){inline=true;continue;}
        if(inlineFlags.some(flag=>flag.startsWith('--')&&argument.startsWith(flag+'=')))continue;
        const value=argument.startsWith('-')?(argument.includes('=')?argument.slice(argument.indexOf('=')+1):''):argument;
        if(!value||/^https?:\/\//i.test(value))continue;
        const pathLike=/[\\/]/.test(value)||/\.(?:[cm]?[jt]sx?|py|sh|ps1|cmd|bat|json|ya?ml|toml)$/i.test(value);
        const absolute=path.resolve(cwd,value),relative=path.relative(this.root,absolute).replaceAll(path.sep,'/');
        if(pathLike&&(path.isAbsolute(relative)||relative==='..'||relative.startsWith('../')||/^[A-Za-z]:/.test(relative)))throw configurationError('Command file arguments must remain inside the repository',id);
        if(!pathLike&&!/^[^<>:"/\\|?*\u0000-\u001f]+$/.test(value))continue;
        const file=await resolveWithin(this.root,relative);
        try{const stat=await fs.stat(file);if(stat.isFile())scriptInputs.add(relative);else if(!stat.isDirectory())throw configurationError('Command input must be an ordinary file or directory',id);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(/\.(?:[cm]?[jt]sx?|py|sh|ps1|cmd|bat)$/i.test(value))throw configurationError('Script input is missing',id);}
      }
    }
    for(const [id,executable] of Object.entries(this.options.additionalTools??{})){if(Object.hasOwn(tools,id))throw configurationError('Duplicate tool identity');tools[id]=await resolveTool(executable,this.root);}
    const baseline=await resolveBaseline({project_root:this.root,target_ref:'HEAD'}),configuration_hash=digest(config);
    const manifest=await captureInputs({project_id:config.project_id,repo_root:this.root,configuration_hash,workspaces:config.workspaces,contracts:config.contracts},baseline,{exclusions:[{relative_path:config.state_dir,reason:'StackGate state'}],include_ignored:[...Object.values(config.workspaces).map(w=>w.path),...scriptInputs].sort()});
    if(manifest.completeness!=='COMPLETE')throw configurationError('Execution inputs are incomplete');
    const execution_preview={...buildExecutionPreview(config,{allowed_origins:config.security.allow_origins,allowed_paths:[config.state_dir,...Object.values(config.workspaces).map(w=>w.path)]},tools),repo_id:manifest.repo_id,worktree_id:manifest.worktree_id,platform_id:manifest.platform_id,configuration_hash,script_input_hash:digest(manifest.files)};
    return {execution_preview,execution_digest:digest(execution_preview)};
  }
  async review(){
    const p=await this.snapshot(),record=await this.store.read(p.execution_digest);
    const equalSet=(left:readonly string[],right:readonly string[])=>canonicalJson([...left].sort())===canonicalJson([...right].sort());
    return {...p,already_trusted:!!record&&record.trust_source==='local-execution'&&record.trust_id==='trust_'+p.execution_digest&&record.repo_id===p.execution_preview.repo_id&&record.input_hash===p.execution_digest&&record.command_hash===digest(p.execution_preview.commands)&&equalSet(record.allowed_command_ids,p.execution_preview.commands.map(command=>command.id))&&equalSet(record.allowed_origins,p.execution_preview.network_targets)&&equalSet(record.allowed_paths,p.execution_preview.writable_paths)&&Date.parse(record.expires_at)>Date.now()};
  }
  async confirm(expected:string,context:{authorized:boolean}){
    if(context.authorized!==true||!/^[a-f0-9]{64}$/.test(expected))throw configurationError('Explicit reviewed digest and local authorization required');
    const before=await this.review();if(before.execution_digest!==expected)throw configurationError('Execution inputs changed; review again');
    if(before.already_trusted)return {execution_digest:expected,trust_ref:this.store.reference(expected),trusted:true};
    const current=await this.snapshot();if(current.execution_digest!==expected)throw configurationError('Inputs changed during trust confirmation');
    const p=current.execution_preview,ids=p.commands.map(c=>c.id);if(!ids.length)throw configurationError('No commands available to authorize');
    const record:TrustRecord={schema_version:'0.1',trust_id:'trust_'+expected,repo_id:p.repo_id,input_hash:expected,command_hash:digest(p.commands),allowed_command_ids:ids as [string,...string[]],allowed_origins:p.network_targets,allowed_paths:p.writable_paths,granted_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),trust_source:'local-execution'};
    if(!validateSchema('trust-record',record).ok)throw configurationError('Invalid local trust record');
    const previous=await this.store.readEntry(expected);
    return {execution_digest:expected,trust_ref:await this.store.write(record,previous??undefined),trusted:true};
  }
}
