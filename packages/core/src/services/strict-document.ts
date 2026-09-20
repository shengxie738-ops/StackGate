import { isAlias, parseDocument, visit } from 'yaml';
import { canonicalJson } from '../storage/canonical-json.js';
import { configurationError } from './service-error.js';
export interface DocumentLimits { maxBytes?:number; maxDepth?:number; maxAliases?:number }
/** No duplicate keys, executable tags, implicit logging or unbounded alias expansion. */
export function parseStrictDocument(bytes:Uint8Array,source:string,limits:DocumentLimits={}):unknown {
  if(bytes.byteLength>(limits.maxBytes??1048576))throw configurationError('Document exceeds size limit','',source);
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw configurationError('Document is not valid UTF-8','',source);}
  const document=parseDocument(text,{uniqueKeys:true,strict:true,stringKeys:true,version:'1.2',schema:'core',customTags:[],prettyErrors:false});
  if(document.errors.length||document.warnings.length)throw configurationError([...document.errors,...document.warnings].map(e=>e.code).join(', '),'',source);
  let count=0,aliases=0;
  visit(document,(_key,node,parents)=>{
    if(++count>50000||parents.length>(limits.maxDepth??64))throw configurationError('Document nesting or node limit exceeded','',source);
    if(isAlias(node)&&++aliases>(limits.maxAliases??0))throw configurationError('YAML aliases are unsupported at this boundary','',source);
  });
  try { const value:unknown=document.toJS({maxAliasCount:limits.maxAliases??0});canonicalJson(value);return value; }
  catch {throw configurationError('Document cannot be represented as finite plain JSON','',source);}
}
