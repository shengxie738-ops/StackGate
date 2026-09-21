import {validateSchema,type Diagnostic} from '../../../contracts/src/index.js';
import {parseStrictDocument} from '../services/strict-document.js';
import {hashBytes} from './hash.js';
export type VersionedReadResult={status:'SUPPORTED';document:Record<string,unknown>;view:Record<string,unknown>;source_digest:string;source_schema_version:'0.1';reader_version:'0.1';conversion:null|{id:'artifact-retention-view';version:'1'}}|{status:'UNSUPPORTED_VERSION'|'INVALID';source_digest:string;diagnostics:Diagnostic[]};
/** Compatibility is declared by schemas, never inferred from an arbitrary same-major version. */
export function readVersionedDocument(bytes:Uint8Array,kind:string):VersionedReadResult{
 const source_digest=hashBytes(bytes),failure=(status:'UNSUPPORTED_VERSION'|'INVALID',message:string):VersionedReadResult=>({status,source_digest,diagnostics:[{code:'REPORT_INVALID',message,source:'schema-reader',location:kind,observed_facts:{},recommended_action:'Preserve original bytes and use a reader that explicitly supports this schema version.'}]});
 try{
  if(bytes.byteLength>1024*1024)return failure('INVALID','Document exceeds the bounded compatibility reader limit');
  // JSON syntax is mandatory; the strict parser additionally rejects duplicate keys/depth abuse.
  JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
  const parsed=parseStrictDocument(bytes,kind);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return failure('INVALID','Versioned document must be an object');
  const document=parsed as Record<string,unknown>;
  if(typeof document.schema_version!=='string')return failure('INVALID','Document has no schema version');
  if(document.schema_version!=='0.1')return failure('UNSUPPORTED_VERSION','Schema version is not explicitly supported: '+document.schema_version);
  if(!validateSchema(kind,document).ok)return failure('INVALID','Document violates its strict declared schema');
  const converted=kind==='artifact'&&!Object.hasOwn(document,'retention');
  return {status:'SUPPORTED',document,view:converted?{...document,retention:null}:structuredClone(document),source_digest,source_schema_version:'0.1',reader_version:'0.1',conversion:converted?{id:'artifact-retention-view',version:'1'}:null};
 }catch{return failure('INVALID','Document is malformed or its schema kind is unsupported');}
}
