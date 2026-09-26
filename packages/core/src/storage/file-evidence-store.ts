import fs from 'node:fs/promises';
import path from 'node:path';
import {validateSchema,type Artifact,type Diagnostic,type RunManifest,type RunEvent,type RunSeal} from '../../../contracts/src/index.js';
import type {EvidenceStore,EvidenceScope,EvidenceDocument,ArtifactWrite,AppendResult,SealResult,EvidenceRead} from '../ports/evidence.js';
import type {Clock} from '../ports/clock.js';
import {canonicalJson} from './canonical-json.js';
import {hashBytes} from './hash.js';
import {ensureDirectoryWithin} from './task-revisions.js';
import {StorageError} from './storage-error.js';
import {assertRunId,strictPath,prepareState,withRunLock,writeBytesAtomic} from './run-layout.js';
import {readEventLog,evidenceDiagnostic} from './event-log.js';
import {validateRunConsistency} from './integrity-index.js';
export interface RunSnapshot {status:'VALID'|'INCOMPLETE'|'INVALID'|'MISSING';manifest:RunManifest|null;manifest_hash:string|null;events:RunEvent[];artifacts:Artifact[];diagnostics:Diagnostic[]}
export interface IntegrityResult {status:'VALID'|'MISSING'|'INVALID';manifest:RunManifest|null;seal:RunSeal|null;artifacts:Artifact[];diagnostics:Diagnostic[]}
const jsonBytes=(value:unknown)=>Buffer.from(canonicalJson(value)+'\n');
const MAX_FILE=100*1024*1024;
export class FileEvidenceStore implements EvidenceStore {
 readonly stateRoot:string;
 constructor(readonly options:{stateRoot:string;owner:{repo_id:string;worktree_id:string};clock?:Clock}){this.stateRoot=path.resolve(options.stateRoot);}
 async runRoot(run_id:string):Promise<string>{assertRunId(run_id);return strictPath(this.stateRoot,'runs/'+run_id);}
 async createRun(manifest:RunManifest):Promise<void>{
  this.validateManifest(manifest);if(!['CREATED','PLANNED'].includes(manifest.phase))throw new StorageError('INVALID_JSON','A new run must start CREATED or PLANNED');
  await prepareState(this.stateRoot);const root=await this.runRoot(manifest.run_id);await fs.mkdir(root);
  for(const dir of ['documents','artifacts','restricted'])await ensureDirectoryWithin(root,dir);
  await writeBytesAtomic(root,'manifest.json',jsonBytes(manifest));await writeBytesAtomic(root,'events.jsonl',Buffer.alloc(0));await writeBytesAtomic(root,'artifact-index.json',jsonBytes([]));
 }
 private validateManifest(value:RunManifest):void{if(!validateSchema('run',value).ok||value.repo_id!==this.options.owner.repo_id||value.worktree_id!==this.options.owner.worktree_id)throw new StorageError('INVALID_JSON','Run manifest structure or owner identity is invalid');}
 private async unsealed(root:string):Promise<void>{try{await fs.lstat(await strictPath(root,'seal.json'));throw new StorageError('TARGET_EXISTS','Sealed evidence is immutable');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 private async bytes(root:string,relative:string,max=MAX_FILE):Promise<Buffer>{const file=await strictPath(root,relative),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>max)throw new StorageError('INVALID_JSON','Evidence file is unsafe or exceeds read budget');const bytes=await fs.readFile(file);if(bytes.length>max)throw new StorageError('INVALID_JSON','Evidence grew beyond read budget');return bytes;}
 private async index(root:string):Promise<Artifact[]>{const values:unknown=JSON.parse((await this.bytes(root,'artifact-index.json')).toString('utf8'));if(!Array.isArray(values)||values.some(a=>!validateSchema('artifact',a).ok))throw new StorageError('INVALID_JSON','Artifact index is invalid');return values as Artifact[];}
 async updateManifest(next:RunManifest,expected_hash:string):Promise<void>{
  this.validateManifest(next);const root=await this.runRoot(next.run_id);await withRunLock(root,async()=>{await this.unsealed(root);const bytes=await this.bytes(root,'manifest.json'),previous=JSON.parse(bytes.toString()) as RunManifest;this.validateManifest(previous);
   const mutable=new Set(['phase','verdict','started_at','finished_at','checks','artifact_refs','coverage_gaps','canceled','environment_ref']);
   for(const key of Object.keys(previous) as (keyof RunManifest)[])if(!mutable.has(String(key))&&canonicalJson(previous[key])!==canonicalJson(next[key]))throw new StorageError('TARGET_CHANGED','Immutable run identity changed');
   const transitions:Record<RunManifest['phase'],string[]>={CREATED:['PLANNED','CANCELED','ABORTED'],PLANNED:['RUNNING','CANCELED','ABORTED'],RUNNING:['FINALIZING','CANCELED','ABORTED'],FINALIZING:['COMPLETED','CANCELED','ABORTED'],COMPLETED:[],CANCELED:[],ABORTED:[]};
   if(previous.phase!==next.phase&&!transitions[previous.phase].includes(next.phase))throw new StorageError('INVALID_JSON','Illegal manifest lifecycle transition');
   if(['COMPLETED','CANCELED','ABORTED'].includes(previous.phase)&&canonicalJson(previous)!==canonicalJson(next))throw new StorageError('TARGET_EXISTS','Terminal run facts cannot be changed');
   await writeBytesAtomic(root,'manifest.json',jsonBytes(next),expected_hash);
  });
 }
 async append(event:RunEvent):Promise<AppendResult>{
  try{if(!validateSchema('event',event).ok)throw new StorageError('INVALID_JSON','Invalid event schema');const root=await this.runRoot(event.run_id);
   return await withRunLock(root,async()=>{await this.unsealed(root);const manifest=JSON.parse((await this.bytes(root,'manifest.json')).toString()) as RunManifest;this.validateManifest(manifest);const bytes=await this.bytes(root,'events.jsonl'),existing=readEventLog(bytes,event.run_id);if(existing.diagnostics.length)throw new StorageError('INVALID_JSON','Existing event log is incomplete or invalid');
    const duplicate=existing.events.find(e=>e.event_id===event.event_id);if(duplicate){if(canonicalJson(duplicate)!==canonicalJson(event))throw new StorageError('INVALID_JSON','Conflicting duplicate event ID');return {status:'DUPLICATE',event_id:event.event_id,seq:event.seq};}
    if(event.type==='run.started'&&(event.payload.plan_id!==manifest.plan_id||event.payload.input_hash!==manifest.input_hash))throw new StorageError('INVALID_JSON','Started event identity differs from manifest');
    const next=Buffer.concat([bytes,jsonBytes(event)]),validated=readEventLog(next,event.run_id);if(validated.diagnostics.length)throw new StorageError('INVALID_JSON',validated.diagnostics[0]!.message);
    await writeBytesAtomic(root,'events.jsonl',next,hashBytes(bytes));return {status:'APPENDED',event_id:event.event_id,seq:event.seq};
   });
  }catch(error){return {status:'ERROR',diagnostics:[{...evidenceDiagnostic(error instanceof StorageError?error.message:'Event append failed safely'),observed_facts:{error_code:(error as NodeJS.ErrnoException).code??'UNKNOWN'}}]};}
 }
 async store(scope:EvidenceScope,input:{kind:'artifact';value:ArtifactWrite}|{kind:'document';value:EvidenceDocument}):Promise<Artifact>{
  const root=await this.runRoot(scope.run_id);
  return withRunLock(root,async()=>{await this.unsealed(root);const manifest=JSON.parse((await this.bytes(root,'manifest.json')).toString()) as RunManifest;this.validateManifest(manifest);
   if((scope.check_id===null)!==(scope.attempt_id===null)||scope.check_id!==null&&!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(scope.check_id)||scope.attempt_id!==null&&!/^attempt_[A-Za-z0-9_-]+$/.test(scope.attempt_id))throw new StorageError('INVALID_JSON','Invalid check/attempt scope');
   let value:ArtifactWrite;let kind:string;
   if(input.kind==='document'){
    const document=input.value,schema=document.kind;if(!validateSchema(schema,document.value).ok)throw new StorageError('INVALID_JSON','Document failed its declared schema');
    if('run_id' in document.value&&document.value.run_id!==scope.run_id||document.kind==='plan'&&document.value.plan_id!==manifest.plan_id)throw new StorageError('INVALID_JSON','Document identity mismatches run');
    if(document.kind==='check-result'&&(document.value.check_id!==scope.check_id||document.value.attempt_id!==scope.attempt_id))throw new StorageError('INVALID_JSON','Check result identity mismatches scope');
    if(document.kind==='run'&&canonicalJson(document.value)!==canonicalJson(manifest))throw new StorageError('INVALID_JSON','Run document differs from current manifest');
    if(document.kind==='plan-context'&&'plan_'+hashBytes(Buffer.from(canonicalJson(document.value)))!==manifest.plan_id||document.kind==='run-completion'&&document.value.plan_id!==manifest.plan_id)throw new StorageError('INVALID_JSON','Context or completion differs from run plan identity');
    if(['environment','environment-finalization','environment-cleanup','environment-assessment','backend-observation'].includes(document.kind)&&'run_id' in document.value&&document.value.run_id!==manifest.run_id)throw new StorageError('INVALID_JSON','Environment or observation document differs from run identity');
    const suffix=document.kind==='finding'?'-'+document.value.finding_id:'';
    value={name:document.kind+suffix+'.json',bytes:jsonBytes(document.value),media_type:'application/json',artifact_kind:'report',sensitivity:'regular',redaction_state:'NOT_REQUIRED'};kind='documents';
    if(document.kind==='plan-context'){value.sensitivity='restricted';value.redaction_state='UNREDACTED';}
   }else{value=input.value;kind=value.sensitivity==='restricted'?'restricted':'artifacts';}
   if(value.bytes.length>MAX_FILE)throw new StorageError('INVALID_JSON','Artifact exceeds maximum retained size');
   const relative=[kind,...(scope.check_id===null?[]:['checks',scope.check_id,scope.attempt_id!]),value.name].join('/');await strictPath(root,relative);const parent=path.posix.dirname(relative);await ensureDirectoryWithin(root,parent);
   const artifact:Artifact={schema_version:'0.1',artifact_id:'artifact_'+hashBytes(Buffer.from(canonicalJson({scope,relative}))).slice(0,32),run_id:scope.run_id,check_id:scope.check_id,attempt_id:scope.attempt_id,relative_path:relative,media_type:value.media_type,size:value.bytes.length,digest:hashBytes(value.bytes),sensitivity:value.sensitivity,redaction_state:value.redaction_state,artifact_kind:value.artifact_kind};
   if(value.retention)artifact.retention=value.retention;
   if(!validateSchema('artifact',artifact).ok||artifact.retention&&artifact.retention.retained_bytes!==artifact.size||artifact.retention?.critical&&artifact.retention.truncated)throw new StorageError('INVALID_JSON','Artifact metadata or retention is invalid');
   const oldIndex=await this.bytes(root,'artifact-index.json'),artifacts=await this.index(root),previous=artifacts.find(a=>a.artifact_id===artifact.artifact_id||a.relative_path===relative);
   if(previous){if(canonicalJson(previous)!==canonicalJson(artifact)||hashBytes(await this.bytes(root,relative))!==artifact.digest)throw new StorageError('TARGET_EXISTS','Refusing to overwrite different evidence');return previous;}
   await writeBytesAtomic(root,relative,value.bytes);if(hashBytes(await this.bytes(root,relative))!==artifact.digest)throw new StorageError('TARGET_CHANGED','Stored artifact failed byte verification');
   await writeBytesAtomic(root,'artifact-index.json',jsonBytes([...artifacts,artifact].sort((a,b)=>a.artifact_id.localeCompare(b.artifact_id))),hashBytes(oldIndex));return artifact;
  });
 }
 async read(request:{run_id:string;relative_path:string;expected_digest:string;max_bytes:number}):Promise<EvidenceRead>{
  try{if(!Number.isSafeInteger(request.max_bytes)||request.max_bytes<0||request.max_bytes>MAX_FILE)throw new StorageError('INVALID_JSON','Invalid read budget');const root=await this.runRoot(request.run_id),artifact=(await this.index(root)).find(a=>a.relative_path===request.relative_path);if(!artifact)return {status:'MISSING',diagnostics:[evidenceDiagnostic('Artifact is not indexed')]};
   const bytes=await this.bytes(root,request.relative_path,request.max_bytes);if(artifact.run_id!==request.run_id||artifact.digest!==request.expected_digest||hashBytes(bytes)!==artifact.digest||bytes.length!==artifact.size)throw new StorageError('INVALID_JSON','Artifact identity or bytes mismatch');return {status:'FOUND',artifact,bytes};
  }catch(error){return {status:(error as NodeJS.ErrnoException).code==='ENOENT'?'MISSING':'INVALID',diagnostics:[evidenceDiagnostic('Artifact cannot be read with the expected identity and budget')]};}
 }
 private async snapshot(run_id:string):Promise<RunSnapshot>{
  const result:RunSnapshot={status:'INCOMPLETE',manifest:null,manifest_hash:null,events:[],artifacts:[],diagnostics:[]};
  try{const root=await this.runRoot(run_id),bytes=await this.bytes(root,'manifest.json');const manifest=JSON.parse(bytes.toString()) as RunManifest;this.validateManifest(manifest);if(manifest.run_id!==run_id)throw new StorageError('INVALID_JSON','Wrong run identity');result.manifest=manifest;result.manifest_hash=hashBytes(bytes);const log=readEventLog(await this.bytes(root,'events.jsonl'),run_id);result.events=log.events;result.diagnostics.push(...log.diagnostics);result.artifacts=await this.index(root);if(result.artifacts.some(a=>a.run_id!==run_id))throw new StorageError('INVALID_JSON','Artifact index includes another run');if(result.diagnostics.length)result.status='INVALID';
  }catch(error){result.status=(error as NodeJS.ErrnoException).code==='ENOENT'&&result.manifest===null?'MISSING':'INVALID';result.diagnostics.push(evidenceDiagnostic('Run facts are missing, malformed, or outside the owned boundary'));}return result;
 }
 async readRun(run_id:string):Promise<RunSnapshot>{const snapshot=await this.snapshot(run_id);if(snapshot.status==='INVALID'||snapshot.status==='MISSING')return snapshot;const integrity=await this.verifyRun(run_id);return {...snapshot,status:integrity.status==='VALID'?'VALID':integrity.status==='MISSING'?'INCOMPLETE':'INVALID',diagnostics:[...snapshot.diagnostics,...integrity.diagnostics]};}
 private async allFiles(root:string):Promise<string[]>{
  const result:string[]=[];
  const walk=async(relative:string)=>{const directory=relative?await strictPath(root,relative):root;for(const entry of await fs.readdir(directory,{withFileTypes:true})){const next=relative?relative+'/'+entry.name:entry.name;if(next==='.write-lock'||next==='seal.json')continue;if(entry.isSymbolicLink())throw new StorageError('UNSAFE_PATH','Evidence inventory contains a link');if(entry.isDirectory())await walk(next);else if(entry.isFile())result.push(next);else throw new StorageError('UNSAFE_PATH','Evidence inventory contains an unsupported file');}};
  await walk('');return result.sort();
 }
 private async inventory(run_id:string,snapshot:RunSnapshot):Promise<RunSeal['files']>{
  if(!snapshot.manifest||snapshot.status==='INVALID'||snapshot.status==='MISSING')throw new StorageError('INVALID_JSON','Run snapshot is incomplete or malformed');
  const diagnostics=validateRunConsistency(snapshot.manifest,snapshot.events,snapshot.artifacts);if(diagnostics.length)throw new StorageError('INVALID_JSON',diagnostics[0]!.message);
  const root=await this.runRoot(run_id),expected=['manifest.json','events.jsonl','artifact-index.json',...snapshot.artifacts.map(a=>a.relative_path)].sort();
  if(canonicalJson(await this.allFiles(root))!==canonicalJson(expected))throw new StorageError('INVALID_JSON','Evidence inventory contains missing or undeclared files');
  const files:RunSeal['files'][number][]=[];
  for(const relative of expected){const bytes=await this.bytes(root,relative),digest=hashBytes(bytes),artifact=snapshot.artifacts.find(a=>a.relative_path===relative);
   if(artifact&&(artifact.digest!==digest||artifact.size!==bytes.length||artifact.run_id!==run_id||artifact.retention&&artifact.retention.retained_bytes!==bytes.length||artifact.retention?.critical&&artifact.retention.truncated))throw new StorageError('INVALID_JSON','Artifact bytes, identity or retention do not match index');
   if(artifact&&relative.startsWith('documents/')){
    const value=JSON.parse(bytes.toString()) as Record<string,unknown>,name=path.posix.basename(relative).replace(/\.json$/,''),schema=name.startsWith('finding-')?'finding':name;
    if(!['plan','run','check-result','input-manifest','environment','finding','plan-context','run-completion'].includes(schema)||!validateSchema(schema,value).ok)throw new StorageError('INVALID_JSON','Stored document is not a valid declared protocol');
    if(schema==='plan-context'&&('plan_'+hashBytes(Buffer.from(canonicalJson(value)))!==snapshot.manifest.plan_id||artifact.sensitivity!=='restricted'||artifact.redaction_state!=='UNREDACTED')||schema==='run-completion'&&value.plan_id!==snapshot.manifest.plan_id)throw new StorageError('INVALID_JSON','Stored context or completion differs from run plan identity or sensitivity');
    const matchingCheck=snapshot.events.find(event=>event.type==='check.finished'&&event.payload.check_result.check_id===value.check_id&&event.payload.check_result.attempt_id===value.attempt_id);
    if('run_id' in value&&value.run_id!==run_id||schema==='check-result'&&(value.check_id!==artifact.check_id||value.attempt_id!==artifact.attempt_id||matchingCheck?.type!=='check.finished'||canonicalJson(value)!==canonicalJson(matchingCheck.payload.check_result)))throw new StorageError('INVALID_JSON','Stored document facts differ from their execution event scope');
    if(schema==='run'&&canonicalJson(value)!==canonicalJson(snapshot.manifest)||schema==='plan'&&(value.plan_id!==snapshot.manifest.plan_id||value.plan_hash!==snapshot.manifest.plan_hash||value.input_hash!==snapshot.manifest.input_hash||value.policy_hash!==snapshot.manifest.policy_hash)||schema==='input-manifest'&&value.input_hash!==snapshot.manifest.input_hash)throw new StorageError('INVALID_JSON','Stored document has a conflicting input identity');
   }
   files.push({relative_path:relative,digest,size:bytes.length});
  }if(files.length<3)throw new StorageError('INVALID_JSON','Missing required fact files');return files as RunSeal['files'];
 }
 async verifyRun(run_id:string):Promise<IntegrityResult>{
  const snapshot=await this.snapshot(run_id),base={manifest:snapshot.manifest,artifacts:snapshot.artifacts};let seal:RunSeal|null=null;
  try{
   const root=await this.runRoot(run_id);let bytes:Buffer;try{bytes=await this.bytes(root,'seal.json',1024*1024);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {...base,status:snapshot.status==='INVALID'?'INVALID':'MISSING',seal:null,diagnostics:snapshot.diagnostics.length?snapshot.diagnostics:[evidenceDiagnostic('Run evidence has not been sealed')]};throw error;}
   const valid=validateSchema<RunSeal>('run-seal',JSON.parse(bytes.toString()));if(!valid.ok)throw new StorageError('INVALID_JSON','Seal schema is invalid');seal=valid.value;
   if(seal.run_id!==run_id||seal.input_hash!==snapshot.manifest?.input_hash||seal.manifest_hash!==snapshot.manifest_hash||canonicalJson(seal.artifacts)!==canonicalJson(snapshot.artifacts))throw new StorageError('INVALID_JSON','Seal does not bind current run identity and artifact index');
   const files=await this.inventory(run_id,snapshot);if(canonicalJson(files)!==canonicalJson(seal.files)||seal.event_log_digest!==files.find(f=>f.relative_path==='events.jsonl')?.digest||seal.artifact_index_digest!==files.find(f=>f.relative_path==='artifact-index.json')?.digest||seal.required_artifact_ids.some(id=>!snapshot.artifacts.some(a=>a.artifact_id===id)))throw new StorageError('INVALID_JSON','Sealed facts or required artifacts have changed');
   return {...base,status:'VALID',seal,diagnostics:[]};
  }catch(error){return {...base,status:'INVALID',seal,diagnostics:[evidenceDiagnostic(error instanceof StorageError?error.message:'Sealed evidence could not be verified safely')]};}
 }
 async seal(request:{run_id:string;input_hash:string;required_artifact_ids:readonly string[]}):Promise<SealResult>{
  try{const root=await this.runRoot(request.run_id);return await withRunLock(root,async()=>{
   const existing=await this.verifyRun(request.run_id);
   if(existing.status==='VALID'){if(existing.seal!.input_hash!==request.input_hash||canonicalJson(existing.seal!.required_artifact_ids)!==canonicalJson([...request.required_artifact_ids].sort()))throw new StorageError('TARGET_CHANGED','Repeat sealing changed requested identity');return {status:'SEALED',manifest_hash:existing.seal!.manifest_hash,artifacts:existing.artifacts,diagnostics:[]};}
   if(existing.status==='INVALID')throw new StorageError('INVALID_JSON','Existing evidence or seal is invalid');
   const snapshot=await this.snapshot(request.run_id);if(snapshot.manifest?.input_hash!==request.input_hash)throw new StorageError('INVALID_JSON','Seal input hash differs from run');
   if(new Set(request.required_artifact_ids).size!==request.required_artifact_ids.length)throw new StorageError('INVALID_JSON','Seal required artifact IDs are duplicated');
   if(request.required_artifact_ids.some(id=>!snapshot.artifacts.some(a=>a.artifact_id===id)))return {status:'BLOCKED',manifest_hash:null,artifacts:snapshot.artifacts,diagnostics:[evidenceDiagnostic('Required artifact is missing')]};
   const files=await this.inventory(request.run_id,snapshot),seal:RunSeal={schema_version:'0.1',run_id:request.run_id,input_hash:request.input_hash,sealed_at:this.options.clock?.now()??new Date().toISOString(),manifest_hash:snapshot.manifest_hash!,event_log_digest:files.find(f=>f.relative_path==='events.jsonl')!.digest,artifact_index_digest:files.find(f=>f.relative_path==='artifact-index.json')!.digest,required_artifact_ids:[...request.required_artifact_ids].sort(),artifacts:snapshot.artifacts,files};
   if(!validateSchema('run-seal',seal).ok)throw new StorageError('INVALID_JSON','Seal schema is invalid');
   // Re-read every owned byte before the atomic completion marker is published.
   if(canonicalJson(await this.inventory(request.run_id,await this.snapshot(request.run_id)))!==canonicalJson(files))throw new StorageError('TARGET_CHANGED','Evidence changed during sealing');
   await writeBytesAtomic(root,'seal.json',jsonBytes(seal));const checked=await this.verifyRun(request.run_id);if(checked.status!=='VALID')throw new StorageError('INVALID_JSON','Published seal failed verification');return {status:'SEALED',manifest_hash:seal.manifest_hash,artifacts:seal.artifacts,diagnostics:[]};
  });}catch(error){return {status:'ERROR',manifest_hash:null,artifacts:[],diagnostics:[evidenceDiagnostic(error instanceof StorageError?error.message:'Evidence sealing failed safely')]};}
 }
}
