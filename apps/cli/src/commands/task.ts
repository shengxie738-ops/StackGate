import { TaskService } from '../../../../packages/core/src/services/task-service.js';
export async function taskCommand(root:string,action:'validate'|'confirm',file:string,digest?:string){
  const service=new TaskService(root);
  const data=action==='validate'?await service.validate(file):await service.confirm(file,digest??'',{authorized:!!digest,source:'local-review'});
  process.stdout.write(JSON.stringify({schema_version:'0.1',data,runtime:'NOT_EXECUTED'})+'\n');
  return 'valid' in data&&!data.valid?64:0;
}
