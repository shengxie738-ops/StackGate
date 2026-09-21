import {StringDecoder} from 'node:string_decoder';
import type {Artifact} from '../../../contracts/src/index.js';
/** Conservative text rules, not a claim to detect all secrets or redact binary media. */
export function redactText(text:string,secrets:readonly string[]=[]):string {
 let result=text.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g,'').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
 // Line buffering must not disclose multiline credentials (for example PEM values).
 // Conservatively redact each nonempty supplied secret line as well as the full value.
 for(const value of [...new Set(secrets.flatMap(secret=>[secret,...secret.split(/\r?\n/)]))].filter(Boolean).sort((a,b)=>b.length-a.length))result=result.split(value).join('[REDACTED]');
 return result.replace(/("(?:Authorization|Cookie|Set-Cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,'$1"[REDACTED]"').replace(/\b(Authorization|Cookie|Set-Cookie)[ \t]*:[^\r\n]*/gi,'$1: [REDACTED]').replace(/\bBearer[ \t]+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@').replace(/(["']?(?:password|passwd|database_password)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,'$1[REDACTED]');
}
export function escapeLogPresentation(text:string):string{return redactText(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/[\\`*_{}[\]()#+!|]/g,'\\$&');}
export class RedactionStream {
 private readonly decoder=new StringDecoder('utf8');private pending='';private suppress=false;private ended=false;private rawBytes=0;private safeBytes=0;private discarded=false;
 constructor(readonly secrets:readonly string[]=[],readonly options:{maxLineBytes?:number}={}){}
 push(bytes:Uint8Array):string{if(this.ended)throw new Error('Redaction stream has ended');this.rawBytes+=bytes.length;const text=this.consume(this.decoder.write(Buffer.from(bytes)));this.safeBytes+=Buffer.byteLength(text);return text;}
 private consume(text:string):string{
  let output='';for(const segment of text.split(/(?<=\n)/)){
   if(!segment)continue;const complete=segment.endsWith('\n');
   if(this.suppress){if(complete){this.suppress=false;output+='[REDACTED: oversized log line]\n';}continue;}
   this.pending+=segment;
   if(Buffer.byteLength(this.pending)>(this.options.maxLineBytes??65536)){this.discarded=true;this.pending='';this.suppress=!complete;if(complete)output+='[REDACTED: oversized log line]\n';continue;}
   if(complete){output+=redactText(this.pending,this.secrets);this.pending='';}
  }return output;
 }
 finish():string{if(this.ended)return '';this.ended=true;const output=this.consume(this.decoder.end())+(this.suppress?'[REDACTED: oversized log line]':redactText(this.pending,this.secrets));this.pending='';this.safeBytes+=Buffer.byteLength(output);return output;}
 retention():NonNullable<Artifact['retention']>{return {original_bytes:this.rawBytes,retained_bytes:this.safeBytes,truncated:this.discarded,reason:this.discarded?'REDACTION_LINE_LIMIT':null,critical:false};}
}
