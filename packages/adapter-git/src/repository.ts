import fs from 'node:fs/promises';
import path from 'node:path';
import { hashBytes } from '../../core/src/storage/hash.js';
import { GitError, gitText } from './git-command.js';
export interface RepositoryIdentity {repo_id:string;worktree_id:string;repo_root:string;common_dir:string;git_dir:string;platform_id:string;git_object_format:'sha1'|'sha256'}
export async function inspectRepository(projectRoot: string): Promise<RepositoryIdentity> {
  let root: string;
  try { root = await gitText(projectRoot,['rev-parse','--show-toplevel']); }
  catch (error) { if (error instanceof GitError && error.code === 'GIT_UNAVAILABLE') throw error; throw new GitError('NOT_A_REPOSITORY','Project root is not an accessible Git worktree'); }
  const repo_root = await fs.realpath(root);
  const common_dir = await fs.realpath(await gitText(repo_root,['rev-parse','--path-format=absolute','--git-common-dir']));
  const git_dir = await fs.realpath(await gitText(repo_root,['rev-parse','--absolute-git-dir']));
  const format = await gitText(repo_root,['rev-parse','--show-object-format']);
  if (format !== 'sha1' && format !== 'sha256') throw new GitError('UNSUPPORTED_OBJECT_FORMAT','Unsupported Git object format');
  const identity = (value: string) => hashBytes(Buffer.from(process.platform === 'win32' ? path.normalize(value).toLowerCase() : value));
  return {repo_root, common_dir, git_dir, repo_id:`repo_${identity(common_dir)}`, worktree_id:`worktree_${identity(repo_root)}`, platform_id:`${process.platform}-${process.arch}`, git_object_format:format};
}
