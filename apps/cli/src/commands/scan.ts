import {ScanService,type ScanOptions} from '../../../../packages/core/src/services/scan-service.js';
export async function scanCommand(root:string,options:ScanOptions){const data=await new ScanService(root).scan(options);return {data,exit_code:0,diagnostics:data.diagnostics};}
