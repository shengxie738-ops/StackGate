import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConfirmationRecord, Diagnostic, TaskPayload } from '../../../contracts/src/index.js';
import { isSafeId, isSha256, resolveOperationKey, parseOperationKey, validateSchema } from '../../../contracts/src/index.js';
import { resolveBaseline } from '../../../adapter-git/src/baseline.js';
import { captureInputs } from '../../../adapter-git/src/input-manifest.js';
import { inspectRepository } from '../../../adapter-git/src/repository.js';
import { canonicalJson } from '../storage/canonical-json.js';
import { hashBytes } from '../storage/hash.js';
import { resolveWithin } from '../storage/safe-path.js';
import { writeJsonAtomic } from '../storage/atomic-write.js';
import { ensureDirectoryWithin } from '../storage/task-revisions.js';
import { matchesPath, validatePathPattern } from '../domain/path-pattern.js';
import { loadConfiguration } from './config-service.js';
import { parseStrictDocument } from './strict-document.js';
import { configurationError, ServiceError } from './service-error.js';
import { configNames } from './project-service.js';
const digest=(value:unknown)=>hashBytes(Buffer.from(canonicalJson(value)));
export interface ConfirmationPreview {payload_hash:string;target_hash:string;protected_input_hash:string;configuration_hash:string;repo_id:string;worktree_id:string;task_id:string;revision:number;target_contract:string;required_checks:string[];required_test_ids:string[];expected_behavior:string[]}
export interface TaskValidation {task_id:string|null;revision:number|null;valid:boolean;confirmation_digest:string|null;confirmation_preview:ConfirmationPreview|null;diagnostics:Diagnostic[]}
export interface ReviewContext {authorized:boolean;source:'local-review'}
interface TaskSnapshot {service_id:string;task:TaskPayload;target:Buffer;protected_inputs:unknown;preview:ConfirmationPreview;confirmation_digest:string;state_dir:string}
interface ConfirmationIdentity {configuration_hash:string;repo_id:string;worktree_id:string;service_id:string}
export function protectedPrefix(pattern:string):string {
  validatePathPattern(pattern);
  const parts=pattern.split('/'),wildcard=parts.findIndex(part=>/[?*]/.test(part));
  if(wildcard===0)throw configurationError('Protected input patterns require a concrete directory prefix',pattern);
  return wildcard<0?pattern:parts.slice(0,wildcard).join('/');
}
function previewFor(task:TaskPayload,target:Buffer,protected_inputs:unknown,identity:ConfirmationIdentity):ConfirmationPreview {
  return {payload_hash:digest(task),target_hash:hashBytes(target),protected_input_hash:digest(protected_inputs),configuration_hash:identity.configuration_hash,repo_id:identity.repo_id,worktree_id:identity.worktree_id,task_id:task.task_id,revision:task.revision,target_contract:task.target_contract,required_checks:[...task.required_checks],required_test_ids:[...task.required_test_ids],expected_behavior:[...task.expected_behavior]};
}
function sealedIdentity(protected_inputs:unknown):ConfirmationIdentity {
  if(!protected_inputs||typeof protected_inputs!=='object'||Array.isArray(protected_inputs))throw configurationError('Stored protected snapshot is invalid');
  const value=(protected_inputs as Record<string,unknown>).identity;
  if(!value||typeof value!=='object'||Array.isArray(value))throw configurationError('Stored confirmation identity is missing');
  const identity=value as Record<string,unknown>;
  if(Object.keys(identity).sort().join(',')!=='configuration_hash,repo_id,service_id,worktree_id'||typeof identity.configuration_hash!=='string'||!isSha256(identity.configuration_hash)||!['repo_id','worktree_id','service_id'].every(key=>typeof identity[key]==='string'&&isSafeId(identity[key])))throw configurationError('Stored confirmation identity is invalid');
  return identity as unknown as ConfirmationIdentity;
}
export class TaskService {
  constructor(readonly root:string) {this.root=path.resolve(root);}
  private async configuration(){
    const found:string[]=[];for(const name of configNames)try{await fs.access(await resolveWithin(this.root,name));found.push(name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(found.length!==1)throw configurationError('Exactly one project configuration is required');
    return loadConfiguration(path.join(this.root,found[0]!),this.root);
  }
  private async snapshot(file:string):Promise<TaskSnapshot>{
    const relative=path.relative(this.root,path.resolve(file)).replaceAll(path.sep,'/');
    const taskPath=await resolveWithin(this.root,relative),stat=await fs.stat(taskPath);
    if(!stat.isFile()||stat.size>1048576)throw configurationError('Task size/type unsupported',relative);
    const parsed=validateSchema<TaskPayload>('task',parseStrictDocument(await fs.readFile(taskPath),relative));
    if(!parsed.ok)throw new ServiceError(64,parsed.diagnostics);const task=parsed.value;
    const config=await this.configuration();
    for(const id of task.required_checks)if(!Object.hasOwn(config.checks,id))throw configurationError('Unknown required check: '+id,'/required_checks');
    const services=Object.entries(config.contracts).filter(([,contract])=>contract.target_file===task.target_contract).map(([id])=>id);
    if(services.length!==1)throw configurationError('Target contract must identify one configured service','/target_contract');
    const targetPath=await resolveWithin(this.root,task.target_contract),targetStat=await fs.stat(targetPath);
    if(!targetStat.isFile()||targetStat.size>2097152)throw configurationError('Target contract size/type unsupported','/target_contract');
    const target=await fs.readFile(targetPath),document=parseStrictDocument(target,task.target_contract,{maxBytes:2097152}) as {paths?:Record<string,Record<string,unknown>>};
    for(const operation of task.required_operations){
      let key;try{key=parseOperationKey(resolveOperationKey(operation,services));}catch{throw configurationError('Invalid or ambiguous required operation','/required_operations');}
      if(key.service_id!==services[0]||!document.paths?.[key.path]?.[key.method.toLowerCase()])throw configurationError('Required operation missing from target service','/required_operations');
    }
    const baseline=await resolveBaseline({project_root:this.root,target_ref:'HEAD'});
    const configuration_hash=digest(config);
    const patterns=[...config.security.protected_inputs,relative,task.target_contract];
    const manifest=await captureInputs({project_id:config.project_id,repo_root:this.root,configuration_hash,workspaces:config.workspaces,contracts:config.contracts},baseline,{exclusions:[{relative_path:config.state_dir,reason:'Explicit StackGate state'}],include_ignored:[...new Set(patterns.map(protectedPrefix))]});
    if(manifest.completeness!=='COMPLETE')throw configurationError('Input scope cannot be confirmed completely: '+manifest.diagnostics.join('; '));
    const identity:ConfirmationIdentity={configuration_hash,repo_id:manifest.repo_id,worktree_id:manifest.worktree_id,service_id:services[0]!};
    const protected_inputs={identity,patterns,check_contracts:config.checks,files:manifest.files.filter(item=>patterns.some(pattern=>matchesPath(pattern,item.relative_path))).map(item=>({relative_path:item.relative_path,kind:item.kind,digest:item.digest,mode:item.mode}))};
    const preview=previewFor(task,target,protected_inputs,identity);
    return {service_id:services[0]!,task,target,protected_inputs,preview,confirmation_digest:digest(preview),state_dir:config.state_dir};
  }
  async validate(file:string):Promise<TaskValidation>{
    try{const snapshot=await this.snapshot(file);return {task_id:snapshot.task.task_id,revision:snapshot.task.revision,valid:true,confirmation_digest:snapshot.confirmation_digest,confirmation_preview:snapshot.preview,diagnostics:[]};}
    catch(error){return {task_id:null,revision:null,valid:false,confirmation_digest:null,confirmation_preview:null,diagnostics:error instanceof ServiceError?error.diagnostics:configurationError('Task inputs or baseline could not be read safely').diagnostics};}
  }
  async confirm(file:string,expected_payload_hash:string,review_context:ReviewContext){
    if(review_context.authorized!==true||review_context.source!=='local-review'||!/^[a-f0-9]{64}$/.test(expected_payload_hash??''))throw configurationError('CONFIRMATION_REQUIRED: explicit reviewed digest and authorized local context required');
    const snapshot=await this.snapshot(file);
    if(snapshot.confirmation_digest!==expected_payload_hash)throw configurationError('Confirmation inputs changed; review the new digest');
    const directory=`${snapshot.state_dir}/tasks/${snapshot.task.task_id}/revisions/${snapshot.task.revision}`;
    const ref=directory+'/confirmation.json';
    try{
      const existing=await this.loadConfirmed(snapshot.task.task_id,snapshot.task.revision);
      if(existing.confirmation_digest!==expected_payload_hash)throw configurationError('Revision already exists with different inputs; create a new revision');
      return {task_id:snapshot.task.task_id,revision:snapshot.task.revision,confirmation_ref:ref,confirmation_digest:expected_payload_hash};
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const parent=await ensureDirectoryWithin(this.root,path.posix.dirname(directory));
    const destination=path.join(parent,String(snapshot.task.revision));
    try{await fs.mkdir(destination);}catch{throw configurationError('Revision directory already exists or cannot be created; it will not be overwritten');}
    await writeJsonAtomic(path.join(destination,'task.json'),snapshot.task,{root:this.root});
    await fs.writeFile(path.join(destination,'target.contract'),snapshot.target,{flag:'wx',mode:0o600});
    await writeJsonAtomic(path.join(destination,'protected-inputs.json'),snapshot.protected_inputs,{root:this.root});
    await writeJsonAtomic(path.join(destination,'preview.json'),snapshot.preview,{root:this.root});
    const current=await this.snapshot(file);
    if(current.confirmation_digest!==expected_payload_hash)throw configurationError('Inputs changed during confirmation; incomplete revision left unsealed');
    const confirmation:ConfirmationRecord={schema_version:'0.1',task_id:snapshot.task.task_id,revision:snapshot.task.revision,payload_hash:snapshot.preview.payload_hash,target_hashes:{[snapshot.service_id]:snapshot.preview.target_hash},protected_input_hash:snapshot.preview.protected_input_hash,confirmed_at:new Date().toISOString(),confirmation_source:'local-review'};
    await writeJsonAtomic(path.join(destination,'confirmation.json'),confirmation,{root:this.root});
    return {task_id:snapshot.task.task_id,revision:snapshot.task.revision,confirmation_ref:ref,confirmation_digest:expected_payload_hash};
  }
  async loadConfirmed(task_id:string,revision:number){
    if(!isSafeId(task_id)||!Number.isSafeInteger(revision)||revision<1)throw configurationError('Invalid task identity');
    const config=await this.configuration(),directory=`${config.state_dir}/tasks/${task_id}/revisions/${revision}`;
    const read=async(name:string)=>fs.readFile(await resolveWithin(this.root,directory+'/'+name));
    const confirmation=validateSchema<ConfirmationRecord>('confirmation',parseStrictDocument(await read('confirmation.json'),'confirmation'));
    const task=validateSchema<TaskPayload>('task',parseStrictDocument(await read('task.json'),'task'));
    if(!confirmation.ok||!task.ok)throw configurationError('Stored confirmation structure is invalid');
    const target_bytes=await read('target.contract');
    const protected_inputs=parseStrictDocument(await read('protected-inputs.json'),'protected-inputs');
    const preview=parseStrictDocument(await read('preview.json'),'preview') as ConfirmationPreview;
    const record=confirmation.value;
    const identity=sealedIdentity(protected_inputs),repository=await inspectRepository(this.root);
    const services=Object.entries(config.contracts).filter(([,contract])=>contract.target_file===task.value.target_contract).map(([id])=>id);
    if(services.length!==1||services[0]!==identity.service_id)throw configurationError('Stored target has no unique matching service');
    if(identity.repo_id!==repository.repo_id||identity.worktree_id!==repository.worktree_id||canonicalJson(preview)!==canonicalJson(previewFor(task.value,target_bytes,protected_inputs,identity)))throw configurationError('Stored preview or repository identity mismatch');
    if(record.confirmation_source!=='local-review'||record.task_id!==task_id||record.revision!==revision||task.value.task_id!==task_id||task.value.revision!==revision||record.payload_hash!==digest(task.value)||record.target_hashes[services[0]!]!==hashBytes(target_bytes)||record.protected_input_hash!==digest(protected_inputs)||preview.payload_hash!==record.payload_hash||preview.target_hash!==hashBytes(target_bytes)||preview.protected_input_hash!==record.protected_input_hash)throw configurationError('Stored revision integrity mismatch');
    return {task:task.value,confirmation:record,target_bytes,protected_inputs,preview,confirmation_digest:digest(preview)};
  }
}
