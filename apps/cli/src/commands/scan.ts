import {ScanService,type ScanOptions} from '../../../../packages/core/src/services/scan-service.js';
export async function scanCommand(root:string,options:ScanOptions){const data=await new ScanService(root).scan(options);process.stdout.write(JSON.stringify({schema_version:'0.1',data,runtime:'NOT_EXECUTED'})+'\n');return 0;}
