import type {Diagnostic} from '../../../contracts/src/index.js';
export interface ToolProvenance {complete:boolean;versions:Record<string,string>;diagnostics:Diagnostic[]}
/** Checks recorded identity facts only; it never probes or starts a candidate executable. */
export function inspectToolProvenance(recorded:Readonly<Record<string,string>>,requiredCommandIds:readonly string[]):ToolProvenance{
 const versions:Record<string,string>={},diagnostics:Diagnostic[]=[];
 const required=new Set(['node','stackgate','typescript','oasdiff',...requiredCommandIds.map(id=>'command_'+id)]);
 for(const key of [...new Set([...Object.keys(recorded),...required])].sort()){
  const value=recorded[key],exact=typeof value==='string'&&/^v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
  versions[key]=exact?value:'UNKNOWN';
  if(!exact)diagnostics.push({code:'TOOL_FAILURE',rule_id:'SG-TOOL-PROVENANCE',message:'Recorded or required tool version is UNKNOWN: '+key,source:'tool-provenance',location:key,observed_facts:{tool:key,version:'UNKNOWN'},recommended_action:'Resolve and record the exact verified tool version before a strict Gate can pass.'});
 }
 return {complete:diagnostics.length===0,versions,diagnostics};
}
