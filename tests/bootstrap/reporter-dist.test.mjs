import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const dist = 'dist/playwright-reporter.mjs';

test('the built reporter entry loads as ESM and keeps its export contract', async () => {
  assert.ok(existsSync(dist), `${dist} is missing; run pnpm build before this test`);
  const mod = await import(pathToFileURL(path.resolve(dist)).href);
  assert.equal(typeof mod.default, 'function', 'the built bundle lost its default reporter');
  assert.equal(mod.StackGateReporter, mod.default, 'named and default reporter must be one class');
  for (const name of ['atomicWriteJson', 'assertNoCompletedReport', 'reporterIdentity', 'stableTestId']) {
    assert.equal(typeof mod[name], 'function', `built bundle lost ${name}`);
  }
});

test('the built reporter still refuses to replace an existing attempt report', async () => {
  assert.ok(existsSync(dist), `${dist} is missing; run pnpm build before this test`);
  const mod = await import(pathToFileURL(path.resolve(dist)).href);
  const directory = mkdtempSync(path.join(tmpdir(), 'stackgate-dist-reporter-'));
  try {
    const target = path.join(directory, 'playwright.json');
    const before = Buffer.from('{"completed":true,"marker":"keep"}\n', 'utf8');
    writeFileSync(target, before);
    assert.throws(() => mod.assertNoCompletedReport(directory), /PRE_EXISTING_COMPLETED_REPORT/);
    assert.throws(() => mod.atomicWriteJson(directory, 'playwright.json', { completed: false }), /PRE_EXISTING_COMPLETED_REPORT/);
    assert.deepEqual(readFileSync(target), before);

    const reporter = new mod.default({
      identity: { run_id: 'run_dist', check_id: 'm3_browser', attempt_id: 'attempt_2', output_dir: directory },
    });
    reporter.onBegin({}, { allTests: () => [] });
    reporter.onEnd({ status: 'passed' });
    assert.deepEqual(readFileSync(target), before, 'onEnd replaced a report it had refused at construction');
    assert.ok(existsSync(path.join(directory, 'playwright-reporter-error.json')), 'the losing reporter left no diagnostic artifact');

    const clean = path.join(directory, 'attempt_3');
    assert.equal(mod.atomicWriteJson(clean, 'playwright.json', { completed: true }), path.join(clean, 'playwright.json'));
    assert.deepEqual(readdirSync(clean), ['playwright.json']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    assert.ok(!existsSync(directory), 'test temporary directory was not removed');
  }
});
