import { ProjectService } from '../../../../packages/core/src/services/project-service.js';
export async function doctor(root:string){
  const result=await new ProjectService().inspect(root);
  return {data:result,exit_code:result.diagnostics.length?64:0,diagnostics:result.diagnostics,text:`StackGate doctor: ${result.capabilities.join(', ')||'no capabilities identified'}\nMissing: ${result.missing.join(', ')||'none'}\nRuntime: NOT_EXECUTED\n`};
}
