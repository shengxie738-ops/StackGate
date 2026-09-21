import type {Diagnostic} from '../../../packages/contracts/src/index.js';
import {ServiceError} from '../../../packages/core/src/services/service-error.js';
export interface CommandResult<T=unknown> {data?:T;exit_code:number;diagnostics:Diagnostic[];text?:string;runtime?:string}
export interface CliEnvelope<T=unknown> {
  schema_version:'0.1';ok:boolean;operation:string;runtime:string;exit_code:number;data?:T;diagnostics:Diagnostic[];
}
export function errorResult(error:unknown):CommandResult {
  if(error instanceof ServiceError)return {exit_code:error.exit_code,diagnostics:error.diagnostics};
  return {exit_code:3,diagnostics:[{code:'TOOL_FAILURE',rule_id:'SG-TOOL-CLI_FAILURE',message:'Unable to complete the operation safely.',location:'',observed_facts:{},recommended_action:'Inspect the operation inputs and local environment; no success is inferred.',source:'cli'}]};
}
/** One output boundary: command handlers return facts, never write stdout. */
export function writeOutput(operation:string,result:CommandResult,json:boolean):number {
  const envelope:CliEnvelope={schema_version:'0.1',ok:result.exit_code===0,operation,runtime:result.runtime??'NOT_EXECUTED',exit_code:result.exit_code,...(result.data===undefined?{}:{data:result.data}),diagnostics:result.diagnostics};
  if(json)process.stdout.write(JSON.stringify(envelope)+'\n');
  else {
    if(result.text)process.stdout.write(result.text.endsWith('\n')?result.text:result.text+'\n');
    else if(result.data!==undefined)process.stdout.write(`${operation}: ${result.exit_code===0?'completed':'requires attention'}\n${JSON.stringify(result.data,null,2)}\n`);
    if(result.diagnostics.length)process.stderr.write(result.diagnostics.map(d=>d.message).join('\n')+'\n');
  }
  return result.exit_code;
}
