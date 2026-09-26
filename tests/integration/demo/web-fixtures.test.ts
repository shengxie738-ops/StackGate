import {it,expect,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {existsSync,cpSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// SG-052: the sample front end must genuinely pass with its own legacy mock and genuinely fail
// against the response the FastAPI service produces today, before and after the reviewed fix patch.
// The sample keeps its own workspace and lockfile so its dependencies never enter the core package.
vi.setConfig({testTimeout:600000});

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const demoRoot = path.join(repoRoot, 'examples/contract-drift-demo');
const webRoot = path.join(demoRoot, 'apps/web');
const vitestEntry = path.join(webRoot, 'node_modules/vitest/vitest.mjs');
const patchFile = path.join(demoRoot, 'patches/fix-client-field.patch');
const allowedPatchPaths = ['apps/web/src/api/performance.ts', 'apps/web/tests/performance.test.tsx'];

function isolatedCopy(applyPatch: boolean) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sg052-'));
  const dest = path.join(tmp, 'apps/web');
  cpSync(webRoot, dest, {
    recursive: true,
    filter: source => path.relative(webRoot, source) !== 'node_modules'
      && !source.startsWith(path.join(webRoot, 'node_modules') + path.sep),
  });
  // The sample installs into apps/web; reuse those bytes without copying 110 packages per case.
  symlinkSync(path.join(webRoot, 'node_modules'), path.join(dest, 'node_modules'), 'junction');
  const git = (...args: string[]) => spawnSync('git', ['-C', tmp, ...args], {encoding: 'utf8', windowsHide: true});
  if (git('init', '-q').status !== 0) throw new Error('git init failed in the sample copy');
  git('config', 'user.email', 'fixture@localhost'); git('config', 'user.name', 'fixture');
  git('add', '--', 'apps/web/src', 'apps/web/tests');
  if (git('commit', '-q', '-m', 'broken baseline').status !== 0) throw new Error('baseline commit failed in the sample copy');
  if (applyPatch) {
    const applied = git('apply', patchFile);
    if (applied.status !== 0) throw new Error(`fix patch did not apply: ${applied.stderr}`);
  }
  return {tmp, dest, git};
}

function runSampleTests(dest: string, fixture: 'legacy-mock' | 'target-response') {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, COMSPEC: process.env.COMSPEC,
    TEMP: process.env.TEMP, TMP: process.env.TMP, APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE, NO_COLOR: '1',
    STACKGATE_DEMO_FIXTURE: fixture,
  };
  const result = spawnSync(process.execPath, [vitestEntry, 'run'], {cwd: dest, encoding: 'utf8', windowsHide: true, env});
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '');
  const summary = output.split('\n').find(line => /Tests\s+\d/.test(line))?.trim() ?? '';
  const detail = output.split('\n').filter(line => /Unable to find|expected/.test(line)).map(line => line.trim()).join(' | ');
  return {exit: result.status ?? 3, summary, detail, output: output.slice(0, 600)};
}

it('refuses to claim the sample result when its reviewed dependencies are absent', () => {
  expect(existsSync(vitestEntry), `run pnpm install in ${path.relative(repoRoot, webRoot)} first`).toBe(true);
});

it('lets the broken consumer pass with its own legacy mock and fail against the real response shape', () => {
  const copy = isolatedCopy(false);
  try {
    const withMock = runSampleTests(copy.dest, 'legacy-mock');
    expect(withMock.exit, `${withMock.summary} ${withMock.output}`).toBe(0);
    expect(withMock.summary).toMatch(/5 passed/);
    const withRealShape = runSampleTests(copy.dest, 'target-response');
    expect(withRealShape.exit).not.toBe(0);
    expect(withRealShape.summary).toMatch(/1 failed/);
    expect(withRealShape.detail).toContain('total-return');
  } finally {
    rmSync(copy.tmp, {recursive: true, force: true});
  }
});

it('satisfies the acceptance value after the reviewed patch and keeps the page contract untouched', () => {
  expect(allowedPatchPaths).not.toContain('apps/web/src/pages/PerformancePage.tsx');
  const copy = isolatedCopy(true);
  try {
    const fixed = runSampleTests(copy.dest, 'target-response');
    expect(fixed.exit, `${fixed.summary} ${fixed.output} ${fixed.detail}`).toBe(0);
    expect(fixed.summary).toMatch(/5 passed/);
    const touched = copy.git('diff', '--name-only', '--', 'apps').stdout.trim().split('\n').filter(Boolean);
    expect(touched.length).toBeGreaterThan(0);
    for (const file of touched) expect(allowedPatchPaths, `patch touched ${file}`).toContain(file);
    const pageBytes = spawnSync('git', ['-C', webRoot, 'diff', '--no-index', '--name-only',
      path.join(webRoot, 'src/pages/PerformancePage.tsx'), path.join(copy.dest, 'src/pages/PerformancePage.tsx')],
    {encoding: 'utf8', windowsHide: true});
    expect((pageBytes.stdout ?? '').trim()).toBe('');
  } finally {
    rmSync(copy.tmp, {recursive: true, force: true});
  }
});

it('keeps the declared empty, invalid and transport states green in both client modes', () => {
  for (const applyPatch of [false, true]) {
    const copy = isolatedCopy(applyPatch);
    try {
      const result = runSampleTests(copy.dest, 'legacy-mock');
      expect(result.exit, `${result.summary} ${result.output}`).toBe(0);
      expect(result.summary).toMatch(/5 passed/);
    } finally {
      rmSync(copy.tmp, {recursive: true, force: true});
    }
  }
});
