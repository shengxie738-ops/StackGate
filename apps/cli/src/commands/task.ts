import { TaskService } from '../../../../packages/core/src/services/task-service.js';
export async function taskCommand(root:string,action:'validate'|'confirm',file:string,digest?:string){
  const service=new TaskService(root);
  const data=action==='validate'?await service.validate(file):await service.confirm(file,digest??'',{authorized:!!digest,source:'local-review'});
  return {data,exit_code:'valid' in data&&!data.valid?64:0,diagnostics:'diagnostics' in data?data.diagnostics:[]};
}
