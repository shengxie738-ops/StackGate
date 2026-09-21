import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {withTestDirectory} from '../../support/test-paths.js';
import {prepareWorker,worker,runFixture} from '../../support/reliability.js';
vi.setConfig({testTimeout:45000});
it('two process finalization calls are idempotent and cannot replace terminal facts',()=>withTestDirectory(async root=>{
 const file=await prepareWorker(root),f=await runFixture(root,true),snapshot=await f.store.readRun(f.manifest.run_id),args={stateRoot:f.stateRoot,owner:f.owner,manifest:f.manifest,expected_hash:snapshot.manifest_hash},before=await fs.readFile(path.join(f.stateRoot,'runs',f.manifest.run_id,'manifest.json')),a=worker(file,'finalize',args),b=worker(file,'finalize',args);await Promise.all([a.start(),b.start()]);expect((await Promise.all([a.wait('result'),b.wait('result')])).every(value=>value.status==='UPDATED')).toBe(true);await Promise.all([a.closed,b.closed]);expect(await fs.readFile(path.join(f.stateRoot,'runs',f.manifest.run_id,'manifest.json'))).toEqual(before);await expect(f.store.updateManifest({...f.manifest,verdict:'PASS'},snapshot.manifest_hash!)).rejects.toThrow();
}));
it('two process seals agree and post-seal manifest corruption never remains valid',()=>withTestDirectory(async root=>{
 const file=await prepareWorker(root),f=await runFixture(root,true),args={stateRoot:f.stateRoot,owner:f.owner,request:f.request},a=worker(file,'seal',args),b=worker(file,'seal',args);await Promise.all([a.start(),b.start()]);const results=await Promise.all([a.wait('result'),b.wait('result')]);await Promise.all([a.closed,b.closed]);expect(results.map(value=>(value.result as {status:string}).status)).toEqual(['SEALED','SEALED']);expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('VALID');const manifestPath=path.join(f.stateRoot,'runs',f.manifest.run_id,'manifest.json');await fs.appendFile(manifestPath,' ');expect((await f.store.verifyRun(f.manifest.run_id)).status).toBe('INVALID');expect((await f.store.seal(f.request)).status).toBe('ERROR');
}));
