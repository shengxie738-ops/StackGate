import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Diagnostic } from '../../contracts/src/diagnostic.js';
import { canonicalJson } from '../../core/src/storage/canonical-json.js';
import { hashBytes } from '../../core/src/storage/hash.js';
import { parseStrictDocument } from '../../core/src/services/strict-document.js';
import { getContractSnapshot, loadContract } from './load-contract.js';
import type { LoadedContract } from './load-contract.js';
import { inspectSupportedSchema } from './supported-schema.js';
import { parseBreakingResult } from './breaking.js';
import { parseDiffResult } from './diff.js';
import type { CompatibilityFinding } from './normalize-findings.js';
export type { CompatibilityFinding } from './normalize-findings.js';
export interface TrustedOasdiffOptions {
  /** Reviewed application analysis-tool capability (pinned deployment identity), independent of business-command grants. Never read from candidate config/contracts or PATH. */
  trusted: boolean;
  executable: string;
  expected_sha256: string;
  expected_version: string;
  temp_root?: string;
  timeout_ms?: number;
  max_output_bytes?: number;
}
export interface ToolEvidence {
  command: 'version' | 'breaking' | 'diff';
  argv: string[];
  stdout: string;
  stderr: string;
  exit_code: number | null;
  signal: string | null;
  version: string;
  executable_sha256: string;
  base_hash?: string;
  target_hash?: string;
  audited_base_hash?: string;
  audited_target_hash?: string;
  interrupted?: 'timeout' | 'output-limit' | 'spawn-error';
}
export interface ContractToolResult<T> { status: 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR'; value: T | null; diagnostics: Diagnostic[]; evidence: ToolEvidence[] }
export function toolDiagnostic(code: Diagnostic['code'], message: string): Diagnostic {
  return { code, rule_id: 'SG-TOOL-OASDIFF', message, location: '', observed_facts: {}, recommended_action: 'Preserve raw tool evidence and use the reviewed pinned executable and supported contract subset.', source: 'oasdiff' };
}
export function parseToolJson(stdout: string): unknown {
  // JSON grammar first; duplicate-key and bounded traversal checks second.
  JSON.parse(stdout);
  return parseStrictDocument(Buffer.from(stdout), 'oasdiff-output', { maxBytes: 16 * 1024 * 1024, maxDepth: 128 });
}

export class OasdiffAdapter {
  readonly options: Readonly<TrustedOasdiffOptions>;
  constructor(options: TrustedOasdiffOptions) { this.options = Object.freeze({ ...options }); }
  breaking(base: LoadedContract, target: LoadedContract, operationScope?: readonly string[]): Promise<ContractToolResult<CompatibilityFinding[]>> { return this.compare('breaking', base, target, operationScope, parseBreakingResult); }
  diff(base: LoadedContract, target: LoadedContract, operationScope?: readonly string[]): Promise<ContractToolResult<Record<string, unknown>>> { return this.compare('diff', base, target, operationScope, parseDiffResult); }
  private async compare<T>(command: 'breaking' | 'diff', base: LoadedContract, target: LoadedContract, scope: readonly string[] | undefined, parse: (evidence: ToolEvidence) => ContractToolResult<T>): Promise<ContractToolResult<T>> {
    const evidence: ToolEvidence[] = [];
    const fail = (status: 'BLOCKED' | 'ERROR', code: Diagnostic['code'], message: string, diagnostics?: Diagnostic[]): ContractToolResult<T> => ({ status, value: null, diagnostics: diagnostics ?? [toolDiagnostic(code, message)], evidence });
    let workingDirectory: string | undefined;
    let parentDirectory: string | undefined;
    let result: ContractToolResult<T>;
    try {
      // Treat LoadedContract as untrusted mutable data. Clone/serialize/reload before executing anything.
      if (!base.supported || !target.supported || !base.document || !target.document) return fail('BLOCKED', 'UNSUPPORTED_SCHEMA', 'Contract loader did not approve these inputs', [...base.diagnostics, ...target.diagnostics]);
      const baseBytes = Buffer.from(canonicalJson(base.document)), targetBytes = Buffer.from(canonicalJson(target.document));
      const auditedBase = loadContract(baseBytes, base.source), auditedTarget = loadContract(targetBytes, target.source);
      const preflight = [inspectSupportedSchema(auditedBase, scope), inspectSupportedSchema(auditedTarget, scope)];
      if (preflight.some((item) => !item.supported)) return fail('BLOCKED', 'UNSUPPORTED_SCHEMA', 'Unsupported contract', preflight.flatMap((item) => item.diagnostics));
      const baseSnapshot = getContractSnapshot(base), targetSnapshot = getContractSnapshot(target);
      if (!baseSnapshot || !targetSnapshot) return fail('BLOCKED', 'INPUT_STALE', 'Loaded contract or raw hash changed after source validation; load the original bytes again');
      if (!this.options.trusted) return fail('BLOCKED', 'EXECUTION_UNTRUSTED', 'Explicit trusted executable identity is required');
      const expectedHash = this.options.expected_sha256.replace(/^sha256:/, '');
      if (!path.isAbsolute(this.options.executable) || !/^[a-f0-9]{64}$/.test(expectedHash) || !/^\d+\.\d+\.\d+$/.test(this.options.expected_version) || /\.(cmd|bat|ps1|js|mjs)$/i.test(this.options.executable)) return fail('ERROR', 'EXECUTION_UNTRUSTED', 'Invalid trusted tool identity');
      const timeout = this.options.timeout_ms ?? 10000, outputLimit = this.options.max_output_bytes ?? 4 * 1024 * 1024;
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000 || !Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 16 * 1024 * 1024) return fail('ERROR', 'CONFIG_INVALID', 'Invalid tool resource bounds');
      const verifyIdentity = async () => {
        const stat = await lstat(this.options.executable);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 150 * 1024 * 1024 || hashBytes(await readFile(this.options.executable)) !== expectedHash) throw new Error('Oasdiff executable identity mismatch');
      };
      try { await verifyIdentity(); } catch (error) {
        return fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'BLOCKED' : 'ERROR', 'UNSUPPORTED_CAPABILITY', 'Pinned oasdiff executable missing, changed, linked, or unreadable');
      }
      if (this.options.temp_root && !path.isAbsolute(this.options.temp_root)) return fail('ERROR', 'CONFIG_INVALID', 'Temporary root must be absolute');
      parentDirectory = await realpath(this.options.temp_root ?? tmpdir());
      workingDirectory = await mkdtemp(path.join(parentDirectory, 'stackgate-oasdiff-'));
      const config = path.join(workingDirectory, 'oasdiff-config.json');
      const baseFile = path.join(workingDirectory, 'base.json'), targetFile = path.join(workingDirectory, 'target.json');
      await writeFile(config, '{}\n', { flag: 'wx', mode: 0o600 });
      await writeFile(baseFile, baseBytes, { flag: 'wx', mode: 0o600 });
      await writeFile(targetFile, targetBytes, { flag: 'wx', mode: 0o600 });
      await mkdir(path.join(workingDirectory, 'home'));
      const env: NodeJS.ProcessEnv = { PATH: '', HOME: path.join(workingDirectory, 'home'), USERPROFILE: path.join(workingDirectory, 'home'), TEMP: workingDirectory, TMP: workingDirectory, OASDIFF_CONFIG: config };
      for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
      const invoke = async (kind: ToolEvidence['command'], argv: string[]): Promise<ToolEvidence> => {
        await verifyIdentity();
        const observation: ToolEvidence = { command: kind, argv, stdout: '', stderr: '', exit_code: null, signal: null, version: this.options.expected_version, executable_sha256: `sha256:${expectedHash}` };
        evidence.push(observation);
        await new Promise<void>((resolve) => {
          const child = spawn(this.options.executable, argv, { cwd: workingDirectory!, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          let size = 0;
          const chunks: Record<'stdout' | 'stderr', Buffer[]> = { stdout: [], stderr: [] };
          const timer = setTimeout(() => { observation.interrupted = 'timeout'; child.kill(); }, timeout);
          const append = (field: 'stdout' | 'stderr', chunk: Buffer) => {
            if (observation.interrupted) return;
            const remaining = outputLimit - size; size += chunk.length;
            chunks[field].push(chunk.subarray(0, Math.max(0, remaining)));
            if (size > outputLimit) { observation.interrupted = 'output-limit'; child.kill(); }
          };
          child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
          child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
          child.on('error', () => { observation.interrupted = 'spawn-error'; });
          child.on('close', (exitCode, signal) => { clearTimeout(timer); observation.stdout = Buffer.concat(chunks.stdout).toString('utf8'); observation.stderr = Buffer.concat(chunks.stderr).toString('utf8'); observation.exit_code = exitCode; observation.signal = signal; resolve(); });
        });
        return observation;
      };
      const version = await invoke('version', ['--version']);
      version.version = /^oasdiff version (\S+)$/.exec(version.stdout.trim())?.[1] ?? '';
      if (version.interrupted || version.exit_code !== 0 || version.stderr || version.stdout.trim() !== `oasdiff version ${this.options.expected_version}` || this.options.expected_version !== '1.32.1') result = fail('BLOCKED', 'UNSUPPORTED_CAPABILITY', 'Real tool version differs from the tested 1.32.1 contract');
      else {
        const argv = [command, baseFile, targetFile, '--format', 'json', '--allow-external-refs=false', '--config', config, '--include-path-params', '--auto-upgrade=false', '--flatten-allof=false', '--flatten-params=false', ...(command === 'breaking' ? ['--fail-on', 'WARN'] : ['--fail-on-diff'])];
        const observation = await invoke(command, argv);
        observation.base_hash = baseSnapshot.raw_hash; observation.target_hash = targetSnapshot.raw_hash;
        observation.audited_base_hash = auditedBase.raw_hash; observation.audited_target_hash = auditedTarget.raw_hash;
        result = observation.interrupted ? fail('ERROR', 'ARTIFACT_BUDGET_EXCEEDED', `Tool ${observation.interrupted}`) : { ...parse(observation), evidence };
      }
    } catch (error) {
      // Native error messages include host paths; only a stable code belongs in public diagnostics.
      result = fail('ERROR', 'REPORT_INVALID', 'Oasdiff adapter could not complete the reviewed local tool operation');
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) result.diagnostics[0]!.observed_facts.system_error_code = code;
    }
    finally {
      if (workingDirectory && parentDirectory) {
        const relative = path.relative(parentDirectory, workingDirectory);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(workingDirectory).startsWith('stackgate-oasdiff-')) result = fail('ERROR', 'RESOURCE_OWNERSHIP_UNVERIFIED', 'Temporary directory ownership could not be confirmed');
        else try { await rm(workingDirectory, { recursive: true, force: true }); } catch { result = fail('ERROR', 'RESOURCE_OWNERSHIP_UNVERIFIED', 'Could not clean owned tool temporary files'); }
      }
    }
    return result!;
  }
}
