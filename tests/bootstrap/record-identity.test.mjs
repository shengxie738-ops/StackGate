import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureVerificationInputs } from '../../scripts/verification-inputs.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const repositories = [];
const TOOL_PATHS = ['scripts/record.mjs', 'scripts/verification-inputs.mjs'];

function fixtureRepo(files = {}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'record-identity-'));
  repositories.push(repo);
  const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  const write = (relative, content) => {
    mkdirSync(path.join(repo, path.dirname(relative)), { recursive: true });
    writeFileSync(path.join(repo, relative), content);
  };
  for (const [relative, content] of Object.entries(files)) write(relative, content);
  cpSync(path.join(projectRoot, 'scripts/record.mjs'), path.join(repo, 'scripts/record.mjs'));
  cpSync(path.join(projectRoot, 'scripts/verification-inputs.mjs'), path.join(repo, 'scripts/verification-inputs.mjs'));
  git('init', '-q'); git('config', 'user.email', 'fixture@localhost'); git('config', 'user.name', 'fixture');
  git('add', '-A'); git('commit', '-q', '-m', 'baseline');
  return { repo, write, git };
}

test.after(() => { for (const repo of repositories) rmSync(repo, { recursive: true, force: true }); });
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const paths = snapshot => snapshot.files.map(entry => entry.relative_path).sort();
const entryFor = (snapshot, relativePath) => snapshot.files.find(entry => entry.relative_path === relativePath);

test('same HEAD with modified tracked source yields a different content hash', async () => {
  const { repo, write, git } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  const before = await captureVerificationInputs(repo);
  assert.equal(before.completeness, 'COMPLETE');
  assert.deepEqual(paths(before), ['apps/api/main.py', ...TOOL_PATHS].sort());
  assert.ok(before.files.every(entry => entry.kind === 'TRACKED_CLEAN'));
  write('apps/api/main.py', 'value = 999\n');
  const after = await captureVerificationInputs(repo);
  assert.equal(after.completeness, 'COMPLETE');
  assert.equal(after.git_head, before.git_head);
  assert.notEqual(before.content_hash, after.content_hash);
  assert.deepEqual(paths(after), paths(before));
  const changed = entryFor(after, 'apps/api/main.py');
  assert.equal(changed.digest, sha(readFileSync(path.join(repo, 'apps/api/main.py'))));
  assert.equal(changed.kind, 'TRACKED_UNSTAGED');
  assert.equal(changed.differs_from_head, true);
  assert.equal(git('status', '--porcelain').stdout, ' M apps/api/main.py\n');
});

test('adding, editing and removing untracked inputs changes the content hash', async () => {
  const { repo, write } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  const base = await captureVerificationInputs(repo);
  assert.equal(base.untracked_count, 0);
  write('apps/web/new-page.ts', 'export const v = 1;\n');
  const added = await captureVerificationInputs(repo);
  assert.equal(added.untracked_count, 1);
  assert.equal(entryFor(added, 'apps/web/new-page.ts').kind, 'UNTRACKED');
  assert.notEqual(base.content_hash, added.content_hash);
  write('apps/web/new-page.ts', 'export const v = 2;\n');
  assert.notEqual(added.content_hash, (await captureVerificationInputs(repo)).content_hash);
  rmSync(path.join(repo, 'apps/web/new-page.ts'));
  const removed = await captureVerificationInputs(repo);
  assert.deepEqual(paths(removed), [...TOOL_PATHS, 'apps/api/main.py'].sort());
  assert.equal(removed.content_hash, base.content_hash);
});

test('staged and unstaged states for the same path are distinguished', async () => {
  const { repo, write, git } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  write('apps/api/main.py', 'value = 2\n');
  git('add', 'apps/api/main.py');
  const staged = await captureVerificationInputs(repo);
  assert.equal(entryFor(staged, 'apps/api/main.py').kind, 'TRACKED_STAGED');
  assert.equal(entryFor(staged, 'apps/api/main.py').differs_from_head, true);
  assert.equal(entryFor(staged, 'scripts/record.mjs').kind, 'TRACKED_CLEAN');
  write('apps/api/main.py', 'value = 3\n');
  const both = await captureVerificationInputs(repo);
  assert.equal(entryFor(both, 'apps/api/main.py').kind, 'TRACKED_STAGED_AND_UNSTAGED');
  assert.notEqual(staged.content_hash, both.content_hash);
});

test('raw bytes distinguish CRLF and UTF-8 content without normalisation', async () => {
  const { repo, write } = fixtureRepo({ 'docs/说明.md': '收益率 12.34%\r\n' });
  const crlf = await captureVerificationInputs(repo);
  assert.ok(paths(crlf).includes('docs/说明.md'));
  assert.equal(entryFor(crlf, 'docs/说明.md').digest, sha(Buffer.from('收益率 12.34%\r\n', 'utf8')));
  write('docs/说明.md', '收益率 12.34%\n');
  const lf = await captureVerificationInputs(repo);
  assert.notEqual(crlf.content_hash, lf.content_hash);
  assert.equal(entryFor(lf, 'docs/说明.md').digest, sha(Buffer.from('收益率 12.34%\n', 'utf8')));
});

test('a path containing whitespace yields exactly one enumerated entry', async () => {
  const { repo, write } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  const awkward = 'apps/web/页面 & \'quoted\' [x] %s #1.ts';
  write(awkward, 'export const x = 1;\n');
  const snapshot = await captureVerificationInputs(repo);
  assert.equal(snapshot.completeness, 'COMPLETE');
  assert.equal(snapshot.files.filter(entry => entry.relative_path.startsWith('apps/web/')).length, 1);
  assert.equal(entryFor(snapshot, awkward).kind, 'UNTRACKED');
  assert.equal(entryFor(snapshot, awkward).digest, sha(Buffer.from('export const x = 1;\n', 'utf8')));
});

test('writing only verification evidence does not invalidate the snapshot', async () => {
  const { repo, write } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  const before = await captureVerificationInputs(repo);
  write('docs/implementation/evidence/aud-001-run.json', '{"exit_code":0}\n');
  write('docs/implementation/evidence/aud-001-run.log', 'noise\n');
  const after = await captureVerificationInputs(repo);
  assert.equal(before.content_hash, after.content_hash);
  assert.ok(after.exclusions.some(entry => entry.reason === 'VERIFICATION_OUTPUT' && entry.count === 2));
});

test('caches are excluded but tracked sources and lockfiles are captured', async () => {
  const { repo, write } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n', 'pnpm-lock.yaml': 'lockfileVersion: 9\n' });
  write('node_modules/left-pad/index.js', 'module.exports = 1;\n');
  write('dist/bundle.js', 'console.log(1);\n');
  write('.stackgate/state/locked.json', '{}\n');
  const base = await captureVerificationInputs(repo);
  assert.ok(base.exclusions.some(entry => entry.reason === 'REBUILDABLE_CACHE'));
  assert.equal(paths(base).some(candidate => candidate.startsWith('node_modules/')), false);
  write('pnpm-lock.yaml', 'lockfileVersion: 10\n');
  const lockChanged = await captureVerificationInputs(repo);
  assert.notEqual(base.content_hash, lockChanged.content_hash);
  write('tests/api.test.ts', 'test(1);\n');
  assert.notEqual(lockChanged.content_hash, (await captureVerificationInputs(repo)).content_hash);
});

test('over-budget inputs are reported as incomplete instead of silently skipped', async () => {
  const { repo, write } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  write('apps/api/big.py', 'x'.repeat(4096));
  const snapshot = await captureVerificationInputs(repo, { maxFileBytes: 1024 });
  assert.equal(snapshot.completeness, 'INCOMPLETE');
  assert.equal(snapshot.content_hash, null);
  assert.ok(snapshot.incomplete_reasons.some(reason => reason.startsWith('OVER_BUDGET')));
  assert.ok(snapshot.files.some(entry => entry.relative_path === 'apps/api/big.py'));
});

test('staged deletions are reported as missing inputs, not as absent source', async () => {
  const { repo, git } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  git('rm', '-q', 'apps/api/main.py');
  const snapshot = await captureVerificationInputs(repo);
  assert.equal(snapshot.completeness, 'INCOMPLETE');
  assert.ok(snapshot.incomplete_reasons.includes('MISSING_INPUT:apps/api/main.py'));
  assert.equal(entryFor(snapshot, 'apps/api/main.py').kind, 'REMOVED_FROM_INDEX_PRESENT_IN_HEAD');
  assert.equal(snapshot.content_hash, null);
});

function runRecorder(repo, taskId, label, script) {
  const result = spawnSync(process.execPath, [
    path.join(repo, 'scripts/record.mjs'), taskId, label, '--', process.execPath, '-e', script,
  ], { cwd: repo, encoding: 'utf8', windowsHide: true });
  const match = result.stderr.match(/Evidence: (\S+\.json)/);
  return { result, evidence: match ? JSON.parse(readFileSync(path.join(repo, match[1]), 'utf8')) : null };
}

test('recorder keeps the raw exit code but refuses attribution when source changed mid-verification', async () => {
  const { repo } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  const before = await captureVerificationInputs(repo);
  const clean = runRecorder(repo, 'SG-051', 'clean-run', 'process.exit(0)');
  assert.equal(clean.result.status, 0);
  assert.equal(clean.evidence.exit_code, 0);
  assert.equal(clean.evidence.result, 'PASSED');
  assert.equal(clean.evidence.source_changed_during_verification, false);
  assert.equal(clean.evidence.verification_attributable, true);
  assert.equal(clean.evidence.content_hash, before.content_hash);
  assert.equal(clean.evidence.source_before.content_hash, before.content_hash);
  assert.equal(clean.evidence.source_before.completeness, 'COMPLETE');
  assert.equal(clean.evidence.repository.worktree_digest, clean.evidence.repository.repo_path_id);
  assert.match(clean.evidence.repository.worktree_digest_semantics, /NOT_SOURCE_CONTENT/);
  assert.equal(clean.evidence.source_before.manifest_path.startsWith('docs/implementation/evidence/sg-051-clean-run-'), true);

  const failing = runRecorder(repo, 'SG-051', 'failing-run', 'process.exit(7)');
  assert.equal(failing.result.status, 7);
  assert.equal(failing.evidence.exit_code, 7);
  assert.equal(failing.evidence.result, 'FAILED');
  assert.equal(failing.evidence.verification_attributable, false);

  const mutated = runRecorder(repo, 'SG-051', 'mid-change',
    'require("fs").writeFileSync("apps/api/main.py","value = 42\\n")');
  assert.equal(mutated.result.status, 0);
  assert.equal(mutated.evidence.exit_code, 0);
  assert.equal(mutated.evidence.source_changed_during_verification, true);
  assert.equal(mutated.evidence.verification_attributable, false);
  assert.equal(mutated.evidence.content_hash, null);
  assert.notEqual(mutated.evidence.source_before.content_hash, mutated.evidence.source_after.content_hash);
  const sidecar = JSON.parse(readFileSync(path.join(repo, mutated.evidence.source_after.manifest_path), 'utf8'));
  assert.equal(entryFor(sidecar, 'apps/api/main.py').digest, sha(Buffer.from('value = 42\n', 'utf8')));
});

test('recorder rejects task ids that are not in the ledgers', () => {
  const { repo } = fixtureRepo({ 'apps/api/main.py': 'value = 1\n' });
  for (const bad of ['AUD-999', 'SG-101', 'SG-000', 'ARBITRARY', '']) {
    const result = spawnSync(process.execPath,
      [path.join(repo, 'scripts/record.mjs'), bad, 'x', '--', process.execPath, '-e', 'process.exit(0)'],
      { cwd: repo, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 64, `expected rejection for ${bad ?? '<empty>'}`);
  }
  const historical = spawnSync(process.execPath,
    [path.join(projectRoot, 'scripts/record.mjs'), 'M1-R07', 'whitelist-probe', '--', process.execPath, '-e', 'process.exit(0)'],
    { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(historical.status, 0, historical.stderr);
});
