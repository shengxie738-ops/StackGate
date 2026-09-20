import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ensureDirectoryWithin} from './task-revisions.js';
import {resolveWithin} from './safe-path.js';
import {writeJsonAtomic} from './atomic-write.js';
import {hashBytes} from './hash.js';
import {canonicalJson} from './canonical-json.js';
import {validateSchema,type TrustRecord} from '../../../contracts/src/index.js';
export interface StoredTrustEntry {record:TrustRecord;byte_hash:string}
export class UserTrustStore {
  readonly root:string;
  constructor(readonly repository:string,root?:string){this.root=path.resolve(root??path.join(os.homedir(),process.platform==='win32'?'AppData/Local/StackGate':process.platform==='darwin'?'Library/Application Support/StackGate':'.local/share/StackGate',process.platform+'-'+process.arch,'trust'));}
  async checkLocation(){
    const repo=await fs.realpath(this.repository);let ancestor=this.root;
    while(true){try{const stat=await fs.lstat(ancestor);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Unsafe trust directory');break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const parent=path.dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}}
    const actual=path.resolve(await fs.realpath(ancestor),path.relative(ancestor,this.root));
    const rel=path.relative(repo,actual);if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw new Error('Trust must be outside the candidate repository');
    return ancestor;
  }
  async readEntry(id:string):Promise<StoredTrustEntry|null>{await this.checkLocation();if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid trust identity');try{const file=await resolveWithin(this.root,'trust_'+id+'.json');const stat=await fs.stat(file);if(stat.size>1048576)return null;const bytes=await fs.readFile(file);let parsed:unknown;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{return null;}const result=validateSchema<TrustRecord>('trust-record',parsed);return result.ok?{record:result.value,byte_hash:hashBytes(bytes)}:null;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  async read(id:string):Promise<TrustRecord|null>{return (await this.readEntry(id))?.record??null;}
  async write(record:TrustRecord,previous?:StoredTrustEntry){
    if(!validateSchema('trust-record',record).ok||record.trust_source!=='local-execution'||record.trust_id!=='trust_'+record.input_hash)throw new Error('Invalid local trust record');
    if(previous){
      const observed=await this.readEntry(record.input_hash);
      const scope=(value:TrustRecord)=>{const permissions:Record<string,unknown>={...value};delete permissions.granted_at;delete permissions.expires_at;return canonicalJson(permissions);};
      if(!observed||observed.byte_hash!==previous.byte_hash||scope(observed.record)!==scope(record)||Date.parse(observed.record.expires_at)>Date.now())throw new Error('Only the exact expired matching local trust grant can be renewed');
    }
    const ancestor=await this.checkLocation();if(ancestor!==this.root)await ensureDirectoryWithin(ancestor,path.relative(ancestor,this.root).replaceAll(path.sep,'/'));const destination=await resolveWithin(this.root,record.trust_id+'.json');await writeJsonAtomic(destination,record,{root:this.root,...(previous?{expectedHash:previous.byte_hash}:{})});return destination;
  }
  reference(id:string){return path.join(this.root,'trust_'+id+'.json');}
}
