import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_EXCLUSIONS = [
  { prefix: '.git/', reason: 'GIT_METADATA' },
  { prefix: 'node_modules/', reason: 'REBUILDABLE_CACHE' },
  { prefix: '.pnpm-store/', reason: 'REBUILDABLE_CACHE' },
  { prefix: 'dist/', reason: 'REBUILDABLE_OUTPUT' },
  { prefix: '.stackgate/state/', reason: 'PRODUCT_RUNTIME_STATE' },
  { prefix: 'docs/implementation/evidence/', reason: 'VERIFICATION_OUTPUT' },
];

function gitNul(root, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, windowsHide: true });
  if (result.status !== 0) return null;
  return result.stdout.toString('utf8').split('\0').filter(entry => entry.length > 0);
}

function classify(entries, { tracked, staged, unstaged, differsFromHead, inIndex, inHead }) {
  return entries.map(relativePath => {
    let kind;
    if (inIndex.has(relativePath)) {
      kind = staged.has(relativePath) && unstaged.has(relativePath) ? 'TRACKED_STAGED_AND_UNSTAGED'
        : staged.has(relativePath) ? 'TRACKED_STAGED' : unstaged.has(relativePath) ? 'TRACKED_UNSTAGED' : 'TRACKED_CLEAN';
    } else if (inHead.has(relativePath)) {
      kind = 'REMOVED_FROM_INDEX_PRESENT_IN_HEAD';
    } else {
      kind = 'UNTRACKED';
    }
    return {
      relative_path: relativePath,
      kind,
      tracked: tracked.has(relativePath),
      differs_from_head: differsFromHead.has(relativePath) || staged.has(relativePath) || unstaged.has(relativePath),
    };
  });
}

export async function captureVerificationInputs(root, options = {}) {
  const { maxFileBytes = 8 * 1024 * 1024, exclusions = DEFAULT_EXCLUSIONS } = options;
  const trackedList = gitNul(root, ['ls-files', '-z']);
  const untrackedList = gitNul(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const headList = gitNul(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']);
  if (trackedList === null || untrackedList === null || headList === null) {
    return { content_hash: null, completeness: 'INCOMPLETE', incomplete_reasons: ['GIT_ENUMERATION_FAILED'], files: [], exclusions: [] };
  }
  const staged = new Set(gitNul(root, ['diff', '--name-only', '-z', '--cached']) ?? []);
  const unstaged = new Set(gitNul(root, ['diff', '--name-only', '-z']) ?? []);
  const differsFromHead = new Set(gitNul(root, ['diff', '--name-only', '-z', 'HEAD']) ?? []);
  const tracked = new Set(trackedList);
  const inIndex = new Set(trackedList);
  const inHead = new Set(headList);
  const appliedExclusions = new Map();
  const candidates = [...new Set([...trackedList, ...headList])];
  for (const relativePath of untrackedList) {
    const hit = exclusions.find(entry => relativePath.startsWith(entry.prefix) || `${relativePath}/` === entry.prefix);
    if (hit) {
      const current = appliedExclusions.get(hit.reason) ?? [];
      current.push(relativePath);
      appliedExclusions.set(hit.reason, current);
      continue;
    }
    candidates.push(relativePath);
  }
  const incomplete = [];
  const files = classify(candidates, { tracked, staged, unstaged, differsFromHead, inIndex, inHead }).map(entry => {
    const absolute = path.join(root, entry.relative_path);
    let link = null;
    try { link = lstatSync(absolute); } catch {
      return { ...entry, digest: null, mode: null, size_bytes: null };
    }
    if (link.isSymbolicLink()) { incomplete.push(`SYMBOLIC_LINK:${entry.relative_path}`); return { ...entry, digest: 'UNSAFE_LINK', mode: 'symlink', size_bytes: null }; }
    if (!link.isFile()) { incomplete.push(`NOT_A Regular_FILE:${entry.relative_path}`); return { ...entry, digest: 'NOT_A_FILE', mode: link.isDirectory() ? 'directory' : 'special', size_bytes: null }; }
    const mode = (link.mode & 0o777).toString(8);
    if (link.size > maxFileBytes) { incomplete.push(`OVER_BUDGET:${entry.relative_path}`); return { ...entry, digest: null, mode, size_bytes: link.size }; }
    let bytes;
    try { bytes = readFileSync(absolute); } catch { incomplete.push(`UNREADABLE:${entry.relative_path}`); return { ...entry, digest: null, mode, size_bytes: link.size }; }
    const settled = statSync(absolute);
    if (settled.size !== bytes.length || settled.mtimeMs > link.mtimeMs) {
      incomplete.push(`CHANGED_WHILE_READING:${entry.relative_path}`);
      return { ...entry, digest: null, mode, size_bytes: settled.size };
    }
    return { ...entry, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, mode, size_bytes: bytes.length };
  }).sort((left, right) => (left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0));
  const missing = files.filter(entry => entry.digest === null && entry.mode === null);
  for (const entry of missing) incomplete.push(`MISSING_INPUT:${entry.relative_path}`);
  if (files.some(entry => entry.digest === null && entry.mode !== null)) incomplete.push('DIGEST_UNAVAILABLE');
  const unique = new Set(files.map(entry => entry.relative_path));
  if (unique.size !== files.length) incomplete.push('DUPLICATE_PATHS');
  const digestInput = files
    .map(entry => `${entry.relative_path}\u0000${entry.mode ?? 'absent'}\u0000${entry.digest ?? 'null'}`)
    .join('\n');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  return {
    schema_version: '0.1',
    captured_at: new Date().toISOString(),
    git_head: head.status === 0 ? head.stdout.trim() : null,
    content_hash: incomplete.length === 0 ? `sha256:${createHash('sha256').update(digestInput).digest('hex')}` : null,
    completeness: incomplete.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
    incomplete_reasons: [...new Set(incomplete)].sort(),
    file_count: files.length,
    tracked_count: files.filter(entry => entry.tracked).length,
    index_count: inIndex.size,
    untracked_count: files.filter(entry => entry.kind === 'UNTRACKED').length,
    files,
    exclusions: [...appliedExclusions.entries()].map(([reason, paths]) => ({ reason, count: paths.length, relative_paths: paths })).sort((a, b) => a.reason.localeCompare(b.reason)),
  };
}

export function compareInputSnapshots(before, after) {
  return {
    content_hash_changed: before.content_hash !== after.content_hash,
    both_complete: before.completeness === 'COMPLETE' && after.completeness === 'COMPLETE',
    added: after.files.filter(entry => !before.files.some(old => old.relative_path === entry.relative_path)).map(entry => entry.relative_path),
    removed: before.files.filter(entry => !after.files.some(old => old.relative_path === entry.relative_path)).map(entry => entry.relative_path),
    modified: after.files.filter(entry => {
      const old = before.files.find(candidate => candidate.relative_path === entry.relative_path);
      return old && old.digest !== entry.digest;
    }).map(entry => entry.relative_path),
  };
}
