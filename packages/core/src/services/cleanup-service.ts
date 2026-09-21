import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {validateSchema,type CommandExecution} from '../../../contracts/src/index.js';
import type {ExecutionOwner} from '../../../contracts/src/generated/execution-owner.js';
import {FileEvidenceStore} from '../storage/file-evidence-store.js';
import {canonicalJson} from '../storage/canonical-json.js';
import {hashBytes} from '../storage/hash.js';
export interface CleanupResource {kind:'file'|'directory'|'process'|'lock';action:'DELETE'|'PRESERVE';path:string;identity:string;digest:string|null;reason:string}
export interface CleanupPlan {run_id:string;state_root:string;status:'READY'|'BLOCKED'|'EMPTY';seal_hash:string|null;plan_hash:string;resources:CleanupResource[];diagnostics:string[]}
export interface CleanupResult {status:'APPLIED'|'EMPTY'|'ERROR';deleted:string[];diagnostics:string[]}
async function safeAncestors(target:string){let current=path.resolve(target);while(true){const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('UNSAFE_PATH');const parent=path.dirname(current);if(parent===current)break;current=parent;}}
const fileIdentity=(stat:{dev:bigint;ino:bigint})=>`${stat.dev}:${stat.ino}`;
const planHash=(plan:Omit<CleanupPlan,'plan_hash'>)=>hashBytes(Buffer.from(canonicalJson(plan)));
/** Read-only preview by default. Historical PIDs are evidence, never kill authority. */
export class CleanupService {
 constructor(readonly options:{stateRoot:string;owner:{repo_id:string;worktree_id:string};lockRoot?:string}){}
 async planCleanup(run_id:string):Promise<CleanupPlan>{
  const plan:Omit<CleanupPlan,'plan_hash'>={run_id,state_root:path.resolve(this.options.stateRoot),status:'BLOCKED',seal_hash:null,resources:[],diagnostics:[]};
  try{
   if(!/^run_[A-Za-z0-9_-]+$/.test(run_id))throw Error('INVALID_RUN_ID');await safeAncestors(plan.state_root);
   const store=new FileEvidenceStore(this.options),snapshot=await store.readRun(run_id);
   if(snapshot.status!=='VALID'||!snapshot.manifest||!['COMPLETED','CANCELED','ABORTED'].includes(snapshot.manifest.phase))throw Error('RUN_COMPLETION_UNVERIFIED');
   plan.seal_hash=hashBytes(await fs.readFile(path.join(plan.state_root,'runs',run_id,'seal.json')));
   const commandScopes=new Set<string>();
   for(const artifact of snapshot.artifacts.filter(a=>a.relative_path.endsWith('/command-execution.json'))){
    const read=await store.read({run_id,relative_path:artifact.relative_path,expected_digest:artifact.digest,max_bytes:1024*1024});if(read.status!=='FOUND')throw Error('PROCESS_COMPLETION_UNVERIFIED');
    const checked=validateSchema<CommandExecution>('command-execution',JSON.parse(Buffer.from(read.bytes).toString()));if(!checked.ok||checked.value.run_id!==run_id||checked.value.check_id!==artifact.check_id||checked.value.attempt_id!==artifact.attempt_id)throw Error('PROCESS_COMPLETION_UNVERIFIED');
    const fact=checked.value;commandScopes.add(fact.check_id+'/'+fact.attempt_id);
    if(fact.result.process)plan.resources.push({kind:'process',action:'PRESERVE',path:'',identity:canonicalJson(fact.result.process),digest:null,reason:'HISTORICAL_PID_IS_NOT_KILL_AUTHORITY'});
    if(fact.result.provenance?.cleanup!=='VERIFIED')throw Error('PROCESS_COMPLETION_UNVERIFIED');
   }
   for(const event of snapshot.events)if(event.type==='check.started'&&!commandScopes.has(event.payload.check_id+'/'+event.payload.attempt_id))throw Error('PROCESS_COMPLETION_UNVERIFIED');
   const lockRoot=path.resolve(this.options.lockRoot??path.join(os.homedir(),process.platform==='win32'?'AppData/Local/StackGate':process.platform==='darwin'?'Library/Application Support/StackGate':'.local/share/StackGate','execution-locks'));
   let locksExist=true;try{await fs.lstat(lockRoot);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')locksExist=false;else throw error;}
   if(locksExist){await safeAncestors(lockRoot);let count=0;const scan=async(directory:string,depth:number):Promise<void>=>{if(depth>2)throw Error('LOCK_OWNERSHIP_UNVERIFIED');for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(++count>10000)throw Error('LOCK_OWNERSHIP_UNVERIFIED');const target=path.join(directory,entry.name),stat=await fs.lstat(target);if(stat.isSymbolicLink())throw Error('LOCK_OWNERSHIP_UNVERIFIED');if(stat.isDirectory()){await scan(target,depth+1);continue;}if(!stat.isFile()||stat.nlink!==1||stat.size>16384)throw Error('LOCK_OWNERSHIP_UNVERIFIED');const value=JSON.parse(await fs.readFile(target,'utf8'));if(typeof value.run_id!=='string')throw Error('LOCK_OWNERSHIP_UNVERIFIED');if(value.run_id===run_id){plan.resources.push({kind:'lock',action:'PRESERVE',path:target,identity:String(value.process_creation_identity??'UNKNOWN'),digest:null,reason:'LIVE_OR_STALE_LOCK_REQUIRES_OWNING_PROCESS'});throw Error('LOCK_OWNERSHIP_UNVERIFIED');}}};await scan(lockRoot,0);}
   const work=path.join(plan.state_root,'work',run_id);let exists=true;try{await fs.lstat(work);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')exists=false;else throw error;}
   if(!exists){plan.status='EMPTY';return {...plan,plan_hash:planHash(plan)};}await safeAncestors(work);
   const marker=path.join(work,'owner.json'),markerStat=await fs.lstat(marker);if(!markerStat.isFile()||markerStat.isSymbolicLink()||markerStat.nlink!==1||markerStat.size>16384)throw Error('OWNER_UNVERIFIED');
   const checked=validateSchema<ExecutionOwner>('execution-owner',JSON.parse(await fs.readFile(marker,'utf8')));if(!checked.ok||checked.value.run_id!==run_id||checked.value.repo_id!==this.options.owner.repo_id||checked.value.worktree_id!==this.options.owner.worktree_id)throw Error('OWNER_UNVERIFIED');
   let bytes=0,count=0;const inventory=async(target:string,depth:number):Promise<void>=>{
    if(depth>32||++count>10000)throw Error('WORKSPACE_BUDGET_EXCEEDED');const stat=await fs.lstat(target,{bigint:true});if(stat.isSymbolicLink())throw Error('UNSAFE_PATH');
    if(stat.isDirectory()){plan.resources.push({kind:'directory',action:'DELETE',path:target,identity:fileIdentity(stat),digest:null,reason:'OWNED_TERMINAL_WORKSPACE'});for(const name of (await fs.readdir(target)).sort())await inventory(path.join(target,name),depth+1);}
    else if(stat.isFile()&&stat.nlink===1n){if(/(?:^|[.])lock$/i.test(path.basename(target)))throw Error('LOCK_OWNERSHIP_UNVERIFIED');bytes+=Number(stat.size);if(bytes>256*1024*1024)throw Error('WORKSPACE_BUDGET_EXCEEDED');const content=await fs.readFile(target);if(BigInt(content.length)!==stat.size)throw Error('WORKSPACE_CHANGED');plan.resources.push({kind:'file',action:'DELETE',path:target,identity:fileIdentity(stat),digest:hashBytes(content),reason:'OWNED_TERMINAL_WORKSPACE'});}
    else throw Error('UNSAFE_PATH');
   };await inventory(work,0);plan.status='READY';
  }catch(error){plan.status='BLOCKED';for(const resource of plan.resources)resource.action='PRESERVE';plan.diagnostics.push(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'OWNERSHIP_UNVERIFIED');}
  return {...plan,plan_hash:planHash(plan)};
 }
 async applyCleanup(plan:CleanupPlan,expected_hash:string):Promise<CleanupResult>{
  const deleted:string[]=[];
  try{
   const current=await this.planCleanup(plan.run_id);if(current.status==='BLOCKED'||current.plan_hash!==expected_hash||canonicalJson(current)!==canonicalJson(plan))throw Error('CLEANUP_PLAN_CHANGED_OR_UNVERIFIED');
   if(current.status==='EMPTY')return {status:'EMPTY',deleted,diagnostics:[]};
   const workspace=path.resolve(this.options.stateRoot,'work',plan.run_id),stateRoot=path.resolve(this.options.stateRoot);
   if(path.dirname(workspace)!==path.join(stateRoot,'work')||!/^run_[A-Za-z0-9_-]+$/.test(path.basename(workspace)))throw Error('UNSAFE_PATH');
   const resources=current.resources.filter(resource=>resource.action==='DELETE'&&resource.path!==path.join(workspace,'owner.json')).sort((a,b)=>b.path.split(path.sep).length-a.path.split(path.sep).length||(a.kind==='file'?-1:1));
   const owner=current.resources.find(resource=>resource.path===path.join(workspace,'owner.json'));if(!owner)throw Error('OWNER_UNVERIFIED');resources.splice(resources.findIndex(resource=>resource.path===workspace),0,owner);
   for(const resource of resources){
    const target=path.resolve(resource.path),relative=path.relative(workspace,target);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('UNSAFE_PATH');
    await safeAncestors(path.dirname(target));const stat=await fs.lstat(target,{bigint:true});if(stat.isSymbolicLink()||fileIdentity(stat)!==resource.identity)throw Error('RESOURCE_IDENTITY_CHANGED');
    if(resource.kind==='file'){if(!stat.isFile()||stat.nlink!==1n||hashBytes(await fs.readFile(target))!==resource.digest)throw Error('RESOURCE_IDENTITY_CHANGED');await fs.unlink(target);}
    else if(resource.kind==='directory'){if(!stat.isDirectory()||(await fs.readdir(target)).length)throw Error('RESOURCE_IDENTITY_CHANGED');await fs.rmdir(target);}else throw Error('UNSAFE_RESOURCE');deleted.push(target);
   }
   return {status:'APPLIED',deleted,diagnostics:[]};
  }catch(error){return {status:'ERROR',deleted,diagnostics:[error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CLEANUP_FAILED_OWNERSHIP_UNVERIFIED']};}
 }
}
