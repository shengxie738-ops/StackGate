import { gitCommand, GitError } from './git-command.js';
import { nulPaths } from './change-set.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeGitPath, inspectPathWithin } from '../../core/src/storage/safe-path.js';
export interface InventoryEntry {relative_path:string;mode:string|null;oid?:string;tracked:boolean;conflicted:boolean}
export async function fileInventory(root: string, base: string, includeIgnored: readonly string[], exclusions: readonly string[] = [], scope: {exclude_untracked_directory_names?: readonly string[]; required_files?: readonly string[]} = {}) {
  const [tree,index,untracked,ignored] = await Promise.all([
    gitCommand(root,['ls-tree','-r','-z',base]), gitCommand(root,['ls-files','--stage','-z']),
    gitCommand(root,['ls-files','--others','--directory','--exclude-standard','-z']),
    includeIgnored.length ? gitCommand(root,['ls-files','--others','--directory','--ignored','--exclude-standard','-z']) : Promise.resolve(Buffer.alloc(0)),
  ]);
  const entries = new Map<string,InventoryEntry>();
  for (const row of nulPaths(tree)) { const match = /^(\d+) \w+ ([a-f0-9]+)\t([\s\S]+)$/.exec(row); if (!match) throw new GitError('INVALID_GIT_OUTPUT','Invalid Git tree record'); const [,mode,,relative_path] = match; entries.set(relative_path!,{relative_path:relative_path!,mode:mode!,tracked:true,conflicted:false}); }
  for (const row of nulPaths(index)) { const match = /^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/.exec(row); if (!match) throw new GitError('INVALID_GIT_OUTPUT','Invalid Git index record'); const [,mode,oid,stage,relative_path] = match; entries.set(relative_path!,{relative_path:relative_path!,mode:mode!,oid:oid!,tracked:true,conflicted:stage !== '0' || entries.get(relative_path!)?.conflicted === true}); }
  async function add(relative_path:string, ignoredEntry:boolean): Promise<void> {
    relative_path = relative_path.replace(/\/$/,'');
    if (relative_path.split('/').includes('.git') || exclusions.some(e => matchesScope(relative_path,e))) return;
    // Tree/index entries are already retained. Pruning applies only to untracked traversal.
    if (relative_path.split('/').some(part => scope.exclude_untracked_directory_names?.includes(part)) && !scope.required_files?.some(file => file === relative_path || matchesScope(file,relative_path))) return;
    if (ignoredEntry && !includeIgnored.some(i => matchesScope(relative_path,i) || matchesScope(i,relative_path))) return;
    const addEntry = () => { if (!entries.has(relative_path)) entries.set(relative_path,{relative_path,mode:null,tracked:false,conflicted:false}); };
    try {
      if (!ignoredEntry) { try { await gitCommand(root,['check-ignore','-q','--',relative_path]); return; } catch (error) { if (!(error instanceof GitError) || error.exit_code !== 1) throw error; } }
      const stat = await fs.lstat(path.join(root,relative_path));
      if (stat.isSymbolicLink() || !stat.isDirectory()) { addEntry(); return; }
      const inspected = await inspectPathWithin(root,relative_path);
      if (inspected.links.length) { addEntry(); return; }
      for (const raw of await fs.readdir(inspected.path,{encoding:'buffer'})) await add(relative_path + '/' + decodeGitPath(raw),ignoredEntry);
    } catch { addEntry(); }
  }
  for (const relative_path of nulPaths(untracked)) await add(relative_path,false);
  for (const relative_path of nulPaths(ignored)) await add(relative_path,true);
  return [...entries.values()].sort((a,b) => a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0);
}
export function matchesScope(file: string, entry: string): boolean { return file === entry || file.startsWith(entry + '/'); }
