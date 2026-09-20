import { decodeGitPath } from '../../core/src/storage/safe-path.js';
import { gitCommand, GitError } from './git-command.js';
export function nulPaths(bytes: Buffer): string[] {
  const paths: string[] = []; let offset = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) { if (i > offset) paths.push(decodeGitPath(bytes.subarray(offset,i))); offset = i + 1; }
  if (offset !== bytes.length) throw new Error('Git path output is not NUL terminated');
  return paths;
}
export async function changeSet(root: string) {
  let filters: string[] = [];
  try { filters = nulPaths(await gitCommand(root,['config','--null','--name-only','--get-regexp','^filter\\..*\\.(clean|smudge|process|required)$'])); }
  catch (error) { if (!(error instanceof GitError) || error.exit_code !== 1) throw error; }
  const disabled = [...new Set(filters.map(key => key.slice(0,key.lastIndexOf('.'))))].flatMap(driver => ['-c',`${driver}.clean=`,'-c',`${driver}.smudge=`,'-c',`${driver}.process=`,'-c',`${driver}.required=false`]);
  const args = [...disabled,'diff','--no-ext-diff','--no-textconv','--no-renames','--name-only','-z'];
  const [staged,unstaged] = await Promise.all([gitCommand(root,[...args,'--cached','HEAD','--']),gitCommand(root,[...args,'--'])]);
  return {staged_changes:nulPaths(staged),unstaged_changes:nulPaths(unstaged)};
}
