import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
it('build emits reusable TypeScript declarations for the shared contracts', () => {
  expect(existsSync('dist/types/packages/contracts/src/index.d.ts')).toBe(true);
});

it('built help is executable without a TypeScript runtime', () => {
  const result = spawnSync(process.execPath, ['dist/cli.mjs', '--help'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('--help');
  expect(result.stdout).not.toContain('force-pass');
});

it('rejects unsupported arguments and combinations with exit 64', () => {
  for (const args of [['--made-up'], ['--help', '--made-up']]) {
    const result = spawnSync(process.execPath, ['dist/cli.mjs', ...args], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(64);
    expect(result.stderr).toMatch(/unknown|unsupported/i);
  }
});
it('rejects the implemented run command when its required plan is missing',()=>{
  const result=spawnSync(process.execPath,['dist/cli.mjs','run'],{encoding:'utf8'});expect(result.status).toBe(64);expect(result.stderr).toMatch(/requires.*plan/i);
});

it('prints package version', () => {
  const result = spawnSync(process.execPath, ['dist/cli.mjs', '--version'], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('0.1.0');
});

it('an empty test selection exits nonzero', () => {
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/nonexistent-selection'], { encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toMatch(/No test files found/);
});
