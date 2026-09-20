import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('built CLI help exposes only implemented commands', () => {
  const result = spawnSync(process.execPath, ['dist/cli.mjs', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--help/);
  assert.doesNotMatch(result.stdout, /force-pass|deploy/);
});

test('unknown CLI option returns configuration error', () => {
  const result = spawnSync(process.execPath, ['dist/cli.mjs', '--made-up'], { encoding: 'utf8' });
  assert.equal(result.status, 64, result.stderr);
  assert.match(result.stderr, /unknown|unsupported/i);
});
