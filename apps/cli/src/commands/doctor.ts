import { ProjectService } from '../../../../packages/core/src/services/project-service.js';
export async function doctor(root:string,json:boolean):Promise<number>{
  const result=await new ProjectService().inspect(root);
  process.stdout.write(json?JSON.stringify(result)+'\n':`StackGate doctor: ${result.capabilities.join(', ')||'no capabilities identified'}\nMissing: ${result.missing.join(', ')||'none'}\nRuntime: NOT_EXECUTED\n`);
  if(result.diagnostics.length)process.stderr.write('Project configuration has diagnostics.\n');
  return result.diagnostics.length?64:0;
}
