import {TrustService} from '../../../../packages/core/src/services/trust-service.js';
export async function trustCommand(root:string,confirmDigest?:string){const service=new TrustService(root);const data=confirmDigest===undefined?await service.review():await service.confirm(confirmDigest,{authorized:true});return {data,exit_code:0,diagnostics:[]};}
