import fs from 'node:fs/promises';
import path from 'node:path';
import {validateProjectConfig,type ProjectConfig} from '../../../contracts/src/index.js';
import {canonicalJson} from './canonical-json.js';
import {hashBytes} from './hash.js';
import {ensureDirectoryWithin} from './task-revisions.js';
import {strictPath,withRunLock,writeBytesAtomic} from './run-layout.js';
import {resolveReferences} from '../domain/resolve-references.js';
export interface CacheIdentity {content_digest:string;parser_version:string;schema_version:string;configuration_digest:string;platform:string}
export type StaticParseEntry =
 | {kind:'configuration';value:ProjectConfig}
 | {kind:'typescript-imports';value:{imports:string[]}}
 | {kind:'openapi-operations';value:{operations:{key:string;method:string;path:string;pointer:string}[]}};
type Kind=StaticParseEntry['kind'];
type ReadResult={status:'HIT';entry:StaticParseEntry}|{status:'MISS';reason:'ABSENT_OR_INVALID'};
const marker={schema_version:'0.1',kind:'stackgate-static-parse-cache'};
const bytes=(value:unknown)=>Buffer.from(canonicalJson(value)+'\n');
const plain=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).sort().join(',')===[...expected].sort().join(',');
function validEntry(value:unknown):value is StaticParseEntry{
 if(!plain(value)||!keys(value,['kind','value'])||!plain(value.value))return false;
 if(value.kind==='configuration'){const config=validateProjectConfig(value.value);return config.ok&&resolveReferences(config.value).length===0;}
 if(value.kind==='typescript-imports')return keys(value.value,['imports'])&&Array.isArray(value.value.imports)&&value.value.imports.length<=100000&&value.value.imports.every(x=>typeof x==='string'&&x.length<=8192);
 if(value.kind==='openapi-operations')return keys(value.value,['operations'])&&Array.isArray(value.value.operations)&&value.value.operations.length<=100000&&value.value.operations.every(x=>plain(x)&&keys(x,['key','method','path','pointer'])&&['key','method','path','pointer'].every(k=>typeof x[k]==='string'&&(x[k] as string).length<=8192)&&['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','TRACE'].includes(x.method as string));
 return false;
}
/** Disposable static data only. Cache entries are never execution evidence or authorization. */
export class ParseCache {
 readonly directory:string;readonly maxBytes:number;readonly maxEntryBytes:number;
 constructor(readonly root:string,readonly options:{max_bytes?:number;max_entry_bytes?:number}={}){
  this.directory=path.resolve(root,'parse-cache-v1');this.maxBytes=options.max_bytes??32*1024*1024;this.maxEntryBytes=options.max_entry_bytes??4*1024*1024;
  if(!Number.isSafeInteger(this.maxBytes)||!Number.isSafeInteger(this.maxEntryBytes)||this.maxBytes<1||this.maxEntryBytes<1||this.maxEntryBytes>this.maxBytes)throw Error('Invalid cache bounds');
 }
 private key(identity:CacheIdentity,kind:Kind){
  if(!plain(identity)||!keys(identity,['content_digest','parser_version','schema_version','configuration_digest','platform'])||!['configuration','typescript-imports','openapi-operations'].includes(kind)||![identity.content_digest,identity.configuration_digest].every(x=>/^[a-f0-9]{64}$/.test(x))||![identity.parser_version,identity.schema_version,identity.platform].every(x=>typeof x==='string'&&x.length>0&&x.length<256))throw Error('Invalid static cache identity');
  return hashBytes(bytes({identity,kind}));
 }
 private async readFile(name:string,max:number){const file=await strictPath(this.directory,name),stat=await fs.lstat(file);if(!stat.isFile()||stat.nlink!==1||stat.size>max)throw Error('Unsafe cache file');const data=await fs.readFile(file);if(data.length>max)throw Error('Cache file grew');return data;}
 private async owned(){await strictPath(path.resolve(this.root),'parse-cache-v1');if(canonicalJson(JSON.parse((await this.readFile('owner.json',1024)).toString()))!==canonicalJson(marker))throw Error('Unknown cache ownership');}
 async get(identity:CacheIdentity,kind:Kind):Promise<ReadResult>{
  const key=this.key(identity,kind);
  try{await this.owned();const record:unknown=JSON.parse((await this.readFile(key+'.json',this.maxEntryBytes)).toString());
   if(!plain(record)||!keys(record,['schema_version','identity','entry','entry_digest'])||record.schema_version!=='0.1'||canonicalJson(record.identity)!==canonicalJson(identity)||!validEntry(record.entry)||record.entry.kind!==kind||hashBytes(bytes(record.entry))!==record.entry_digest)throw Error('Invalid cached projection');
   return {status:'HIT',entry:record.entry};
  }catch{return {status:'MISS',reason:'ABSENT_OR_INVALID'};}
 }
 async put(identity:CacheIdentity,entry:StaticParseEntry):Promise<void>{
  if(!validEntry(entry))throw Error('Only declared static parser results may be cached');
  const name=this.key(identity,entry.kind)+'.json',data=bytes({schema_version:'0.1',identity,entry,entry_digest:hashBytes(bytes(entry))});
  if(data.length>this.maxEntryBytes)throw Error('Static parse result exceeds cache budget');
  await ensureDirectoryWithin(path.resolve(this.root),'parse-cache-v1');
  const directoryIdentity=await fs.stat(this.directory,{bigint:true});
  const unchanged=async()=>{await strictPath(path.resolve(this.root),'parse-cache-v1');const current=await fs.stat(this.directory,{bigint:true});if(current.dev!==directoryIdentity.dev||current.ino!==directoryIdentity.ino)throw Error('Cache directory ownership changed');};
  await withRunLock(this.directory,async()=>{
   await unchanged();
   try{await this.owned();}catch(error){const existing=(await fs.readdir(this.directory)).filter(file=>file!=='.write-lock');if(existing.length)throw error;await writeBytesAtomic(this.directory,'owner.json',bytes(marker));}
   const files=[];let total=0;
   for(const file of await fs.readdir(this.directory))if(/^[a-f0-9]{64}\.json$/.test(file)){const target=await strictPath(this.directory,file),stat=await fs.lstat(target);if(!stat.isFile()||stat.nlink!==1)throw Error('Unsafe cache entry');files.push({file,size:stat.size,time:stat.mtimeMs});if(file!==name)total+=stat.size;}
   for(const file of files.filter(f=>f.file!==name).sort((a,b)=>a.time-b.time||a.file.localeCompare(b.file))){if(total+data.length<=this.maxBytes)break;await unchanged();await this.owned();const target=await strictPath(this.directory,file.file);const stat=await fs.lstat(target);if(!stat.isFile()||stat.nlink!==1)throw Error('Cache changed during pruning');await fs.unlink(target);total-=file.size;}
   let previous:Buffer|undefined;try{previous=await this.readFile(name,this.maxBytes);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   await unchanged();await writeBytesAtomic(this.directory,name,data,previous===undefined?undefined:hashBytes(previous));
  });
 }
 async getOrParse(identity:CacheIdentity,kind:Kind,parse:()=>StaticParseEntry|Promise<StaticParseEntry>){
  const cached=await this.get(identity,kind);if(cached.status==='HIT')return {cache:'HIT' as const,entry:cached.entry,parse_ms:0,write_status:'NOT_NEEDED' as const};
  const start=performance.now(),entry=await parse(),parse_ms=performance.now()-start;
  if(!validEntry(entry)||entry.kind!==kind)throw Error('Parser returned a different or invalid static result');
  try{await this.put(identity,entry);return {cache:'MISS' as const,entry,parse_ms,write_status:'STORED' as const};}catch{return {cache:'MISS' as const,entry,parse_ms,write_status:'UNAVAILABLE' as const};}
 }
}
