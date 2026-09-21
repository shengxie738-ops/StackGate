import {ToolRegistryService} from '../../core/src/services/tool-registry-service.js';
import {OasdiffAdapter,toolDiagnostic,type CompatibilityFinding,type ContractToolResult} from './tool.js';
import type {LoadedContract} from './load-contract.js';
/** Resolution is repeated per comparison; a previous verified lookup never grants future execution. */
export class RegisteredOasdiffAdapter {
 constructor(readonly registry=new ToolRegistryService()){}
 async breaking(base:LoadedContract,target:LoadedContract,scope?:readonly string[]):Promise<ContractToolResult<CompatibilityFinding[]>>{
  const resolution=await this.registry.resolveOasdiff();
  if(resolution.status!=='VERIFIED')return {status:'BLOCKED',value:null,evidence:[],diagnostics:[toolDiagnostic('UNSUPPORTED_CAPABILITY','Reviewed oasdiff capability unavailable: '+resolution.reason)]};
  const tool=resolution.tool;
  return new OasdiffAdapter({trusted:true,executable:tool.executable,expected_version:tool.version,expected_sha256:tool.digest}).breaking(base,target,scope);
 }
}
