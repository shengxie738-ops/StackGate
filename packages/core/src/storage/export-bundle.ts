import fs from 'node:fs/promises';
import path from 'node:path';
import {validateSchema,type Artifact} from '../../../contracts/src/index.js';
import type {EvidenceReader} from '../ports/evidence.js';
import type {IntegrityResult} from './file-evidence-store.js';
import {canonicalJson} from './canonical-json.js';
import {hashBytes} from './hash.js';
import {strictPath,writeBytesAtomic} from './run-layout.js';
import {ensureDirectoryWithin} from './task-revisions.js';
export interface ExportPlan {run_id:string;source_manifest_hash:string;source_seal_identity_hash:string;source_root:string;files:{artifact:Artifact;bytes:Uint8Array}[];excluded:{artifact_id:string;relative_path:string;reason:string}[];explicit_sensitive_ids:string[]}
export interface ExportSelection {artifact_ids?:readonly string[];include_restricted_artifact_ids?:readonly string[]}
type VerifiedEvidenceReader=EvidenceReader&{verifyRun(run_id:string):Promise<IntegrityResult>;runRoot(run_id:string):Promise<string>};
const safe=(artifact:Artifact)=>artifact.sensitivity==='regular'&&['REDACTED','NOT_REQUIRED'].includes(artifact.redaction_state);
/** Preview is the default plan's excluded list; sensitive IDs must be explicitly selected afterward. */
export async function exportBundle(reader:VerifiedEvidenceReader,run:{run_id:string},selection:ExportSelection={}):Promise<ExportPlan>{
 const verified=await reader.verifyRun(run.run_id);if(verified.status!=='VALID'||!verified.seal||!verified.manifest)throw Error('Only verified sealed evidence can be exported');
 const requested=selection.artifact_ids?new Set(selection.artifact_ids):null,sensitive=new Set(selection.include_restricted_artifact_ids??[]),ids=new Set(verified.artifacts.map(artifact=>artifact.artifact_id));
 for(const id of [...(requested??[]),...sensitive])if(!ids.has(id))throw Error('Export selection references an unknown artifact');
 const plan:ExportPlan={run_id:run.run_id,source_manifest_hash:verified.seal.manifest_hash,source_seal_identity_hash:hashBytes(Buffer.from(canonicalJson(verified.seal))),source_root:await fs.realpath(await reader.runRoot(run.run_id)),files:[],excluded:[],explicit_sensitive_ids:[...sensitive].sort()};let total=0;
 for(const artifact of verified.artifacts){
  if(requested&&!requested.has(artifact.artifact_id)){plan.excluded.push({artifact_id:artifact.artifact_id,relative_path:artifact.relative_path,reason:'NOT_SELECTED'});continue;}
  if(!safe(artifact)&&!sensitive.has(artifact.artifact_id)){plan.excluded.push({artifact_id:artifact.artifact_id,relative_path:artifact.relative_path,reason:'SENSITIVE_OR_UNVERIFIED_REDACTION'});continue;}
  if((total+=artifact.size)>100*1024*1024)throw Error('Export exceeds total byte budget');
  const read=await reader.read({run_id:run.run_id,relative_path:artifact.relative_path,expected_digest:artifact.digest,max_bytes:artifact.size});
  if(read.status!=='FOUND'||canonicalJson(read.artifact)!==canonicalJson(artifact)||hashBytes(read.bytes)!==artifact.digest||read.bytes.length!==artifact.size)throw Error('Export artifact cannot be authenticated');
  plan.files.push({artifact:structuredClone(artifact),bytes:new Uint8Array(read.bytes)});
 }
 const after=await reader.verifyRun(run.run_id);if(after.status!=='VALID'||canonicalJson(after.seal)!==canonicalJson(verified.seal))throw Error('Source evidence changed during export preparation');
 plan.files.sort((a,b)=>a.artifact.relative_path.localeCompare(b.artifact.relative_path));return plan;
}
/** Writes a fresh directory exclusively. Interrupted exports remain incomplete; source is readonly. */
export async function writeExportBundle(plan:ExportPlan,destination:{root:string;directory:string}):Promise<string>{
 const target=await strictPath(destination.root,destination.directory),paths=new Set<string>();let total=0;
 const source=await fs.realpath(plan.source_root),relative=path.relative(source,target);if(!relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Export destination must be outside the original sealed run');
 for(const file of plan.files){const artifact=file.artifact;
  if(!validateSchema('artifact',artifact).ok||artifact.run_id!==plan.run_id||hashBytes(file.bytes)!==artifact.digest||file.bytes.length!==artifact.size||(!safe(artifact)&&!plan.explicit_sensitive_ids.includes(artifact.artifact_id)))throw Error('Export plan identity, privacy or byte verification failed');
  if(paths.has(artifact.relative_path)||artifact.relative_path==='bundle.json')throw Error('Export contains duplicate or reserved paths');paths.add(artifact.relative_path);
  if((total+=file.bytes.length)>100*1024*1024)throw Error('Export exceeds total byte budget');
 }
 await fs.mkdir(target);const identity=await fs.stat(target,{bigint:true});
 const recheck=async()=>{const current=await strictPath(destination.root,destination.directory),stat=await fs.stat(current,{bigint:true});if(current!==target||identity.ino!==stat.ino||identity.dev!==stat.dev)throw Error('Export directory ownership changed');};
 for(const {artifact,bytes} of plan.files){await recheck();await strictPath(target,artifact.relative_path);await ensureDirectoryWithin(target,path.posix.dirname(artifact.relative_path));await writeBytesAtomic(target,artifact.relative_path,bytes);}
 await recheck();const index={schema_version:'0.1',kind:'stackgate-export',run_id:plan.run_id,source_manifest_hash:plan.source_manifest_hash,source_seal_identity_hash:plan.source_seal_identity_hash,artifacts:plan.files.map(file=>file.artifact),excluded:plan.excluded,explicit_sensitive_ids:plan.explicit_sensitive_ids};await writeBytesAtomic(target,'bundle.json',Buffer.from(canonicalJson(index)+'\n'));return target;
}
