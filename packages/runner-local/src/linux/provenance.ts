import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashBytes} from '../../../core/src/storage/hash.js';

declare const STACKGATE_BUNDLED: boolean;

const LAUNCHER_LIMIT = 64 * 1024;

export interface LinuxProvenance {
  platform: string;
  arch: string;
  mechanism: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  launcher: string | null;
  interpreter: string | null;
  files: {path: string; digest: string}[];
  reason: string | null;
}

/**
 * The launcher is the only piece of this runner that runs with a fixed identity, so it is hashed before
 * being spawned and the spawned path is the resolved one. `/bin/sh` is recorded rather than pinned: it is
 * the host's interpreter, and a distribution upgrade legitimately changes it, so its digest belongs in the
 * evidence instead of in a precondition that would break otherwise working runs.
 */
export async function readLinuxRunnerProvenance(): Promise<LinuxProvenance> {
  const platform = process.platform, arch = process.arch, mechanism = 'CGROUPV2_DELEGATED_SUBTREE';
  const blank: LinuxProvenance = {platform, arch, mechanism, status: 'UNAVAILABLE', launcher: null, interpreter: null, files: [], reason: null};
  const fail = (reason: string): LinuxProvenance => ({...blank, reason});
  if (platform !== 'linux') return fail('NOT_LINUX');
  const bundled = typeof STACKGATE_BUNDLED !== 'undefined' && STACKGATE_BUNDLED;
  const candidate = path.join(fileURLToPath(new URL(bundled ? './runner-local/' : './', import.meta.url)), 'attest-launch.sh');
  const stat = await fs.lstat(candidate).catch(() => null);
  if (stat === null) return fail('LAUNCHER_MISSING');
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > LAUNCHER_LIMIT) return fail('LAUNCHER_UNSAFE');
  const launcher = await fs.realpath(candidate).catch(() => null);
  if (launcher === null) return fail('LAUNCHER_REALPATH_FAILED');
  const bytes = await fs.readFile(launcher);
  if (hashBytes(bytes) !== hashBytes(await fs.readFile(candidate))) return fail('LAUNCHER_CHANGED');
  const files = [{path: launcher, digest: hashBytes(bytes)}];
  let interpreter: string | null = null;
  const shellStat = await fs.lstat('/bin/sh').catch(() => null);
  if (shellStat?.isFile() && !shellStat.isSymbolicLink() && shellStat.size <= 16 * 1024 * 1024) {
    interpreter = await fs.realpath('/bin/sh').catch(() => '/bin/sh');
    files.push({path: interpreter, digest: hashBytes(await fs.readFile(interpreter))});
  }
  return {platform, arch, mechanism, status: 'AVAILABLE', launcher, interpreter, files, reason: null};
}
