import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds examples/contract-drift-demo/patches/fix-client-field.patch from the current sample client.
 * Every edit is an exact string replacement that must match once; an unmatched pattern fails the run
 * instead of producing a silently empty patch. The protected browser acceptance expectation is not
 * part of this script.
 */
const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(demo, 'apps/web');
const tracked = ['src/api/performance.ts', 'src/pages/PerformancePage.tsx', 'tests/performance.test.tsx'];
const edits = {
  'src/api/performance.ts': [
    {
      from: ` * Legacy consumer of the performance endpoint.
 *
 * It reads \`data.totalReturn\`, which is the pre-rename shape. The FastAPI service answers with
 * \`data.performance.total_return\`, so this module is the injected fault for the demo; the reviewed
 * fix patch in ../../patches changes the reader below and nothing else about the acceptance goal.`,
      to: ` * Consumer of the performance endpoint, reading the confirmed target shape.
 *
 * Applied by ../../patches/fix-client-field.patch on top of the legacy reader. The acceptance goal
 * (12.34% from the running service) is unchanged by this patch.`,
    },
    {
      from: `  const legacy = data.totalReturn;
  if (legacy === null) return { totalReturn: null, period: null };
  const totalReturn = requireFiniteNumber(legacy, 'data.totalReturn');
  if (!Number.isFinite(totalReturn)) {
    throw new PerformanceDataError('data.totalReturn', 'Response is missing the legacy field data.totalReturn');
  }`,
      to: `  const current = data.performance?.total_return;
  if (current === null) return { totalReturn: null, period: null };
  const totalReturn = requireFiniteNumber(current, 'data.performance.total_return');
  if (!Number.isFinite(totalReturn)) {
    throw new PerformanceDataError('data.performance.total_return', 'Response is missing the field data.performance.total_return');
  }`,
    },
  ],
  'tests/performance.test.tsx': [
    {
      from: ` * it reads the running FastAPI service instead. \`legacy-mock\` matches the pre-rename shape the
 * unpatched consumer reads, \`target-response\` matches what the service actually returns today.`,
      to: ` * it reads the running FastAPI service instead. Both names carry the confirmed target shape after
 * ../../patches/fix-client-field.patch; the acceptance assertion below stays identical.`,
    },
    {
      from: `  'legacy-mock': { data: { totalReturn: 0.1234 } },`,
      to: `  'legacy-mock': { data: { performance: { total_return: 0.1234, period: '2026-Q3' } } },`,
    },
    {
      from: `stubFetch({ data: { totalReturn: '0.1234' } })`,
      to: `stubFetch({ data: { performance: { total_return: '0.1234' } } })`,
    },
    {
      from: `stubFetch({ data: { totalReturn: null } })`,
      to: `stubFetch({ data: { performance: { total_return: null } } })`,
    },
  ],
};

const scratch = mkdtempSync(path.join(os.tmpdir(), 'fix-patch-'));
try {
  const before = path.join(scratch, 'a', 'apps/web');
  const after = path.join(scratch, 'b', 'apps/web');
  for (const base of [before, after]) {
    for (const file of tracked) {
      mkdirSync(path.join(base, path.dirname(file)), { recursive: true });
      cpSync(path.join(webRoot, file), path.join(base, file));
    }
  }
  for (const [file, replacements] of Object.entries(edits)) {
    const target = path.join(after, file);
    let text = readFileSync(target, 'utf8');
    for (const { from, to } of replacements) {
      const occurrences = text.split(from).length - 1;
      if (occurrences !== 1) throw new Error(`${file}: pattern matched ${occurrences} times, expected exactly 1`);
      text = text.replace(from, to);
    }
    writeFileSync(target, text);
  }
  const diff = spawnSync('git', ['diff', '--no-index', '--unified=3', '--no-color', '--', 'a', 'b'], { cwd: scratch, encoding: 'utf8' });
  if (diff.status !== 1 && diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
  const body = diff.stdout
    .split('\n')
    .filter(line => !line.startsWith('index ') && !line.startsWith('\\ No newline'))
    .map(line => line
      .replaceAll('/a/apps/web/', '/apps/web/')
      .replaceAll('/b/apps/web/', '/apps/web/'))
    .join('\n')
    .replace(/\n+$/, '\n');
  if (!body.includes('--- a/apps/web/') || !body.includes('+++ b/apps/web/')) throw new Error('Patch body has no normalized file headers');
  const out = path.join(demo, 'patches/fix-client-field.patch');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, body);
  console.log(`Wrote ${path.relative(process.cwd(), out)} (${body.split('\n').length} lines)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
