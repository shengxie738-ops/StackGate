import {expect, it} from 'vitest';
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertNoCompletedReport, atomicWriteJson} from '../../../packages/adapter-playwright/src/inventory.js';
import {withTestDirectory} from '../../support/test-paths.js';

const reportName = 'playwright.json';
const src = (directory: string, name = reportName) => path.join(directory, name);
const seed = (directory: string, text: string, name = reportName) => { writeFileSync(src(directory, name), text, 'utf8'); };
const read = (directory: string, name = reportName) => readFileSync(src(directory, name));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

it('refuses a completed, stale or corrupt pre-existing report instead of calling it free to overwrite', () => withTestDirectory(async directory => {
  seed(directory, '{"completed":true,"marker":"keep"}\n');
  const completedBytes = read(directory);
  expect(() => assertNoCompletedReport(directory)).toThrow(/PRE_EXISTING_COMPLETED_REPORT/);
  expect(() => atomicWriteJson(directory, reportName, {completed: false})).toThrow(/PRE_EXISTING_COMPLETED_REPORT/);
  expect(digest(read(directory))).toBe(digest(completedBytes));

  unlinkSync(src(directory));
  seed(directory, '{"completed":false}\n');
  expect(() => assertNoCompletedReport(directory)).toThrow(/STALE_INCOMPLETE_REPORT/);
  expect(() => atomicWriteJson(directory, reportName, {completed: true})).toThrow(/STALE_INCOMPLETE_REPORT/);
  expect(read(directory).toString('utf8')).toBe('{"completed":false}\n');

  unlinkSync(src(directory));
  seed(directory, '{not json');
  expect(() => assertNoCompletedReport(directory)).toThrow(/PRE_EXISTING_REPORT_UNPARSEABLE/);
  expect(() => atomicWriteJson(directory, reportName, {completed: true})).toThrow(/PRE_EXISTING_REPORT_UNPARSEABLE/);
  expect(read(directory).toString('utf8')).toBe('{not json');
}));

it('refuses a target that is a hard link, a symbolic link or a directory and preserves the other owner', () => withTestDirectory(async directory => {
  seed(directory, '{"completed":true,"marker":"keep"}\n', 'elsewhere.json');
  linkSync(src(directory, 'elsewhere.json'), src(directory));
  expect(() => assertNoCompletedReport(directory)).toThrow(/REPORT_TARGET_IS_A_LINK/);
  expect(() => atomicWriteJson(directory, reportName, {completed: true})).toThrow(/REPORT_TARGET_IS_A_LINK/);
  expect(read(directory, 'elsewhere.json').toString('utf8')).toBe('{"completed":true,"marker":"keep"}\n');
  unlinkSync(src(directory));

  let symlinkCreated = false;
  try {
    symlinkSync(src(directory, 'elsewhere.json'), src(directory), 'file');
    symlinkCreated = true;
  } catch {
    // Symbolic linking can be refused by the platform; the hard-link case above already pins the link rule.
  }
  if (symlinkCreated) {
    expect(() => assertNoCompletedReport(directory)).toThrow(/REPORT_TARGET_IS_A_LINK/);
    expect(() => atomicWriteJson(directory, reportName, {completed: true})).toThrow(/REPORT_TARGET_IS_A_LINK/);
    expect(read(directory, 'elsewhere.json').toString('utf8')).toBe('{"completed":true,"marker":"keep"}\n');
    unlinkSync(src(directory));
  }

  mkdirSync(src(directory));
  expect(() => assertNoCompletedReport(directory)).toThrow(/REPORT_TARGET_NOT_A_REGULAR_FILE/);
  expect(() => atomicWriteJson(directory, reportName, {completed: true})).toThrow(/REPORT_TARGET_NOT_A_REGULAR_FILE/);
  rmSync(src(directory), {recursive: true, force: true});
}));

it('rejects names that are not safe json basenames and directory paths that are not plain directories', () => withTestDirectory(async directory => {
  const unsafe = ['', '.', '..', './playwright.json', '../escape.json', 'a/b.json', 'a\\b.json',
    '/abs/playwright.json', 'C:\\abs\\playwright.json', '.hidden.json', 'playwright', 'playwright.JSON', `${'a'.repeat(129)}.json`];
  for (const name of unsafe) {
    expect(() => atomicWriteJson(directory, name, {ok: true}), `accepted unsafe name ${JSON.stringify(name)}`).toThrow(/UNSAFE_NAME/);
    expect(() => assertNoCompletedReport(directory, name), `accepted unsafe name ${JSON.stringify(name)}`).toThrow(/UNSAFE_NAME/);
  }
  expect(() => assertNoCompletedReport(directory, reportName)).not.toThrow();

  const fileAsDirectory = path.join(directory, 'not-a-dir');
  writeFileSync(fileAsDirectory, 'x', 'utf8');
  expect(() => atomicWriteJson(fileAsDirectory, reportName, {ok: true})).toThrow(/REPORT_DIRECTORY_NOT_A_DIRECTORY/);
  const realDir = path.join(directory, 'real-dir');
  mkdirSync(realDir);
  try {
    symlinkSync(realDir, path.join(directory, 'link-dir'), 'dir');
  } catch {
    return;
  }
  expect(() => atomicWriteJson(path.join(directory, 'link-dir'), reportName, {ok: true}))
    .toThrow(/REPORT_DIRECTORY_IS_A_LINK|REPORT_DIRECTORY_NOT_A_DIRECTORY/);
}));

it('creates the attempt directory, commits one document and leaves no partial behind', () => withTestDirectory(async directory => {
  const fresh = path.join(directory, 'runs', 'run_v2', 'attempt_1');
  expect(() => assertNoCompletedReport(fresh)).not.toThrow();
  const target = atomicWriteJson(fresh, reportName, {completed: true, schema_version: '0.1'});
  expect(target).toBe(src(fresh));
  expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({completed: true, schema_version: '0.1'});
  expect(readFileSync(target, 'utf8').endsWith('\n')).toBe(true);
  expect(readdirSync(fresh)).toEqual([reportName]);
}));

it('lets exactly one of six concurrent reporters commit the same attempt', async () => {
  const harness = await buildWriteHarness();
  try {
    await withTestDirectory(async directory => {
      const outcomes = await Promise.all(Array.from({length: 6}, (_, index) => runWriteHarness(harness, directory, `writer-${index}`)));
      const winners = outcomes.filter(outcome => outcome.code === 0);
      expect(winners).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome.code !== 0)).toHaveLength(5);
      expect(outcomes.filter(outcome => outcome.code !== 0).map(outcome => outcome.stderr).join('\n'))
        .toMatch(/STALE_INCOMPLETE_REPORT|PRE_EXISTING/);
      expect((JSON.parse(readFileSync(src(directory), 'utf8')) as {writer: string}).writer).toBe(winners[0]!.stdout.trim());
      expect(readdirSync(directory)).toEqual([reportName]);
    });
  } finally {
    rmSync(path.dirname(harness), {recursive: true, force: true});
  }
}, 60000);

it('keeps an already completed report byte-identical when two later writers both lose', async () => {
  const harness = await buildWriteHarness();
  try {
    await withTestDirectory(async directory => {
      seed(directory, '{"completed":true,"marker":"keep"}\n');
      const before = digest(read(directory));
      const outcomes = await Promise.all([0, 1].map(index => runWriteHarness(harness, directory, `loser-${index}`)));
      expect(outcomes.every(outcome => outcome.code !== 0)).toBe(true);
      expect(digest(read(directory))).toBe(before);
      expect(read(directory).toString('utf8')).toBe('{"completed":true,"marker":"keep"}\n');
    });
  } finally {
    rmSync(path.dirname(harness), {recursive: true, force: true});
  }
}, 60000);

it('does not treat an absent directory as an existing report', () => withTestDirectory(async directory => {
  expect(() => assertNoCompletedReport(path.join(directory, 'absent', 'deeper'))).not.toThrow();
  expect(() => assertNoCompletedReport(directory, reportName)).not.toThrow();
}));

/** The concurrency assertions must run real processes, so the module is bundled once into a throwaway harness. */
async function buildWriteHarness(): Promise<string> {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackgate-v2r01-'));
  const file = path.join(directory, 'atomic-write-harness.mjs');
  const result = await build({
    entryPoints: [path.resolve('packages/adapter-playwright/src/inventory.ts')],
    bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false,
  });
  const bundle = result.outputFiles[0]!.text;
  expect(/function atomicWriteJson|atomicWriteJson as/.test(bundle), 'bundled harness lost atomicWriteJson').toBe(true);
  writeFileSync(file, `${bundle}
import {pathToFileURL as urlOf} from 'node:url';
export function run(directory, name, writer) {
  try { atomicWriteJson(directory, name, {completed: false, writer}); process.stdout.write(writer); }
  catch (error) { process.stderr.write(String(error && error.message)); process.exitCode = 1; }
}
if (process.argv[1] && urlOf(process.argv[1]).href === import.meta.url) run(process.argv[2], process.argv[3], process.argv[4]);
`, 'utf8');
  return file;
}

function runWriteHarness(harness: string, directory: string, writer: string): Promise<{code: number; stdout: string; stderr: string}> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [harness, directory, reportName, writer], {windowsHide: true});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => resolve({code: 3, stdout, stderr: String(error)}));
    child.on('close', code => resolve({code: code ?? 3, stdout, stderr}));
  });
}
