import {fileURLToPath} from 'node:url';
import {InitService} from '../../../../packages/core/src/services/init-service.js';
export async function initCommand(root:string,apply:boolean){const service=new InitService(root,fileURLToPath(new URL('./presets/fastapi-react/',import.meta.url))),preview=await service.preview();if(apply)process.stderr.write('Applying displayed initialization proposal: '+JSON.stringify(preview)+'\n');const data=apply?await service.apply(preview):preview;return {data,exit_code:0,diagnostics:[]};}
