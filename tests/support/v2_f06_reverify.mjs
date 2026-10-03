// Reproduce V2-F06 (assertion semantics) against either a committed revision or the working copy.
//
//   node tests/support/v2_f06_reverify.mjs head        -> the defect, as recorded in the repository
//   node tests/support/v2_f06_reverify.mjs worktree    -> the same cases after the repair
//
// One script, two sources, so the RED and the GREEN cannot differ by anything except the module under test.
// The committed source is handed to esbuild through stdin with resolveDir set to its real directory, so the
// module's sibling imports resolve as they do in the repository and the working copy is never touched.
// Exit code 1 means at least one wrong acceptance is still observable.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2] ?? '';
const relative = 'packages/core/src/services/probe-assertions.ts';
const revision = process.argv[3] ?? '56003cf';
if (!['head', 'worktree'].includes(mode)) {
  console.error('usage: node tests/support/v2_f06_reverify.mjs head|worktree [revision]');
  process.exit(64);
}
let contents;
if (mode === 'worktree') {
  contents = readFileSync(relative, 'utf8');
} else {
  const shown = spawnSync('git', ['show', `${revision}:${relative}`], {encoding: 'utf8'});
  if (shown.status !== 0) { console.error(`cannot read ${revision}:${relative}: ${shown.stderr}`); process.exit(2); }
  contents = shown.stdout;
}

const result = await build({
  stdin: {contents, resolveDir: path.resolve('packages/core/src/services'), loader: 'ts', sourcefile: relative},
  bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false,
  // Same shim scripts/build.mjs uses: an ESM bundle that reaches a CommonJS dependency through require.
  banner: {js: "import { createRequire as __sgRequire } from 'node:module'; const require = __sgRequire(import.meta.url);"},
});
const work = mkdtempSync(path.join(tmpdir(), 'stackgate-v2f06-'));
const file = path.join(work, 'probe-assertions.mjs');
writeFileSync(file, result.outputFiles[0].text);
const mod = await import(pathToFileURL(file).href);

const empty = JSON.parse('{}');
const rows = [
  {case: 'exists /constructor on {}', mustNotPass: true,
    ...mod.evaluateAssertion(empty, {assertion_id: 'a1', pointer: '/constructor', operator: 'exists'})},
  {case: 'exists /__proto__ on {}', mustNotPass: true,
    ...mod.evaluateAssertion(empty, {assertion_id: 'a2', pointer: '/__proto__', operator: 'exists'})},
  {case: 'exists /toString on {}', mustNotPass: true,
    ...mod.evaluateAssertion(empty, {assertion_id: 'a3', pointer: '/toString', operator: 'exists'})},
  {case: 'type:number for Infinity', mustNotPass: true,
    ...mod.evaluateAssertion({value: Infinity}, {assertion_id: 'a4', pointer: '/value', operator: 'type', expected: 'number'})},
  {case: 'exists /a/01 on {a:[1,2,3]}', mustNotPass: true,
    ...mod.evaluateAssertion({a: [1, 2, 3]}, {assertion_id: 'a5', pointer: '/a/01', operator: 'exists'})},
  // The counterpart of each refusal: the rule must not become a keyword blacklist or a blanket rejection.
  {case: 'exists /constructor on own member', mustNotPass: false,
    ...mod.evaluateAssertion(Object.assign(Object.create(null), {constructor: 'own'}),
      {assertion_id: 'a6', pointer: '/constructor', operator: 'exists'})},
  {case: 'exists /a/1 on {a:[1,2,3]}', mustNotPass: false,
    ...mod.evaluateAssertion({a: [1, 2, 3]}, {assertion_id: 'a7', pointer: '/a/1', operator: 'exists'})},
];

for (const row of rows) console.log(`[${mode}] ${row.case}: passed=${row.passed} reason=${row.reason ?? 'null'}`);
const wrong = rows.filter(row => row.mustNotPass === row.passed);
for (const row of wrong) console.log(`  WRONG: ${row.case} passed=${row.passed}`);
console.log(`V2F06_STILL_PRESENT=${wrong.length ? 'yes' : 'none'}`);
rmSync(work, {recursive: true, force: true});
process.exitCode = wrong.length ? 1 : 0;
