import fs from 'node:fs/promises';
import path from 'node:path';
import { StorageError } from './storage-error.js';
export interface PathInspection { path: string; links: {path:string;link_text:string;target:string}[] }
const unsafe = (message: string): never => { throw new StorageError('UNSAFE_PATH', message); };
const portable = (value: string): string => value.replaceAll(path.sep, '/');
export function decodeGitPath(bytes: Uint8Array): string {
  let value: string;
  try { value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new StorageError('UNSUPPORTED_PATH_ENCODING', 'Git path cannot be decoded losslessly as UTF-8'); }
  if (!value || value.includes('\0')) unsafe('Empty or NUL-containing path');
  return value;
}
function components(value: string): string[] {
  if (typeof value !== 'string' || !value || Buffer.from(value).toString() !== value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) unsafe('Expected a lossless relative path');
  const parts = value.split(/[\\/]/);
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /[\x00-\x1f\x7f<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) unsafe('Ambiguous or unsafe path component');
  }
  return parts;
}
function containedRelative(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) unsafe('Path escapes the allowed root');
  return relative;
}
/** Resolve against a real existing root, preserving link evidence. Missing plain suffixes are allowed. */
export async function inspectPathWithin(root: string, relative: string): Promise<PathInspection> {
  const parts = components(relative);
  const rootPath = path.resolve(root);
  const rootStat = await fs.lstat(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) unsafe('Root must be a real directory');
  const realRoot = await fs.realpath(rootPath);
  const links: PathInspection['links'] = [];
  const activeLinks = new Set<string>();
  async function walk(from: string, pending: string[], requireExisting: boolean): Promise<string> {
    let current = from;
    for (let index = 0; index < pending.length; index++) {
      const name = pending[index]!;
      const names = (await fs.readdir(current, { encoding: 'buffer' })).map(decodeGitPath);
      const folded = name.normalize('NFC').toLowerCase();
      const aliases = names.filter(item => item.normalize('NFC').toLowerCase() === folded);
      if (aliases.length > 1 || (aliases.length === 1 && aliases[0] !== name)) throw new StorageError('PATH_CASE_CONFLICT', 'Path spelling or case collides with directory entries');
      const candidate = path.join(current, name);
      let stat;
      try { stat = await fs.lstat(candidate); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (requireExisting) unsafe('Unresolved symbolic-link target');
        return path.join(current, ...pending.slice(index));
      }
      if (stat.isSymbolicLink()) {
        if (activeLinks.has(candidate) || activeLinks.size >= 40) unsafe('Symbolic-link cycle or depth limit');
        const linkText = decodeGitPath(await fs.readlink(candidate, { encoding: 'buffer' }));
        const rawTarget = path.resolve(current, linkText);
        const targetRelative = containedRelative(realRoot, rawTarget);
        activeLinks.add(candidate);
        let target: string;
        try { target = targetRelative ? await walk(realRoot, components(targetRelative), true) : realRoot; }
        finally { activeLinks.delete(candidate); }
        links.push({ path: portable(path.relative(realRoot, candidate)), link_text: linkText, target: portable(path.relative(realRoot, target)) });
        current = target;
      } else {
        if (!stat.isDirectory() && !stat.isFile()) unsafe('Unsupported filesystem entry');
        if (index < pending.length - 1 && !stat.isDirectory()) unsafe('Ancestor is not a directory');
        current = candidate;
      }
      const real = await fs.realpath(current);
      containedRelative(realRoot, real);
      if (real !== current) unsafe('Path changed while resolving');
    }
    return current;
  }
  return { path: await walk(realRoot, parts, false), links };
}
export async function resolveWithin(root: string, relative: string): Promise<string> {
  return (await inspectPathWithin(root, relative)).path;
}
