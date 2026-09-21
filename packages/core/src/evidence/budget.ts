import type {Artifact} from '../../../contracts/src/index.js';
import type {EvidenceStore,EvidenceScope,ArtifactWrite,RestrictedArtifactWriter} from '../ports/evidence.js';
import {redactText} from './redaction.js';
export class EvidenceBudget {
 private used=0;readonly totalBytes:number;readonly reservedCriticalBytes:number;
 constructor(options:{totalBytes?:number;reservedCriticalBytes?:number}={}){this.totalBytes=options.totalBytes??100*1024*1024;this.reservedCriticalBytes=options.reservedCriticalBytes??1024*1024;if(!Number.isSafeInteger(this.totalBytes)||this.totalBytes<0||!Number.isSafeInteger(this.reservedCriticalBytes)||this.reservedCriticalBytes<0||this.reservedCriticalBytes>this.totalBytes)throw new Error('Invalid evidence budget');}
 retain(bytes:Uint8Array,critical:boolean,text=true):NonNullable<Artifact['retention']>&{bytes:Buffer}{
  const available=Math.max(0,this.totalBytes-this.used-(critical?0:this.reservedCriticalBytes));
  if(critical&&bytes.length>available)throw new Error('ARTIFACT_BUDGET_EXCEEDED: critical evidence cannot be retained completely');
  let retained=Buffer.from(bytes.subarray(0,available));
  if(text&&retained.length<bytes.length){for(let trim=0;trim<4;trim++){try{new TextDecoder('utf8',{fatal:true}).decode(retained);break;}catch{retained=retained.subarray(0,Math.max(0,retained.length-1));}}}
  this.used+=retained.length;const truncated=retained.length<bytes.length;return {bytes:retained,original_bytes:bytes.length,retained_bytes:retained.length,truncated,reason:truncated?'ARTIFACT_BUDGET_EXCEEDED':null,critical};
 }
}
export class BudgetedArtifactWriter implements RestrictedArtifactWriter {
 constructor(readonly storePort:EvidenceStore,readonly scope:EvidenceScope,readonly budget:EvidenceBudget,readonly secrets:readonly string[]=[]){ }
 async store(input:ArtifactWrite):Promise<Artifact>{
  const source=Buffer.from(input.bytes),isText=/^(?:text\/|application\/(?:json|xml|yaml)|application\/[a-z0-9.+-]+\+(?:json|xml))/i.test(input.media_type);
  if(input.sensitivity==='regular'&&!isText)throw new Error('Unclassified binary evidence must be restricted');
  let bytes=source,redaction=input.redaction_state,sensitivity=input.sensitivity;
  if(sensitivity==='regular'){
   const text=new TextDecoder('utf8',{fatal:true}).decode(source);
   if(/(?:\/json|\+json)(?:;|$)/i.test(input.media_type)){
    let nodes=0;const sanitize=(value:unknown,depth=0):unknown=>{if(depth>64||++nodes>100000)throw new Error('Structured redaction limits exceeded');if(typeof value==='string')return redactText(value,this.secrets);if(Array.isArray(value))return value.map(item=>sanitize(item,depth+1));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:authorization|cookie|set-cookie|password|passwd|database_password)$/i.test(key)?'[REDACTED]':sanitize(item,depth+1)]));return value;};
    bytes=Buffer.from(JSON.stringify(sanitize(JSON.parse(text))));redaction='REDACTED';
   }else if(/(?:\/xml|\+xml)(?:;|$)/i.test(input.media_type)&&redactText(text,this.secrets)!==text){
    // Text substitutions can corrupt XML markup. Preserve the original only under restricted retention.
    sensitivity='restricted';redaction='UNREDACTED';
   }else {bytes=Buffer.from(redactText(text,this.secrets));redaction='REDACTED';}
  }
  const critical=!['log','trace','screenshot'].includes(input.artifact_kind);
  if(input.retention&&(input.retention.retained_bytes!==source.length||critical&&input.retention.truncated))throw new Error('Invalid or incomplete upstream evidence retention');
  const retained=this.budget.retain(bytes,critical,isText),{bytes:stored,...retention}=retained;
  retention.original_bytes=input.retention?.original_bytes??source.length;
  if(input.retention?.truncated){retention.truncated=true;retention.reason=retention.reason??input.retention.reason;}
  return this.storePort.store(this.scope,{kind:'artifact',value:{...input,bytes:stored,sensitivity,redaction_state:redaction,retention}});
 }
}
