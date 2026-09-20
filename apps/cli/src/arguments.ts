import { configurationError } from '../../../packages/core/src/services/service-error.js';
export function parseArguments(args:string[],values:readonly string[],flags:readonly string[]):Record<string,string|true>{
  const result:Record<string,string|true>={};
  for(let index=0;index<args.length;index++){
    const key=args[index]!;if(Object.hasOwn(result,key))throw configurationError('Duplicate option: '+key);
    if(flags.includes(key)){result[key]=true;continue;}
    if(!values.includes(key)||!args[index+1]||args[index+1]!.startsWith('--'))throw configurationError('Unknown or unsupported arguments: '+key);
    result[key]=args[++index]!;
  }
  return result;
}
