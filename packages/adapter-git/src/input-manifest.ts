import type { InputManifest } from '../../contracts/src/index.js';
import type { ProjectContext } from '../../core/src/ports/adapter.js';
import type { Baseline } from './baseline.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectPathWithin } from '../../core/src/storage/safe-path.js';
import { hashBytes } from '../../core/src/storage/hash.js';
import { canonicalJson } from '../../core/src/storage/canonical-json.js';
import { inspectRepository } from './repository.js';
import { fileInventory, matchesScope } from './file-inventory.js';
import { changeSet } from './change-set.js';
import { gitCommand, gitText, GitError } from './git-command.js';
export interface InputScope { exclusions?: readonly {relative_path:string;reason:string}[]; include_ignored?: readonly string[]; max_file_bytes?: number; unresolved_inputs?: readonly string[] }
export async function captureInputs(project: ProjectContext, baseline: Baseline, scope: InputScope = {}): Promise<InputManifest> {
  const repository = await inspectRepository(project.repo_root);
  const excluded = [{relative_path:'.git',reason:'Git internal state'}, {relative_path:'.stackgate/state',reason:'StackGate local state'}, ...(scope.exclusions ?? [])];
  const includeIgnored = [...(scope.include_ignored ?? [])];
  for (const entry of [...excluded,...includeIgnored.map(relative_path => ({relative_path,reason:'explicit input'}))]) { if (!entry.reason.trim()) throw new GitError('INVALID_SCOPE','Exclusions need an explanation'); await inspectPathWithin(repository.repo_root,entry.relative_path); }
  const maxBytes = scope.max_file_bytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new GitError('INVALID_SCOPE','max_file_bytes must be a positive integer');
  const changes = await changeSet(repository.repo_root);
  const inventory = await fileInventory(repository.repo_root,baseline.base_oid,includeIgnored,excluded.map(e => e.relative_path));
  const files: InputManifest['files'] = [];
  const diagnostics: string[] = [];
  let completeness: InputManifest['completeness'] = 'COMPLETE';
  function incomplete(code:string, file:string) { completeness = 'INCOMPLETE'; diagnostics.push(`${code}: ${file}`); }
  const credential = (file:string) => /(^|\/)(?:\.env(?:\..*)?|credentials(?:\.json)?|id_rsa|id_ed25519)$|\.(?:pem|key)$/i.test(file);
  const scopedChanges = (paths:string[]) => paths.filter(p => !excluded.some(e => matchesScope(p,e.relative_path)) && !credential(p));
  for (const item of inventory) {
    const file = item.relative_path;
    if (excluded.some(e => matchesScope(file,e.relative_path))) continue;
    if (credential(file)) { excluded.push({relative_path:file,reason:'Credential-bearing input excluded; declare nonsecret requirements separately'}); continue; }
    if (item.conflicted) { incomplete('UNRESOLVED_MERGE',file); continue; }
    if (item.mode === '160000') { incomplete('SUBMODULE_UNVERIFIED',file); continue; }
    const state = {relative_path:file,tracked:item.tracked,staged:changes.staged_changes.includes(file),unstaged:changes.unstaged_changes.includes(file)};
    try {
      if (item.oid) { try { await gitCommand(repository.repo_root,['cat-file','-e',item.oid]); } catch { incomplete('MISSING_OBJECT',file); continue; } }
      const inspected = await inspectPathWithin(repository.repo_root,file);
      let stat;
      try { stat = await fs.lstat(path.join(repository.repo_root,file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; files.push({...state,kind:'deleted',digest:null,mode:item.mode}); continue; }
      if (stat.isSymbolicLink()) {
        const target = await fs.stat(inspected.path);
        if (!target.isFile() || target.size > maxBytes) { incomplete('UNVERIFIED_LINK_TARGET',file); continue; }
        const link_target = await fs.readlink(path.join(repository.repo_root,file));
        const digest = hashBytes(Buffer.from(canonicalJson({link_target,target_digest:hashBytes(await fs.readFile(inspected.path))})));
        files.push({...state,kind:'symlink',digest,mode:'120000',link_target}); continue;
      }
      if (item.mode === '120000') { incomplete('SYMLINK_CHECKOUT_UNVERIFIED',file); continue; }
      if (inspected.links.length || !stat.isFile()) { incomplete('UNSUPPORTED_FILE',file); continue; }
      if (stat.size > maxBytes) { incomplete('FILE_TOO_LARGE',file); continue; }
      const bytes = await fs.readFile(inspected.path);
      const after = await fs.stat(inspected.path);
      if (bytes.length > maxBytes || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino) { incomplete('INPUT_CHANGED_DURING_CAPTURE',file); continue; }
      if (/^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/.test(bytes.subarray(0,128).toString())) { incomplete('LFS_OBJECT_UNAVAILABLE',file); continue; }
      const mode = process.platform === 'win32' ? item.mode === '100755' ? '100755' : '100644' : stat.mode & 0o111 ? '100755' : '100644';
      files.push({...state,kind:'file',digest:hashBytes(bytes),mode});
    } catch { incomplete('UNSAFE_OR_UNREADABLE_INPUT',file); }
  }
  for (const input of includeIgnored) if (!files.some(f => matchesScope(f.relative_path,input))) { if (completeness === 'COMPLETE') completeness = 'UNKNOWN'; diagnostics.push(`REQUIRED_INPUT_UNVERIFIED: ${input}`); }
  if (scope.unresolved_inputs?.length) { if (completeness === 'COMPLETE') completeness = 'UNKNOWN'; diagnostics.push(...scope.unresolved_inputs.map(i => `GENERATED_INPUT_UNVERIFIED: ${i}`)); }
  if (await gitText(repository.repo_root,['rev-parse','HEAD']) !== baseline.head_oid) incomplete('HEAD_CHANGED_SINCE_BASELINE','HEAD');
  const finalChanges = await changeSet(repository.repo_root);
  if (canonicalJson(finalChanges) !== canonicalJson(changes)) incomplete('INPUT_CHANGED_DURING_CAPTURE','index/worktree');
  const hashInput = {files:files.map(file => ({relative_path:file.relative_path,kind:file.kind,digest:file.digest,mode:file.mode,...(file.kind === 'symlink' ? {link_target:file.link_target} : {})})),scope:{exclusions:scope.exclusions ?? [],include_ignored:includeIgnored},completeness,diagnostics};
  return {schema_version:'0.1',repo_id:repository.repo_id,worktree_id:repository.worktree_id,platform_id:repository.platform_id,base_oid:baseline.base_oid,head_oid:baseline.head_oid,target_tip_oid:baseline.target_tip_oid,git_object_format:baseline.git_object_format,files,exclusions:excluded,staged_changes:scopedChanges(changes.staged_changes),unstaged_changes:scopedChanges(changes.unstaged_changes),completeness,diagnostics,input_hash:hashBytes(Buffer.from(canonicalJson(hashInput)))};
}
