import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { hashBytes } from './hash.js';
import { inspectPathWithin } from './safe-path.js';
import { StorageError } from './storage-error.js';
export interface AtomicWriteOptions {
  /** Explicit allowed root. Default is the current workspace. Parents must already exist. */
  root?: string;
  /** Caller-confirmed ownership plus the exact prior-byte digest is required to replace. */
  expectedHash?: string;
}
/** Cooperating writers are serialized. This is not a sandbox against hostile same-identity processes. */
export async function writeJsonAtomic(file: string, value: unknown, options: AtomicWriteOptions = {}): Promise<void> {
  const bytes = Buffer.from(canonicalJson(value) + '\n');
  const root = path.resolve(options.root ?? process.cwd());
  if (file.split(/[\\/]/).includes('..')) throw new StorageError('UNSAFE_PATH', 'Write path contains traversal');
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  if (options.expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedHash)) throw new StorageError('TARGET_CHANGED', 'Expected digest must be SHA-256');
  const initial = await inspectPathWithin(root, relative);
  if (initial.links.length) throw new StorageError('UNSAFE_PATH', 'Writes through links are not allowed');
  const target = initial.path;
  const parent = path.dirname(target);
  const parentStat = await fs.stat(parent, { bigint: true });
  const rootStat = await fs.stat(root, { bigint: true });
  const sameIdentity = (a: typeof parentStat, b: typeof parentStat): boolean => a.dev === b.dev && a.ino === b.ino;
  async function recheckPath(): Promise<void> {
    const checked = await inspectPathWithin(root, relative);
    if (checked.links.length || checked.path !== target || !sameIdentity(rootStat, await fs.stat(root, { bigint: true })) || !sameIdentity(parentStat, await fs.stat(parent, { bigint: true }))) throw new StorageError('UNSAFE_PATH', 'Write directory changed');
  }
  async function checkTarget(): Promise<void> {
    let stat;
    try { stat = await fs.lstat(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (options.expectedHash !== undefined) throw new StorageError('TARGET_CHANGED', 'Expected target is missing');
      return;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new StorageError('UNSAFE_PATH', 'Target must be an ordinary unlinked file');
    if (options.expectedHash === undefined) throw new StorageError('TARGET_EXISTS', 'Refusing to overwrite an existing file');
    if (hashBytes(await fs.readFile(target)) !== options.expectedHash) throw new StorageError('TARGET_CHANGED', 'Target bytes changed');
  }
  await checkTarget();
  const lockPath = path.join(parent, '.sg-lock-' + hashBytes(Buffer.from(path.basename(target).toLowerCase())).slice(0, 24));
  await recheckPath();
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageError('WRITE_BUSY', 'Another write or an unrecovered lock exists');
    throw error;
  }
  let temporary: string | undefined;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    await recheckPath();
    await checkTarget();
    const candidate = path.join(parent, '.sg-tmp-' + randomUUID());
    handle = await fs.open(candidate, 'wx', 0o600);
    temporary = candidate;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await recheckPath();
    await checkTarget();
    if (options.expectedHash === undefined) await fs.link(temporary, target);
    else await fs.rename(temporary, target);
  } finally {
    await handle?.close();
    await lock.close();
    // Do not unlink through a parent/root that has been replaced since validation.
    await recheckPath();
    if (temporary) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.unlink(lockPath);
  }
}
