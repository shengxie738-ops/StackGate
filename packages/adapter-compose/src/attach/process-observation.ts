import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Live process facts, read from the operating system about a process this run did not create.
 *
 * This module is deliberately separate from the provenance verdict (`provenance.ts`): the verdict is a pure
 * comparison over facts somebody else measured, and only this file touches the host. Three rules hold here:
 *
 * 1. **Nothing is ever terminated.** There is no `kill`, no signal, no process handle with write access and no
 *    shell string built from anything but a validated integer. The only processes that can be stopped by the
 *    bounded helper timeouts are the helper children *this file* spawned, which is reclaiming its own resource.
 * 2. **A process name is never evidence.** Every fact returned is a creation identity or a socket owner:
 *    comparing a number the operating system keeps about when a process came into existence, or who holds a
 *    listening port. An image name, a command line or a window title cannot make provenance `OBSERVED`.
 * 3. **A platform that will not say is reported as such.** `UNSUPPORTED` and `ERROR` are returned as facts about
 *    the observation, never dressed up as a match, so the caller degrades to `DECLARED` instead of guessing.
 */

const execute = promisify(execFile);

/**
 * 100 ns intervals between the .NET epoch (0001-01-01) and the FILETIME epoch (1601-01-01), which the launcher's
 * `kernel32.GetProcessTimes` value is measured from. Measured on this host on 2026-10-03: for one and the same
 * process, `[Diagnostics.Process]::GetProcessById(pid).StartTime.ToUniversalTime().Ticks` minus the launcher's
 * recorded `creation_identity` equalled exactly this constant, so the two mechanisms are comparable digit for
 * digit instead of being reconciled by a tolerance window.
 */
export const FILETIME_EPOCH_OFFSET_TICKS = 504911232000000000n;

/** Seconds between the FILETIME epoch and the Unix epoch; the launcher uses the same figure. */
const FILETIME_UNIX_OFFSET_SECONDS = 11644473600n;

/** Any single helper must not outlive the request that asked for it. */
const HELPER_TIMEOUT_MS = 5000;
const HELPER_OUTPUT_CAP = 16 * 1024 * 1024;

export type LiveFactStatus = 'OBSERVED' | 'NOT_FOUND' | 'UNSUPPORTED' | 'ERROR';

export interface LiveProcessIdentity {
  status: LiveFactStatus;
  pid: number | null;
  /** Creation identity normalised into the FILETIME form the launcher records; null when nothing was observed. */
  creation_identity: string | null;
  /** UTC wall clock derived from the same observed number, null when the platform would not say. */
  created_at: string | null;
  /** What was actually asked of the operating system, so the reader can see which mechanism vouched. */
  mechanism: string;
  detail: string | null;
}

export interface LiveListenerOwnership {
  status: LiveFactStatus;
  /** The single process the operating system reports as holding the listening socket, null when unknown. */
  pid: number | null;
  /** Local socket addresses reported for that port, exactly as the operating system printed them. */
  addresses: string[];
  mechanism: string;
  detail: string | null;
}

function windowsPowerShell(): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
}

function isPid(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/** FILETIME (100 ns since 1601-01-01) to a UTC ISO string, truncated to milliseconds like the launcher's own. */
export function filetimeToIso(filetimeTicks: bigint): string {
  const milliseconds = Number(filetimeTicks / 10_000n) - Number(FILETIME_UNIX_OFFSET_SECONDS) * 1000;
  return new Date(milliseconds).toISOString();
}

/**
 * When did this process come into existence, according to the operating system rather than to its own record?
 *
 * win32: `GetProcessById(pid).StartTime.ToUniversalTime().Ticks`, a different API and a different process from
 * the launcher's `GetCurrentProcess` + `GetProcessTimes`, which is what makes the comparison independent.
 * linux: field 22 of `/proc/<pid>/stat` (scheduler ticks since boot), the same field the launcher reads.
 * Anything else: `UNSUPPORTED`, which the caller turns into `DECLARED`.
 */
export async function observeLiveProcessIdentity(pid: number): Promise<LiveProcessIdentity> {
  const base: LiveProcessIdentity = { status: 'UNSUPPORTED', pid: isPid(pid) ? pid : null, creation_identity: null, created_at: null, mechanism: '', detail: null };
  if (!isPid(pid)) return { ...base, status: 'ERROR', pid: null, mechanism: 'none', detail: 'PID_IS_NOT_A_POSITIVE_SAFE_INTEGER' };

  if (process.platform === 'win32') {
    const mechanism = 'System.Diagnostics.Process.GetProcessById(pid).StartTime.ToUniversalTime().Ticks converted to FILETIME';
    try {
      // Only a validated integer is interpolated; the helper is invoked by absolute path with no shell.
      const result = await execute(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command',
        `try { [Diagnostics.Process]::GetProcessById(${String(pid)}).StartTime.ToUniversalTime().Ticks } catch { 'MISSING' }`],
        { windowsHide: true, timeout: HELPER_TIMEOUT_MS, maxBuffer: 4096 });
      const text = result.stdout.trim();
      if (text === 'MISSING') return { ...base, status: 'NOT_FOUND', mechanism, detail: 'the operating system has no such process' };
      if (!/^\d+$/.test(text)) return { ...base, status: 'ERROR', mechanism, detail: `unexpected helper output: ${text.slice(0, 80)}` };
      const filetime = BigInt(text) - FILETIME_EPOCH_OFFSET_TICKS;
      return { status: 'OBSERVED', pid, creation_identity: filetime.toString(), created_at: filetimeToIso(filetime), mechanism, detail: null };
    } catch (error) {
      return { ...base, status: 'ERROR', mechanism, detail: helperFailure(error) };
    }
  }

  if (process.platform === 'linux') {
    const mechanism = '/proc/<pid>/stat starttime (scheduler ticks since boot), the same field the launcher reads';
    try {
      const stat = await fs.readFile(`/proc/${String(pid)}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const starttime = fields[19];
      if (starttime === undefined || !/^\d+$/.test(starttime)) {
        return { ...base, status: 'ERROR', mechanism, detail: 'starttime field could not be read from /proc' };
      }
      // Not verified on this host (see docs/implementation/BLOCKERS.md: process-execution provenance is a
      // win32-* claim). The value is returned in the launcher's own unit so a match is still a comparison of
      // numbers, never a name, and a platform that cannot say leaves the attach at DECLARED.
      return { status: 'OBSERVED', pid, creation_identity: starttime, created_at: null, mechanism, detail: 'POSIX path unverified on this host' };
    } catch (error) {
      const notFound = (error as NodeJS.ErrnoException).code === 'ENOENT';
      return { ...base, status: notFound ? 'NOT_FOUND' : 'ERROR', mechanism, detail: helperFailure(error) };
    }
  }

  return { ...base, mechanism: 'none', detail: `no live creation identity is implemented for ${process.platform}` };
}

/**
 * Who owns the listening socket on this loopback port, according to the operating system?
 *
 * This is the fact that ties "the endpoint that answered" to "the process the record names": without it a
 * perfectly formed record for some other live process would be enough. Two different owners for one port is
 * reported as ambiguous rather than resolved by picking the first line.
 */
export async function observeListeningProcess(port: number): Promise<LiveListenerOwnership> {
  const valid = Number.isSafeInteger(port) && port >= 1 && port <= 65535;
  const empty: LiveListenerOwnership = { status: 'UNSUPPORTED', pid: null, addresses: [], mechanism: '', detail: null };
  if (!valid) return { ...empty, status: 'ERROR', mechanism: 'none', detail: 'PORT_IS_NOT_A_SAFE_PORT_NUMBER' };

  if (process.platform === 'win32') {
    const mechanism = 'netstat -ano -p TCP, filtered to the requested port';
    try {
      const result = await execute(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/netstat.exe'), ['-ano', '-p', 'TCP'],
        { windowsHide: true, timeout: HELPER_TIMEOUT_MS, maxBuffer: HELPER_OUTPUT_CAP });
      return collectOwner(result.stdout.split(/\r?\n/), line => {
        const match = /^\s*TCP\s+(\S+)\s+(\S+)\s+LISTENING\s+(\d+)\s*$/u.exec(line);
        return match ? { address: match[1]!, pid: Number(match[3]) } : null;
      }, port, mechanism);
    } catch (error) {
      return { ...empty, status: 'ERROR', mechanism, detail: helperFailure(error) };
    }
  }

  if (process.platform === 'linux' || process.platform === 'darwin') {
    const tool = process.platform === 'linux' ? 'ss' : 'lsof';
    const args = process.platform === 'linux' ? ['-ltnP'] : ['-nP', '-iTCP', '-sTCP:LISTEN'];
    const mechanism = `${tool} listening table, filtered to the requested port`;
    try {
      const result = await execute(tool, args, { timeout: HELPER_TIMEOUT_MS, maxBuffer: HELPER_OUTPUT_CAP });
      return collectOwner(result.stdout.split(/\r?\n/), line => {
        const address = /\b(\S+:\d{1,5})\b/u.exec(line)?.[1] ?? null;
        const pid = /\bpid=(\d+)\b/u.exec(line)?.[1] ?? /\s(\d+)\s*$/u.exec(line)?.[1] ?? null;
        return address !== null && pid !== null ? { address, pid: Number(pid) } : null;
      }, port, mechanism);
    } catch (error) {
      // POSIX socket ownership is not verified on this host and needs privileges for other users' processes,
      // so the honest answer is "not observed" and the attach stays DECLARED.
      return { ...empty, status: /win32/.test(process.platform) ? 'ERROR' : 'UNSUPPORTED', mechanism, detail: helperFailure(error) };
    }
  }

  return { ...empty, mechanism: 'none', detail: `no listening-owner observation is implemented for ${process.platform}` };
}

function collectOwner(lines: string[], parse: (line: string) => { address: string; pid: number } | null, port: number, mechanism: string): LiveListenerOwnership {
  const matches = lines.map(parse).filter((entry): entry is { address: string; pid: number } => entry !== null)
    .filter(entry => entry.address.endsWith(`:${String(port)}`));
  const owners = [...new Set(matches.map(entry => entry.pid))];
  if (owners.length === 0) return { status: 'NOT_FOUND', pid: null, addresses: [], mechanism, detail: 'nothing is listening on the bound port' };
  if (owners.length > 1) {
    return { status: 'ERROR', pid: null, addresses: [...new Set(matches.map(entry => entry.address))], mechanism,
      detail: `the port is claimed by more than one process: ${owners.join(', ')}` };
  }
  return { status: 'OBSERVED', pid: owners[0]!, addresses: [...new Set(matches.map(entry => entry.address))], mechanism, detail: null };
}

function helperFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 200);
  return String(error).slice(0, 200);
}

/** What this host can actually promise, so a caller can state its ceiling without trying the OS calls twice. */
export function processObservationCapability(): { platform: string; creation_identity: 'implemented' | 'unimplemented'; listener_ownership: 'implemented' | 'unimplemented' } {
  const implemented = process.platform === 'win32' || process.platform === 'linux';
  return { platform: `${process.platform}-${process.arch}`, creation_identity: implemented ? 'implemented' : 'unimplemented', listener_ownership: process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin' ? 'implemented' : 'unimplemented' };
}
