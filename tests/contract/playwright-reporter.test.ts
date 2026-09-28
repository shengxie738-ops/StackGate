import {expect, it} from 'vitest';
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {ReporterIdentity} from '../../packages/adapter-playwright/src/inventory.js';
import {assertNoCompletedReport} from '../../packages/adapter-playwright/src/inventory.js';
import StackGateReporter from '../../packages/adapter-playwright/src/index.js';
import * as entry from '../../packages/adapter-playwright/src/index.js';
import {withTestDirectory} from '../support/test-paths.js';

type Suite = Parameters<StackGateReporter['onBegin']>[1];
type EndTest = Parameters<StackGateReporter['onTestEnd']>[0];
type EndResult = Parameters<StackGateReporter['onTestEnd']>[1];

const identity = (directory: string): ReporterIdentity =>
  ({run_id: 'run_v2r01', check_id: 'm3_browser', attempt_id: 'attempt_1', output_dir: directory});

function suiteOf(testIds: string[]): Suite {
  return {
    allTests: () => testIds.map(test_id => ({
      title: test_id,
      titlePath: () => ['project', test_id],
      location: {file: path.join(process.cwd(), 'tests', 'acceptance', `${test_id}.spec.ts`), line: 3},
      annotations: [{type: 'stackgate-id', description: test_id}],
      expectedStatus: 'passed',
    })),
  } as unknown as Suite;
}
const passingTest = (test_id: string): EndTest => ({
  title: test_id,
  titlePath: () => ['project', test_id],
  annotations: [{type: 'stackgate-id', description: test_id}],
  expectedStatus: 'passed',
}) as unknown as EndTest;
const passingResult = (): EndResult => ({status: 'passed', duration: 12, attachments: [], retries: 0}) as unknown as EndResult;

it('loads as an ESM module and exposes the names the reporter imports', () => {
  expect(typeof StackGateReporter).toBe('function');
  expect(typeof entry.StackGateReporter).toBe('function');
  expect(typeof entry.atomicWriteJson).toBe('function');
  expect(typeof assertNoCompletedReport).toBe('function');
});

it('writes one completed report for a fresh attempt', () => withTestDirectory(async directory => {
  const reporter = new StackGateReporter({identity: identity(directory)});
  reporter.onBegin({}, suiteOf(['T01', 'T02']));
  for (const test_id of ['T01', 'T02']) reporter.onTestEnd(passingTest(test_id), passingResult());
  reporter.onEnd({status: 'passed'});
  const file = path.join(directory, 'playwright.json');
  expect(existsSync(file)).toBe(true);
  const report = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  expect(report).toMatchObject({
    schema_version: '0.1', kind: 'stackgate-playwright', run_id: 'run_v2r01', check_id: 'm3_browser',
    attempt_id: 'attempt_1', completed: true, status: 'passed', diagnostics: [],
  });
  expect((report.inventory as {test_id: string}[]).map(entry2 => entry2.test_id)).toEqual(['T01', 'T02']);
  expect((report.attempts as unknown[]).length).toBe(2);
  expect(readdirSync(directory)).toEqual(['playwright.json']);
}));

it('leaves a pre-existing completed report byte-identical and records its own refusal', () => withTestDirectory(async directory => {
  const file = path.join(directory, 'playwright.json');
  const before = Buffer.from('{"completed":true,"marker":"keep"}\n', 'utf8');
  writeFileSync(file, before);

  const reporter = new StackGateReporter({identity: identity(directory)});
  expect(() => assertNoCompletedReport(directory)).toThrow(/PRE_EXISTING_COMPLETED_REPORT/);
  reporter.onBegin({}, suiteOf(['T01']));
  reporter.onTestEnd(passingTest('T01'), passingResult());
  reporter.onEnd({status: 'passed'});

  expect(readFileSync(file)).toEqual(before);
  const errorFile = path.join(directory, 'playwright-reporter-error.json');
  expect(existsSync(errorFile)).toBe(true);
  const recorded = JSON.parse(readFileSync(errorFile, 'utf8')) as {diagnostics: string[]};
  expect(recorded.diagnostics.join('\n')).toMatch(/PRE_EXISTING_COMPLETED_REPORT/);
  expect(recorded.diagnostics.join('\n')).toMatch(/ONEND_SKIPPED/);
  expect(reporter.build('passed')).not.toHaveProperty('completed', true);
}));

it('writes nothing at all when the run identity is rejected', () => withTestDirectory(async directory => {
  const reporter = new StackGateReporter({identity: {error: 'IDENTITY_INVALID:run_id'} as unknown as ReporterIdentity});
  reporter.onBegin({}, suiteOf(['T01']));
  reporter.onTestEnd(passingTest('T01'), passingResult());
  reporter.onEnd({status: 'passed'});
  expect(readdirSync(directory)).toEqual([]);
  expect(reporter.build('passed').diagnostics.join('\n')).toMatch(/IDENTITY_REJECTED:IDENTITY_INVALID:run_id/);
}));

it('refuses a report name that is not a safe basename and submits no document under it', () => withTestDirectory(async directory => {
  for (const name of ['../outside.json', 'nested/playwright.json', '.hidden.json']) {
    const reporter = new StackGateReporter({identity: identity(directory), name});
    reporter.onBegin({}, suiteOf(['T01']));
    reporter.onTestEnd(passingTest('T01'), passingResult());
    reporter.onEnd({status: 'passed'});
    const document = reporter.build('passed');
    expect(document.diagnostics.join('\n'), `accepted unsafe name ${name}`).toMatch(/UNSAFE_NAME/);
    expect(document.completed, `unsafe name ${name} claimed completion`).toBe(false);
    expect(existsSync(path.resolve(directory, '..', 'outside.json'))).toBe(false);
    expect(existsSync(path.join(directory, 'nested'))).toBe(false);
  }
  expect(readdirSync(directory).filter(entry2 => entry2.startsWith('.')).length).toBe(0);
}));

it('keeps two reporters on the same attempt to at most one submitted report', () => withTestDirectory(async directory => {
  const first = new StackGateReporter({identity: identity(directory)});
  const second = new StackGateReporter({identity: identity(directory)});
  first.onBegin({}, suiteOf(['T01']));
  first.onTestEnd(passingTest('T01'), passingResult());
  first.onEnd({status: 'passed'});
  const submitted = readFileSync(path.join(directory, 'playwright.json'), 'utf8');
  second.onBegin({}, suiteOf(['T01', 'T02']));
  second.onTestEnd(passingTest('T01'), passingResult());
  second.onEnd({status: 'passed'});
  expect(readFileSync(path.join(directory, 'playwright.json'), 'utf8')).toBe(submitted);
  expect(second.build('passed').diagnostics.join('\n')).toMatch(/PRE_EXISTING_COMPLETED_REPORT/);
}));
