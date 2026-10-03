import {expect, it, vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {taskProject} from '../../support/task-project.js';

/**
 * V2-R07 exit check for the repair batch. It says nothing about M3 being finished; its whole purpose is to
 * keep "finished" from being asserted. Every case here is a refusal that must stay a refusal: the built CLI
 * preserving a parameter error as exit 64 instead of a silent 0, static analysis still declining to execute
 * the workspace, the stage gate still rejecting M3, and no capability being declared verified without an
 * evidence file that still resolves. Run `pnpm build` first: these cases exercise built output.
 */
const cli = path.resolve('dist/cli.mjs');
const node = process.execPath;
vi.setConfig({testTimeout: 240000});

function runCli(args: string[], root?: string) {
  const argv = root ? [...args, '--root', root, '--json'] : args;
  return spawnSync(node, [cli, ...argv], {encoding: 'utf8', timeout: 120000, windowsHide: true});
}

it('preserves a parameter error as exit 64 in both the envelope and the process', () => {
  // A command line that cannot be parsed at all has no `--json` decision recorded, so the CLI reports on
  // stderr and writes no stdout. What must hold is that the failure reaches the caller intact: exit 64, an
  // empty stdout that cannot be mistaken for a successful envelope, and a diagnostic that names the problem.
  const unknown = runCli(['--made-up']);
  expect(unknown.status, unknown.stderr).toBe(64);
  expect(unknown.stdout.trim(), 'a parameter error must not print a payload that could be parsed as success').toBe('');
  expect(unknown.stderr).toMatch(/Unknown or unsupported command\/arguments/);

  // Once `--json` is understood, the same class of failure carries the machine-readable envelope with the
  // reserved parameter/configuration code, so a caller never has to guess between 0 and 64.
  for (const args of [['gate', '--run', 'nope', '--json'], ['run', '--plan', 'notanid', '--json'],
    ['plan', '--task', 'x.json', '--json'], ['clean', '--run', 'run_x', '--apply', '--json']]) {
    const result = spawnSync(node, [cli, ...args], {encoding: 'utf8', timeout: 120000, windowsHide: true});
    expect(result.status, `${args.join(' ')} -> ${result.stderr}`).toBe(64);
    const lines = result.stdout.trim().split('\n');
    expect(lines, `${args.join(' ')} produced ${lines.length} lines`).toHaveLength(1);
    const envelope = JSON.parse(lines[0]!) as {ok: boolean; exit_code: number};
    expect(envelope.ok, args.join(' ')).toBe(false);
    expect(envelope.exit_code, args.join(' ')).toBe(64);
  }
});

it('keeps scan a static operation that reports NOT_EXECUTED and touches nothing', async () => {
  const repo = await taskProject();
  try {
    const sentinel = path.join(repo.root, 'EXECUTED');
    for (const workspace of Object.values(repo.config.workspaces) as {path: string}[]) {
      const dir = path.join(repo.root, workspace.path);
      await fs.mkdir(dir, {recursive: true});
      await fs.writeFile(path.join(dir, 'evil.js'), `require('fs').writeFileSync(${JSON.stringify(sentinel)},'bad');`);
    }
    for (const command of Object.values(repo.config.commands) as {exec: string; args: string[]}[]) {
      command.exec = node;
      command.args = ['evil.js'];
    }
    await fs.writeFile(path.join(repo.root, '.stackgate.yaml'), JSON.stringify(repo.config));
    const scan = runCli(['scan', '--base', 'HEAD'], repo.root);
    expect(scan.status, scan.stderr).toBe(0);
    const lines = scan.stdout.trim().split('\n');
    expect(lines, 'the CLI reports on one line so a caller cannot be misled by interleaved output').toHaveLength(1);
    const report = JSON.parse(lines[0]!);
    expect(report.runtime).toBe('NOT_EXECUTED');
    expect(report).not.toHaveProperty('decision');
    expect(report.data.candidate_export).toBe('NOT_EXECUTED');
    await expect(fs.access(sentinel)).rejects.toThrow();
  } finally {
    await repo.cleanup();
  }
});

it('refuses to certify an M3 stage exit and rejects a malformed stage request', () => {
  const stage = path.resolve('scripts/verify-stage.mjs');
  const m3 = spawnSync(node, [stage, '--stage', 'M3'], {encoding: 'utf8', timeout: 120000, windowsHide: true});
  expect(m3.status).toBe(2);
  expect(`${m3.stdout}${m3.stderr}`).toMatch(/M3/);
  // An unrequested or malformed request is a parameter error (64), which is a different fact from "this
  // stage is registered but its checks have never run" (2). Neither can be turned into an exit 0.
  const refused = spawnSync(node, [stage, '--stage', 'M7'], {encoding: 'utf8', timeout: 120000, windowsHide: true});
  expect(refused.status).toBe(2);
  for (const args of [['--stage'], ['--stage', 'M3', '--stage', 'M2'], [] as string[], ['M2']]) {
    const attempt = spawnSync(node, [stage, ...args], {encoding: 'utf8', timeout: 120000, windowsHide: true});
    expect(attempt.status, `${args.join(' ')} -> ${attempt.stdout}${attempt.stderr}`).toBe(64);
  }
});

it('builds both public entrypoints instead of silently skipping the reporter', async () => {
  const built = await Promise.all([cli, path.resolve('dist/playwright-reporter.mjs')]
    .map(file => fs.stat(file).then(stat => stat.size).catch(() => 0)));
  expect(built[0], 'dist/cli.mjs is missing; run pnpm build').toBeGreaterThan(0);
  expect(built[1], 'dist/playwright-reporter.mjs is missing; the entry was skipped on ENOENT').toBeGreaterThan(0);
  const loaded = runCli(['--version']);
  expect(loaded.status).toBe(0);
  expect(loaded.stdout.trim()).not.toBe('');
});

it('grants no verified capability to a tool that cites no surviving evidence', async () => {
  const lock = JSON.parse(await fs.readFile(path.resolve('tools/compatibility-lock.json'), 'utf8')) as {
    tools?: {name: string; status: string; version: string | null; tested_capabilities: string[];
      evidence_refs?: string[]; verified_at: string | null; reason?: string}[];
  };
  const entries = lock.tools ?? [];
  expect(entries.length).toBeGreaterThan(0);
  const unsupported: string[] = [];
  for (const entry of entries) {
    if (entry.status !== 'VERIFIED') {
      // Anything not verified must say why, rather than sitting there as an unexplained gap.
      if (!entry.reason) unsupported.push(`${entry.name}: ${entry.status} without a reason`);
      continue;
    }
    if (!entry.version || !entry.verified_at) unsupported.push(`${entry.name}: VERIFIED without version or timestamp`);
    const refs = entry.evidence_refs ?? [];
    if (!refs.length) unsupported.push(`${entry.name}: VERIFIED without evidence references`);
    for (const ref of refs) {
      if (path.isAbsolute(ref) || ref.split(/[\\/]/).includes('..')) {
        unsupported.push(`${entry.name}: evidence reference is not a repository-relative path: ${ref}`);
        continue;
      }
      // A declaration that points at deleted evidence is a stale support claim, not a verified one.
      await fs.stat(path.resolve(ref)).then(() => undefined, () => unsupported.push(`${entry.name}: missing evidence ${ref}`));
    }
  }
  expect(unsupported, unsupported.join('\n')).toEqual([]);
});
