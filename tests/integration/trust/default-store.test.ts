import {expect,it,vi} from 'vitest';
import {localRunProject} from '../../support/local-run-project.js';
import {TrustService} from '../../../packages/core/src/services/trust-service.js';
vi.setConfig({testTimeout:120000});
it('creates a real grant in the default external platform trust store',async()=>{
 const repo=await localRunProject();try{const service=new TrustService(repo.root),review=await service.review(),confirmed=await service.confirm(review.execution_digest,{authorized:true});expect(confirmed.trusted).toBe(true);}finally{await repo.cleanup();}
});
