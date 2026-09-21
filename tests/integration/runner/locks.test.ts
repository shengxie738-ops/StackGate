import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';
import {acquireResources} from '../../../packages/core/src/execution/resource-lock.js';
const exec=promisify(execFile);
it('serializes an actual other Node process and refuses release after creation identity substitution',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stackgate-lock-test-')),repo=path.join(root,'repo'),lockRoot=path.join(root,'locks');await fs.mkdir(repo);const context={repo_root:repo,worktree_id:'shared-worktree',platform_id:process.platform,run_id:'run_first',owner_token:'first-owner',lockRoot};
 try{const bundle=path.join(root,'resource-lock.mjs');await build({entryPoints:['packages/core/src/execution/resource-lock.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm'});
 const first=await acquireResources(['workspace_shared'],context);expect(first).not.toBeNull();
 const child=async()=>JSON.parse((await exec(process.execPath,['tests/support/resource-lock-child.mjs',bundle,JSON.stringify({...context,run_id:'run_other',owner_token:'other-owner',state_dir:'another-state'})],{timeout:15000})).stdout);
 expect(await child()).toEqual({acquired:false});await first!.release();expect(await child()).toEqual({acquired:true});
 const lease=await acquireResources(['workspace_shared'],context);expect(lease).not.toBeNull();const files=await fs.readdir(lockRoot,{recursive:true});const lock=files.find(file=>file.endsWith('.lock'))!;const file=path.join(lockRoot,lock),record=JSON.parse(await fs.readFile(file,'utf8'));expect(record.process_creation_identity).toMatch(/\S+/);record.process_creation_identity='substituted';await fs.writeFile(file,JSON.stringify(record));await expect(lease!.release()).rejects.toThrow();expect(await fs.readFile(file,'utf8')).toContain('substituted');expect(await child()).toEqual({acquired:false});
 }finally{await fs.rm(root,{recursive:true});}
},60000);
