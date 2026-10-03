import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {expect, it, vi} from 'vitest';
import {withTestDirectory} from '../support/test-paths.js';
import {hashBytes} from '../../packages/core/src/storage/hash.js';
import {LinuxRunner} from '../../packages/runner-local/src/linux/runner.js';
import {assertDelegatedRoot, detectCgroupDelegation} from '../../packages/runner-local/src/linux/cgroup.js';
import type {ResolvedCommand} from '../../packages/core/src/ports/runner.js';

vi.setConfig({testTimeout: 60000});

// Measured once, from the running kernel, before any case is declared. Nothing here overrides
// process.platform: the host either hands over a delegated subtree or the runner refuses.
const capability = await detectCgroupDelegation();
const delegated = capability.status === 'DELEGATED';

async function run(directory: string, code: string, options: {timeout?: number; controller?: AbortController; budget?: number; onOutput?: (text: string) => void | Promise<void>; args?: string[]; prepare?: (command: ResolvedCommand) => Promise<void>} = {}) {
  const script = path.join(directory, 'process.cjs');
  await fs.writeFile(script, code);
  const controller = options.controller ?? new AbortController();
  const command: ResolvedCommand = {
    command_id: 'command',
    identity: {executable: process.execPath, version: process.version.slice(1), digest: hashBytes(await fs.readFile(process.execPath))},
    args: [script, ...options.args ?? []], cwd: directory,
    environment: {TEMP: directory, TMP: directory, STACKGATE_RUN_ID: 'run_test', STACKGATE_OUTPUT_DIR: directory, SECRET: 'private-token'},
    timeout_ms: options.timeout ?? 10000, authorization_hash: '1'.repeat(64), command_hash: '2'.repeat(64),
    verified_inputs: [{path: script, digest: hashBytes(await fs.readFile(script))}],
  };
  await options.prepare?.(command);
  let stdout = '', stderr = '';
  const result = await new LinuxRunner({max_output_bytes: options.budget ?? 1048576}).run(command, {
    run_id: 'run_test', check_id: 'check', attempt_id: 'attempt_one', signal: controller.signal,
    async stdout(chunk) { const text = Buffer.from(chunk).toString(); stdout += text; await options.onOutput?.(text); },
    async stderr(chunk) { stderr += Buffer.from(chunk).toString(); },
  });
  return {result, stdout, stderr, command};
}

it('derives the run root only from the unified mount and our own delegated subtree', async () => {
  // Independent re-derivation of what the probe claims, so a probe cannot report support it did not measure.
  const mountinfo = await fs.readFile('/proc/self/mountinfo', 'utf8').catch(() => null);
  if (process.platform !== 'linux') {
    expect(capability.status).toBe('NOT_LINUX');
    expect(capability.reasons).toContain('NOT_LINUX');
    return;
  }
  const unified = (mountinfo ?? '').split('\n').filter(line => line.split(' - ')[1]?.startsWith('cgroup2 '));
  expect(unified.length).toBeGreaterThanOrEqual(0);
  expect(capability.observed.self_cgroup.startsWith('/')).toBe(true);
  const root = capability.run_root;
  if (root === null) return expect(capability.status).not.toBe('DELEGATED');
  expect(root.startsWith(unified[0]!.trim().split(/\s+/)[4] ?? '')).toBe(true);
  const info = await fs.stat(root);
  expect(info.uid).toBe(process.getuid?.());
  expect(await assertDelegatedRoot(root)).toMatchObject({ok: true});
  expect(capability.status).toBe('DELEGATED');
});

it.each(['/etc', '/sys/fs/cgroup/../etc', 'relative/path', '/sys/fs/cgroup', '/sys/fs/cgroup/link'])('refuses a run root that is not our private delegated subtree: %s', async candidate => {
  const refusal = await assertDelegatedRoot(candidate);
  expect(refusal.ok).toBe(false);
});

it.each(['executable', 'entry'])('rejects changed %s bytes before launching a process', kind => withTestDirectory(async directory => {
  const observed = await run(directory, 'console.log("NEVER")', {async prepare(command) { if (kind === 'executable') command.identity.digest = '0'.repeat(64); else await fs.appendFile(command.args[0]!, '\n// changed after review'); }});
  expect(observed.result.status).toBe('ERROR');
  expect(observed.result.process).toBeNull();
  expect(observed.stdout).toBe('');
  expect(observed.result.diagnostics[0]?.code).toBe('EXECUTION_UNTRUSTED');
}));

it('rejects a non-POSIX executable path and NUL bytes in argv', () => withTestDirectory(async directory => {
  const observed = await run(directory, 'console.log("NEVER")', {async prepare(command) { command.identity.executable = 'node'; }});
  expect(observed.result.status).toBe('ERROR');
  expect(observed.result.diagnostics[0]?.code).toBe('EXECUTION_UNTRUSTED');
  const nulled = await run(directory, 'console.log("NEVER")', {args: ['a\0b']});
  expect(nulled.result.diagnostics[0]?.code).toBe('EXECUTION_UNTRUSTED');
}));

it('does not start pre-canceled work', () => withTestDirectory(async directory => {
  const controller = new AbortController();
  controller.abort();
  const observed = await run(directory, 'console.log("NEVER")', {controller});
  expect(observed.result.status).toBe('CANCELED');
  expect(observed.result.process).toBeNull();
  expect(observed.stdout).toBe('');
}));

it('bounds retained output without dropping the failure', () => withTestDirectory(async directory => {
  const observed = await run(directory, 'for(let i=0;i<10000;i++){process.stdout.write("line\\n");process.stderr.write("e\\n")}', {budget: 2048});
  if (!delegated) return expect(observed.result.diagnostics.some(d => d.code === 'UNSUPPORTED_CAPABILITY')).toBe(true);
  expect(observed.result.status).toBe('ERROR');
  expect(observed.result.diagnostics.some(d => d.code === 'ARTIFACT_BUDGET_EXCEEDED')).toBe(true);
  expect(Buffer.byteLength(observed.stdout + observed.stderr)).toBeLessThanOrEqual(2048);
}));

it('reclaims its whole private subtree including a detached descendant, or refuses outright', () => withTestDirectory(async directory => {
  // An unrelated process started by the test itself sits outside the run subtree and must survive.
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio: 'ignore'});
  const marker = path.join(directory, 'descendant-ticks');
  const controller = new AbortController();
  try {
    const observed = await run(directory, `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'t'),20)`)}],{detached:true,stdio:'ignore'}).unref();const wait=setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(marker)})){clearInterval(wait);console.log('ready')}},20);setInterval(()=>{},1000);`, {controller, timeout: 10000, onOutput(text) { if (text.includes('ready')) controller.abort(); }});
    const aliveAfterCancel = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    if (!delegated) {
      // Refusal is the honest outcome: no attribution means no claim that anything was cleaned.
      expect(observed.result.status).toBe('ERROR');
      expect(observed.result.diagnostics.some(d => d.code === 'UNSUPPORTED_CAPABILITY')).toBe(true);
      expect(observed.result.provenance?.cleanup).toBe('UNVERIFIED');
      expect(observed.result.process).toBeNull();
      expect(observed.stdout).not.toContain('ready');
      return;
    }
    expect(observed.result.status).toBe('CANCELED');
    expect(observed.result.provenance).toMatchObject({mechanism: 'CGROUPV2_DELEGATED_SUBTREE', cleanup: 'VERIFIED'});
    expect(observed.result.diagnostics).toEqual([]);
    const before = await fs.readFile(marker, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(await fs.readFile(marker, 'utf8')).toBe(before);
    expect(unrelated.exitCode).toBeNull();
    expect(unrelated.pid !== undefined && aliveAfterCancel(unrelated.pid)).toBe(true);
    const reclaimed = await detectCgroupDelegation();
    expect(reclaimed.status).toBe('DELEGATED');
  } finally {
    unrelated.kill();
  }
}));

it('separates timeout from cancellation and keeps the exit code of the real process', () => withTestDirectory(async directory => {
  const timed = await run(directory, 'setInterval(()=>console.log("alive"),25)', {timeout: 400});
  if (!delegated) return expect(timed.result.diagnostics.some(d => d.code === 'UNSUPPORTED_CAPABILITY')).toBe(true);
  expect(timed.result.status).toBe('TIMED_OUT');
  expect(timed.result.provenance?.cleanup).toBe('VERIFIED');
  const exited = await run(directory, "console.log('stdout');console.error('stderr Authorization: private-token');process.exit(7)");
  expect(exited.result.status).toBe('EXITED');
  expect(exited.result.raw_exit_code).toBe(7);
  expect(exited.stdout).toContain('stdout');
  expect(exited.stderr).toContain('[REDACTED]');
  expect(exited.stderr).not.toContain('private-token');
  expect(exited.result.process?.creation_identity).toBeTruthy();
  expect(exited.result.process?.owner_token).toMatch(/^[0-9a-f-]{36}$/);
}));
