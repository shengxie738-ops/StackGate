import type { BaselineIdentity } from '../../core/src/ports/git.js';
import { inspectRepository } from './repository.js';
import { GitError, gitText, gitCommand } from './git-command.js';
export type Baseline = BaselineIdentity;
export async function resolveBaseline(request: {project_root: string; target_ref: string; head_ref?: string}): Promise<Baseline> {
  const repository = await inspectRepository(request.project_root);
  if ((await gitCommand(repository.repo_root,['ls-files','--unmerged','-z'])).length) throw new GitError('UNRESOLVED_MERGE','Resolve index merge conflicts before baseline capture');
  async function commit(ref: string): Promise<string> {
    if (!ref || ref.startsWith('-') || /[\x00-\x20\x7f]/.test(ref)) throw new GitError('INVALID_REF','Expected a non-option Git revision');
    try { return await gitText(repository.repo_root,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`]); }
    catch { throw new GitError('BASELINE_MISSING','Requested commit is unavailable in local Git objects'); }
  }
  const head_oid = await commit(request.head_ref ?? 'HEAD');
  const target_tip_oid = await commit(request.target_ref);
  let bases: string[];
  try { bases = (await gitText(repository.repo_root,['merge-base','--all',head_oid,target_tip_oid])).split('\n').filter(Boolean); }
  catch { throw new GitError('BASELINE_MISSING','No common baseline is available in local Git history'); }
  if (bases.length !== 1) throw new GitError('AMBIGUOUS_BASELINE','Expected exactly one common baseline');
  return {base_oid:bases[0]!,head_oid,target_tip_oid,git_object_format:repository.git_object_format,source_ref:request.target_ref};
}
