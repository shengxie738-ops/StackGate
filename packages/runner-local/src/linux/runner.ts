import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import type {Diagnostic} from '../../../contracts/src/index.js';
import type {RunnerPort, RunnerResult, ProcessIdentity, ResolvedCommand, OutputRetention} from '../../../core/src/ports/runner.js';
import {hashBytes} from '../../../core/src/storage/hash.js';
import {RedactionStream} from '../../../core/src/evidence/redaction.js';
import {EvidenceBudget} from '../../../core/src/evidence/budget.js';
import {CGROUP_MECHANISM, createRunSubtree, detectCgroupDelegation, isNamespaceName, readCreationIdentity, readMembers, reclaimSubtree, type ReclaimReport} from './cgroup.js';
import {readLinuxRunnerProvenance} from './provenance.js';

const PASS_THROUGH_KEYS = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'COMSPEC', 'PATHEXT', 'STACKGATE_RUN_ID', 'STACKGATE_CHECK_ID', 'STACKGATE_ATTEMPT_ID', 'STACKGATE_OUTPUT_DIR', 'STACKGATE_ALLOWED_ORIGINS'];

function diagnostic(code: Diagnostic['code'], message: string, observed_facts: Record<string, unknown> = {}): Diagnostic {
  return {code, rule_id: 'SG-RUNTIME-PROCESS', message, source: 'linux-runner', location: '', observed_facts, recommended_action: 'Preserve the run cgroup evidence and review the delegated subtree of the host.'};
}

function unsafe(command: ResolvedCommand): string | null {
  if (!path.isAbsolute(command.identity.executable) || command.identity.executable.includes('\0')) return 'executable';
  if (!path.isAbsolute(command.cwd)) return 'cwd';
  if (!Number.isSafeInteger(command.timeout_ms) || command.timeout_ms < 1 || command.timeout_ms > 86_400_000) return 'timeout_ms';
  for (const value of command.args) if (value.includes('\0')) return 'argv';
  for (const [key, value] of Object.entries(command.environment)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes('\0')) return `environment:${key}`;
  return null;
}

async function review(command: ResolvedCommand): Promise<void> {
  for (const file of [{path: command.identity.executable, digest: command.identity.digest}, ...command.verified_inputs ?? []]) {
    const stat = await fs.lstat(file.path);
    if (!path.isAbsolute(file.path) || !stat.isFile() || stat.isSymbolicLink() || stat.size > 150 * 1024 * 1024 || hashBytes(await fs.readFile(file.path)) !== file.digest) throw new Error('Resolved input identity changed');
  }
}

/**
 * Every process this runner starts is placed in a cgroup it created itself and joins before it can fork,
 * so reclaim covers descendants the target detached on purpose. Nothing is ever keyed off a pid alone: a
 * persisted pid is not authority, and neither is a name that a later process may have been given.
 */
export class LinuxRunner implements RunnerPort {
  constructor(readonly options: {max_output_bytes?: number; reclaim_deadline_ms?: number} = {}) {}

  async run(command: ResolvedCommand, context: Parameters<RunnerPort['run']>[1]): Promise<RunnerResult> {
    command = structuredClone(command);
    const diagnostics: Diagnostic[] = [];
    let identity: ProcessIdentity | null = null;
    let mechanism: string = 'UNSUPPORTED', cleanup: 'VERIFIED' | 'UNVERIFIED' = 'UNVERIFIED';
    let original = 0, retained = 0;
    let outputReason: NonNullable<RunnerResult['output']>['reason'] = null;
    const counts: Record<'stdout' | 'stderr', OutputRetention> = {stdout: {original_bytes: 0, retained_bytes: 0, truncated: false, reason: null}, stderr: {original_bytes: 0, retained_bytes: 0, truncated: false, reason: null}};
    const result = (status: RunnerResult['status'], exit: number | null = null, signal: string | null = null): RunnerResult => ({
      status, raw_exit_code: exit, signal, process: identity, artifacts: [], diagnostics,
      output: {original_bytes: original, retained_bytes: retained, truncated: outputReason !== null, reason: outputReason, streams: counts},
      provenance: {mechanism, cleanup},
      execution: {command_id: command.command_id, command_hash: command.command_hash, authorization_hash: command.authorization_hash, executable_digest: command.identity.digest},
    });
    if (context.signal.aborted) {
      cleanup = 'VERIFIED';
      return result('CANCELED');
    }
    const limit = this.options.max_output_bytes ?? 4 * 1024 * 1024;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 * 1024 * 1024) {
      diagnostics.push(diagnostic('CONFIG_INVALID', 'Invalid runner output budget'));
      return result('ERROR');
    }
    const problem = unsafe(command);
    if (problem !== null) {
      diagnostics.push(diagnostic('EXECUTION_UNTRUSTED', 'Reviewed command is not safe to launch as a fixed argv', {field: problem}));
      return result('ERROR');
    }
    if (!isNamespaceName(context.run_id)) {
      diagnostics.push(diagnostic('CONFIG_INVALID', 'Run id cannot name a private cgroup subtree', {run_id: context.run_id}));
      return result('ERROR');
    }
    try {
      await review(command);
    } catch {
      diagnostics.push(diagnostic('EXECUTION_UNTRUSTED', 'Executable or reviewed input identity is missing, unsafe or changed'));
      return result('ERROR');
    }
    const provenance = await readLinuxRunnerProvenance();
    if (provenance.status !== 'AVAILABLE' || provenance.launcher === null) {
      diagnostics.push(diagnostic('UNSUPPORTED_CAPABILITY', 'Owned process launcher is unavailable', {reason: provenance.reason}));
      return result('ERROR');
    }
    const delegation = await detectCgroupDelegation({launcher: provenance.launcher});
    if (delegation.status !== 'DELEGATED' || delegation.run_root === null) {
      diagnostics.push(diagnostic('UNSUPPORTED_CAPABILITY', 'No delegated cgroup v2 subtree can own this run, so no cleanup would be provable', {status: delegation.status, reasons: delegation.reasons, observed: delegation.observed}));
      return result('ERROR');
    }
    mechanism = CGROUP_MECHANISM;
    let scratch: string | undefined, child: ChildProcess | undefined, stop: 'TIMED_OUT' | 'CANCELED' | 'ERROR' | undefined;
    let subtree: {directory: string; token: string} | undefined, reclaiming: Promise<ReclaimReport> | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (cause: typeof stop): void => {
      stop ??= cause;
      if (reclaiming !== null || subtree === undefined) return;
      reclaiming = reclaimSubtree(subtree.directory, this.options.reclaim_deadline_ms ?? 5000);
    };
    const aborted = (): void => terminate('CANCELED');
    context.signal.addEventListener('abort', aborted, {once: true});
    try {
      scratch = await fs.mkdtemp('/tmp/stackgate-run-');
      subtree = await createRunSubtree(delegation.run_root, context.run_id);
      const members = path.posix.join(subtree.directory, 'cgroup.procs');
      const statusFile = path.join(scratch, 'started.txt');
      child = spawn('/bin/sh', [provenance.launcher, members, statusFile, command.identity.executable, ...command.args], {cwd: command.cwd, env: {...command.environment}, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
      const launchedPid = child?.pid ?? 0;
      let attachState: 'NO_PID' | 'NOT_OBSERVED' | 'LAUNCHER_REFUSED' | 'ATTACHED' = launchedPid === 0 ? 'NO_PID' : 'NOT_OBSERVED';
      for (let attempt = 0; attempt < 250 && launchedPid > 0; attempt++) {
        const text = await fs.readFile(statusFile, 'utf8').catch(() => null);
        if (text !== null && text.startsWith('ATTACH_FAILED')) {
          attachState = 'LAUNCHER_REFUSED';
          break;
        }
        if (text !== null && text.startsWith('ATTACHED') && (await readMembers(subtree.directory)).includes(launchedPid)) {
          attachState = 'ATTACHED';
          break;
        }
        if (child !== undefined && (child.exitCode !== null || child.signalCode !== null)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (attachState !== 'ATTACHED') {
        diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED', 'The launched process never joined the run cgroup, so it is not ours to claim or reclaim', {observed: attachState, status_file: await fs.readFile(statusFile, 'utf8').catch(() => null)}));
        // The process is outside the subtree we own, so only the handle we created can end it.
        child?.kill('SIGKILL');
        terminate('ERROR');
        const report = await reclaiming!;
        cleanup = report.cleanup;
        return result('ERROR');
      }
      const creation = await readCreationIdentity(launchedPid);
      if (creation === null) {
        diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED', 'Process creation identity could not be read, so attribution would be unprovable', {pid: launchedPid}));
        terminate('ERROR');
        const report = await reclaimSubtree(subtree.directory, this.options.reclaim_deadline_ms ?? 5000);
        cleanup = report.cleanup;
        return result('ERROR');
      }
      identity = {pid: launchedPid, creation_identity: creation, owner_token: subtree.token};
      timer = setTimeout(() => terminate('TIMED_OUT'), command.timeout_ms);
      const secrets = Object.entries(command.environment).filter(([key]) => !PASS_THROUGH_KEYS.includes(key.toUpperCase())).map(([, value]) => value);
      const streams = {stdout: new RedactionStream(secrets), stderr: new RedactionStream(secrets)};
      const budget = new EvidenceBudget({totalBytes: limit, reservedCriticalBytes: 0});
      const active = child;
      const closed = new Promise<{exit: number | null; signal: string | null}>(resolve => {
        active.once('error', () => {
          diagnostics.push(diagnostic('TOOL_FAILURE', 'Process could not be started'));
          terminate('ERROR');
        });
        active.once('close', (exit, signal) => resolve({exit, signal}));
      });
      if (context.signal.aborted) aborted();
      const consume = async (stream: 'stdout' | 'stderr') => {
        const source = active[stream]!;
        const deliver = async (bytes: Uint8Array) => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([context[stream](bytes), new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => reject(new Error('Output callback deadline')), 5000);
            })]);
          } finally {
            clearTimeout(timeout);
          }
        };
        const retain = async (text: string) => {
          const kept = budget.retain(Buffer.from(text), false).bytes;
          if (kept.length) await deliver(kept);
          retained += kept.length;
          counts[stream].retained_bytes += kept.length;
          return kept.length < Buffer.byteLength(text);
        };
        const exceeded = (budgetExceeded: boolean) => {
          const reason = budgetExceeded ? 'ARTIFACT_BUDGET_EXCEEDED' : 'REDACTION_LINE_LIMIT';
          outputReason = reason;
          counts[stream].truncated = true;
          counts[stream].reason = reason;
          if (!diagnostics.some(item => item.code === 'ARTIFACT_BUDGET_EXCEEDED')) diagnostics.push(diagnostic('ARTIFACT_BUDGET_EXCEEDED', 'Process output exceeded the retained evidence budget'));
          terminate('ERROR');
        };
        try {
          for await (const chunk of source) {
            original += chunk.length;
            counts[stream].original_bytes += chunk.length;
            const text = streams[stream].push(chunk), clipped = await retain(text);
            if (original > limit || clipped || streams[stream].retention().truncated) exceeded(original > limit || clipped);
          }
          const clipped = await retain(streams[stream].finish());
          if (clipped || streams[stream].retention().truncated) exceeded(clipped);
        } catch {
          diagnostics.push(diagnostic('TOOL_FAILURE', 'Output stream or evidence callback failed'));
          terminate('ERROR');
        }
      };
      const [observed] = await Promise.all([closed, consume('stdout'), consume('stderr')]);
      clearTimeout(timer);
      const report = await (reclaiming ??= reclaimSubtree(subtree.directory, this.options.reclaim_deadline_ms ?? 5000));
      cleanup = report.cleanup;
      if (report.members_after.length > 0) {
        diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED', 'Processes remained in the run cgroup after the reclaim deadline', {leftover_directory: subtree.directory, members: report.members_after, method: report.method, froze: report.froze}));
        return result('ERROR');
      }
      if (report.cleanup !== 'VERIFIED') {
        diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED', 'The run cgroup could not be removed after its member set emptied', {reason: report.rmdir_reason, rounds: report.rounds}));
        return result('ERROR');
      }
      return result(stop ?? 'EXITED', stop ? null : observed.exit, observed.signal);
    } catch {
      diagnostics.push(diagnostic('TOOL_FAILURE', 'Linux runner could not complete the reviewed operation'));
      if (subtree) {
        const report = await (reclaiming ??= reclaimSubtree(subtree.directory, this.options.reclaim_deadline_ms ?? 5000));
        cleanup = report.cleanup;
      }
      return result('ERROR');
    } finally {
      context.signal.removeEventListener('abort', aborted);
      clearTimeout(timer);
      if (scratch) {
        try {
          const stat = await fs.lstat(scratch);
          if (!scratch.startsWith('/tmp/stackgate-run-') || stat.isSymbolicLink()) throw new Error('Changed owner');
          await fs.rm(scratch, {recursive: true, force: true});
        } catch {
          diagnostics.push(diagnostic('RESOURCE_OWNERSHIP_UNVERIFIED', 'Launcher scratch directory ownership could not be verified'));
        }
      }
    }
  }
}
