import path from 'node:path';
import fs from 'node:fs/promises';
import type {ExecutionOwner} from '../../contracts/src/generated/execution-owner.js';
import {validateSchema} from '../../contracts/src/index.js';
import {ensureDirectoryWithin} from '../../core/src/storage/task-revisions.js';
import {writeJsonAtomic} from '../../core/src/storage/atomic-write.js';
import {inspectPathWithin} from '../../core/src/storage/safe-path.js';
import {configurationError} from '../../core/src/services/service-error.js';
export type {ExecutionOwner};
/** stateRoot already belongs to the caller; a run workspace owner is written exactly once. */
export async function createRunWorkspace(stateRoot:string,owner:ExecutionOwner):Promise<string>{
 const valid=validateSchema<ExecutionOwner>('execution-owner',owner);if(!valid.ok)throw configurationError('Invalid execution ownership marker');
 const root=await ensureDirectoryWithin(stateRoot,'work/'+owner.run_id);
 await writeJsonAtomic(path.join(root,'owner.json'),owner,{root:stateRoot});return root;
}
export async function verifyRunWorkspace(stateRoot:string,owner:Pick<ExecutionOwner,'run_id'|'repo_id'|'worktree_id'|'owner_token'>){
 const marker=await inspectPathWithin(stateRoot,'work/'+owner.run_id+'/owner.json');
 if(marker.links.length)throw configurationError('Execution owner marker may not use links');
 const stat=await fs.lstat(marker.path);if(!stat.isFile()||stat.nlink!==1||stat.size>16384)throw configurationError('Invalid execution owner marker file');
 const bytes=await fs.readFile(marker.path);const valid=validateSchema<ExecutionOwner>('execution-owner',JSON.parse(bytes.toString('utf8')));
 if(!valid.ok||Object.entries(owner).some(([key,value])=>valid.value[key as keyof ExecutionOwner]!==value))throw configurationError('Execution ownership does not match current run');
 return {path:marker.path,bytes};
}
