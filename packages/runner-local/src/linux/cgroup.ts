import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn, type ChildProcess} from 'node:child_process';
import {readLinuxRunnerProvenance} from './provenance.js';

/**
 * cgroup v2 primitives for the Linux runner. Everything here is decided by what the running kernel
 * answers today, never by a cached platform claim: a directory we can create is not the same thing as
 * a process we can move, and the second one is what ownership actually rests on.
 */
export const CGROUP_MECHANISM = 'CGROUPV2_DELEGATED_SUBTREE';

export type DelegationStatus = 'DELEGATED' | 'NOT_LINUX' | 'NO_CGROUPV2_MOUNT' | 'ROOT_NOT_PRIVATE' | 'ROOT_NOT_USABLE' | 'MIGRATION_REFUSED' | 'PROBE_UNAVAILABLE';

export interface DelegationEvidence {
  status: DelegationStatus;
  mechanism: string;
  run_root: string | null;
  reasons: string[];
  observed: {
    platform: string;
    arch: string;
    kernel: string;
    euid: number | null;
    self_cgroup: string;
    mount_point: string | null;
    mount_flags: string | null;
    controllers: readonly string[];
    subtree_control: readonly string[];
    migration_errno: string | null;
  };
}

const NAMESPACE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

async function read(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function evidence(status: DelegationStatus, run_root: string | null, reasons: string[], observed: DelegationEvidence['observed']): DelegationEvidence {
  return {status, mechanism: status === 'DELEGATED' ? CGROUP_MECHANISM : 'UNSUPPORTED', run_root, reasons, observed};
}

const EMPTY = {platform: '', arch: '', kernel: '', euid: null, self_cgroup: '', mount_point: null, mount_flags: null, controllers: [], subtree_control: [], migration_errno: null};

/**
 * Unified-hierarchy lookup from mountinfo. The kernel lists the mount point before the `-` separator
 * and the filesystem plus super options after it, so a line is only a cgroup2 mount when the field
 * after the separator starts with `cgroup2 `.
 */
function unifiedMount(mountinfo: string): {mount_point: string; flags: string} | null {
  for (const line of mountinfo.split('\n')) {
    const split = line.split(' - ');
    if (split.length !== 2) continue;
    const tail = split[1]!.trim().split(/\s+/);
    if (tail[0] !== 'cgroup2') continue;
    const fields = split[0]!.trim().split(/\s+/);
    const mount_point = fields[4];
    if (!mount_point?.startsWith('/')) continue;
    return {mount_point, flags: tail[2] ?? ''};
  }
  return null;
}

function ownCgroup(selfCgroup: string): string | null {
  for (const line of selfCgroup.split('\n')) {
    if (!line.startsWith('0::')) continue;
    const value = line.slice(3).trim();
    return value.startsWith('/') ? value : null;
  }
  return null;
}

/**
 * A run root is only usable when it is a real directory below the cgroup2 mount that this process
 * owns. Every component is resolved without following symlinks, because a `..` or a planted link in a
 * shared parent would otherwise hand our reclaim loop a path we do not control.
 */
export async function assertDelegatedRoot(candidate: string): Promise<{ok: true; root: string} | {ok: false; reason: string}> {
  if (process.platform !== 'linux') return {ok: false, reason: 'NOT_LINUX'};
  if (!candidate.startsWith('/') || candidate.includes('\0') || candidate.includes('\\')) return {ok: false, reason: 'ROOT_NOT_ABSOLUTE'};
  const segments = candidate.split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..')) return {ok: false, reason: 'ROOT_HAS_DOT_SEGMENT'};
  const mountinfo = await read('/proc/self/mountinfo');
  if (mountinfo === null) return {ok: false, reason: 'MOUNTINFO_UNREADABLE'};
  const mount = unifiedMount(mountinfo);
  if (mount === null) return {ok: false, reason: 'NO_CGROUPV2_MOUNT'};
  if (!path.posix.isAbsolute(mount.mount_point)) return {ok: false, reason: 'MOUNT_POINT_INVALID'};
  const inside = candidate === mount.mount_point ? '' : candidate.slice(mount.mount_point.length);
  if (mount.mount_point !== '/' && !candidate.startsWith(mount.mount_point + '/')) return {ok: false, reason: 'ROOT_OUTSIDE_MOUNT'};
  if (candidate === mount.mount_point || inside === '') return {ok: false, reason: 'ROOT_IS_MOUNT_ITSELF'};
  let walked = mount.mount_point === '/' ? '' : mount.mount_point;
  for (const segment of inside.split('/').filter(Boolean)) {
    walked = path.posix.join(walked, segment);
    const step = await fs.lstat(walked).catch(() => null);
    if (step === null) return {ok: false, reason: 'ROOT_COMPONENT_MISSING'};
    if (step.isSymbolicLink()) return {ok: false, reason: 'ROOT_COMPONENT_SYMLINK'};
    if (!step.isDirectory()) return {ok: false, reason: 'ROOT_COMPONENT_NOT_DIRECTORY'};
  }
  const stat = await fs.lstat(candidate).catch(() => null);
  if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) return {ok: false, reason: 'ROOT_NOT_A_DIRECTORY'};
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  if (euid === null || stat.uid !== euid || (stat.mode & 0o200) === 0) return {ok: false, reason: 'ROOT_NOT_OWNED'};
  return {ok: true, root: candidate};
}

/**
 * Migrations are refused with EACCES when the writing process sits in a cgroup that was never delegated
 * to it, even if the destination belongs to it. That is why availability is proven by actually moving a
 * throwaway child and not by checking the destination's mode bits alone.
 */
export async function detectCgroupDelegation(overrides: {launcher?: string} = {}): Promise<DelegationEvidence> {
  const observed: DelegationEvidence['observed'] = {...EMPTY, platform: process.platform, arch: process.arch};
  if (process.platform !== 'linux') return evidence('NOT_LINUX', null, ['NOT_LINUX'], observed);
  const provenance = await readLinuxRunnerProvenance();
  const launcher = overrides.launcher ?? provenance.launcher;
  if (provenance.status !== 'AVAILABLE' || launcher === null) return evidence('PROBE_UNAVAILABLE', null, [`LAUNCHER_${provenance.reason ?? 'UNAVAILABLE'}`], observed);
  observed.kernel = (await read('/proc/sys/kernel/osrelease'))?.trim() ?? '';
  observed.euid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  const mountinfo = await read('/proc/self/mountinfo');
  if (mountinfo === null) return evidence('NO_CGROUPV2_MOUNT', null, ['MOUNTINFO_UNREADABLE'], observed);
  const mount = unifiedMount(mountinfo);
  if (mount === null) return evidence('NO_CGROUPV2_MOUNT', null, ['NO_CGROUPV2_MOUNT'], observed);
  observed.mount_point = mount.mount_point;
  observed.mount_flags = mount.flags;
  const selfPath = ownCgroup((await read('/proc/self/cgroup')) ?? '');
  if (selfPath === null) return evidence('ROOT_NOT_PRIVATE', null, ['SELF_CGROUP_UNREADABLE'], observed);
  observed.self_cgroup = selfPath;
  if (selfPath === '/') return evidence('ROOT_NOT_PRIVATE', null, ['ROOT_CGROUP_IS_SHARED'], observed);
  const candidate = path.posix.join(mount.mount_point, selfPath);
  const asserted = await assertDelegatedRoot(candidate);
  if (!asserted.ok) return evidence('ROOT_NOT_USABLE', null, [asserted.reason], observed);
  observed.controllers = (await read(path.posix.join(asserted.root, 'cgroup.controllers')) ?? '').trim().split(/\s+/).filter(Boolean);
  observed.subtree_control = (await read(path.posix.join(asserted.root, 'cgroup.subtree_control')) ?? '').trim().split(/\s+/).filter(Boolean);

  const token = randomUUID().replace(/-/g, '').slice(0, 16);
  const probe = path.posix.join(asserted.root, `stackgate-cap-${token}`);
  try {
    await fs.mkdir(probe);
  } catch {
    return evidence('ROOT_NOT_USABLE', null, ['PROBE_MKDIR_FAILED'], observed);
  }
  try {
    const scratch = await fs.mkdtemp('/tmp/stackgate-cap-');
    const statusFile = path.posix.join(scratch, 'started.txt');
    const child: ChildProcess = spawn('/bin/sh', [launcher, path.posix.join(probe, 'cgroup.procs'), statusFile, '/bin/sleep', '3'], {shell: false, stdio: ['ignore', 'ignore', 'pipe'], env: {}});
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-400);
    });
    const members = path.posix.join(probe, 'cgroup.procs');
    let attached = false;
    for (let attempt = 0; attempt < 40 && child.pid !== undefined; attempt++) {
      if ((await read(members) ?? '').split(/\s+/).map(Number).includes(child.pid)) {
        attached = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    let direct = 'NOT_ATTEMPTED';
    if (!attached) {
      // Report the kernel's own answer rather than a conclusion: a refusal to move one of our own
      // children is a different host condition from a destination we could not create.
      direct = await fs.writeFile(members, `${child.pid ?? 0}\n`).then(() => 'WRITTEN', (error: NodeJS.ErrnoException) => String(error.code ?? error.message));
      child.kill('SIGKILL');
      await new Promise<void>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('close', () => resolve());
      });
    }
    const reported = (await read(statusFile)) ?? 'ABSENT';
    await fs.rm(scratch, {recursive: true, force: true}).catch(() => undefined);
    if (attached) return evidence('DELEGATED', asserted.root, [], observed);
    observed.migration_errno = direct === 'WRITTEN' ? 'SELF_ATTACH_FAILED' : direct;
    return evidence('MIGRATION_REFUSED', null, ['MIGRATION_REFUSED', `LAUNCHER_STATUS:${reported.trim()}`, `SUPERVISOR_WRITE:${direct}`, `SHELL:${stderr.trim().slice(0, 160)}`], observed);
  } finally {
    await killMembers(probe);
    await fs.rmdir(probe).catch(() => undefined);
  }
}

export function isNamespaceName(value: string): boolean {
  return NAMESPACE.test(value);
}

/** The one shape of run subtree this runner will ever create or remove. */
export function runSubtreeName(run_id: string, token: string): string {
  if (!isNamespaceName(run_id) || !isNamespaceName(token)) throw new Error('Unusable run subtree name');
  return `stackgate-${run_id}-${token}`;
}

export async function createRunSubtree(root: string, run_id: string): Promise<{directory: string; token: string}> {
  const token = randomUUID();
  const directory = path.posix.join(root, runSubtreeName(run_id, token));
  await fs.mkdir(directory);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Run subtree is not a private directory');
  return {directory, token};
}

export async function readMembers(directory: string): Promise<number[]> {
  const raw = await read(path.posix.join(directory, 'cgroup.procs'));
  if (raw === null) return [];
  return raw.split(/\s+/).filter(Boolean).map(Number).filter(pid => Number.isSafeInteger(pid) && pid > 0);
}

export function parseCreationIdentity(stat: string, bootId: string): string | null {
  // comm is wrapped in parentheses and may contain spaces, so the numeric fields only start after the
  // last closing paren; field 22 of the whole line is starttime.
  const end = stat.lastIndexOf(')');
  if (end < 0) return null;
  const fields = stat.slice(end + 1).trim().split(/\s+/);
  const starttime = fields[19];
  if (!starttime || !/^\d+$/.test(starttime)) return null;
  return `${bootId}:${starttime}`;
}

/**
 * starttime is fixed at task creation and survives execve, and boot_id separates reuse across reboots,
 * so the pair identifies the process rather than the number a later holder may have been given.
 */
export async function readCreationIdentity(pid: number): Promise<string | null> {
  const [stat, bootId] = await Promise.all([read(`/proc/${pid}/stat`), read('/proc/sys/kernel/random/boot_id')]);
  if (stat === null || bootId === null) return null;
  return parseCreationIdentity(stat, bootId.trim());
}

export async function killMembers(directory: string): Promise<void> {
  for (const pid of await readMembers(directory)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone, or owned by someone else: neither is ours to claim.
    }
  }
}

export interface ReclaimReport {
  cleanup: 'VERIFIED' | 'UNVERIFIED';
  method: 'CGROUP_KILL' | 'SIGKILL_PER_PID' | 'NONE';
  froze: boolean;
  thawed: boolean;
  members_before: readonly number[];
  members_after: readonly number[];
  removed: boolean;
  rmdir_reason: string | null;
  rounds: number;
}

/**
 * Freeze first so no member can fork while we are reclaiming, signal the whole subtree, then thaw so a
 * pending SIGKILL can actually be delivered: a frozen task is stopped, not dead. Removal is only ever a
 * confirmation, since the kernel refuses to remove a subtree that still has members.
 */
export async function reclaimSubtree(directory: string, deadlineMs: number): Promise<ReclaimReport> {
  const started = Date.now();
  const members_before = await readMembers(directory);
  let method: ReclaimReport['method'] = 'NONE';
  let froze = false, thawed = false;
  const write = async (name: string, value: string) => fs.writeFile(path.posix.join(directory, name), value).then(() => true, () => false);
  if (await write('cgroup.freeze', '1')) froze = true;
  if (await write('cgroup.kill', '1')) method = 'CGROUP_KILL';
  if (froze) await write('cgroup.freeze', '0');
  thawed = froze;
  let members_after = await readMembers(directory);
  let rounds = 0;
  while (members_after.length && Date.now() - started < deadlineMs) {
    rounds++;
    if (method === 'NONE') {
      method = 'SIGKILL_PER_PID';
      await killMembers(directory);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    members_after = await readMembers(directory);
  }
  let removed = false, rmdir_reason: string | null = null;
  if (members_after.length === 0) {
    try {
      await fs.rmdir(directory);
      removed = true;
    } catch (error) {
      const code = String((error as NodeJS.ErrnoException).code ?? error);
      // Measured on this kernel: once the member set empties, the subtree is collected without being
      // removed, so ENOENT here is the same outcome as a successful removal rather than a failure.
      if (code === 'ENOENT') {
        removed = true;
        rmdir_reason = 'ALREADY_COLLECTED';
      } else {
        rmdir_reason = code;
      }
    }
  } else {
    rmdir_reason = 'MEMBERS_REMAIN';
  }
  const cleanup: ReclaimReport['cleanup'] = members_after.length === 0 && removed ? 'VERIFIED' : 'UNVERIFIED';
  return {cleanup, method, froze, thawed, members_before, members_after, removed, rmdir_reason, rounds};
}
