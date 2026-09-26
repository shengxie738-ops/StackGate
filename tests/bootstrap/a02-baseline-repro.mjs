import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// AUD-001 counterexample: the legacy recorder identity fields hash the repository path, not its content.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repo = mkdtempSync(path.join(os.tmpdir(), 'aud-001-a02-'));
const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });

mkdirSync(path.join(repo, 'apps/api'), { recursive: true });
mkdirSync(path.join(repo, 'scripts'), { recursive: true });
writeFileSync(path.join(repo, 'apps/api/main.py'), 'value = 1\n');
copyFileSync(path.join(root, 'scripts/record.mjs'), path.join(repo, 'scripts/record.mjs'));
copyFileSync(path.join(root, 'scripts/verification-inputs.mjs'), path.join(repo, 'scripts/verification-inputs.mjs'));
git('init', '-q'); git('config', 'user.email', 'fixture@localhost'); git('config', 'user.name', 'fixture');
git('add', '-A'); git('commit', '-q', '-m', 'baseline');

function independentDigest(file) {
  try { return createHash('sha256').update(readFileSync(path.join(repo, file))).digest('hex'); } catch { return null; }
}
function runRecorder(label) {
  const result = spawnSync(process.execPath, [
    path.join(repo, 'scripts/record.mjs'), 'SG-051', label, '--', process.execPath, '-e', 'process.exit(0)',
  ], { cwd: repo, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`recorder run failed: ${result.stderr}`);
  const evidence = JSON.parse(readFileSync(path.join(repo, result.stderr.match(/Evidence: (\S+\.json)/)[1]), 'utf8'));
  return {
    legacy_repository: evidence.repository,
    exit_code: evidence.exit_code,
    content_hash: evidence.content_hash,
    verification_attributable: evidence.verification_attributable,
    independent_sha256: {
      'apps/api/main.py': independentDigest('apps/api/main.py'),
      'apps/web/extra.ts': independentDigest('apps/web/extra.ts'),
    },
  };
}

const before = runRecorder('before-change');
writeFileSync(path.join(repo, 'apps/api/main.py'), 'value = 999\n');
mkdirSync(path.join(repo, 'apps/web'), { recursive: true });
writeFileSync(path.join(repo, 'apps/web/extra.ts'), 'export const changed = true;\n');
const after = runRecorder('after-change');

const legacy_identity_unchanged =
  JSON.stringify(before.legacy_repository) === JSON.stringify(after.legacy_repository);
const tracked_source_changed =
  before.independent_sha256['apps/api/main.py'] !== after.independent_sha256['apps/api/main.py'];
const new_source_content_hash_changed = before.content_hash !== after.content_hash;
const a02_confirmed = legacy_identity_unchanged && tracked_source_changed;
const finishedAt = new Date().toISOString();
const summary = {
  task_id: 'AUD-001',
  command: 'node tests/bootstrap/a02-baseline-repro.mjs',
  argv: ['node', 'tests/bootstrap/a02-baseline-repro.mjs'],
  cwd_relative: '.',
  captured_by: 'tests/bootstrap/a02-baseline-repro.mjs',
  started_at: before.independent_sha256 ? finishedAt : finishedAt,
  finished_at: finishedAt,
  exit_code: a02_confirmed && new_source_content_hash_changed ? 0 : 1,
  result: a02_confirmed && new_source_content_hash_changed ? 'PASSED' : 'FAILED',
  evidence_path: null,
  log_path: null,
  reproduction: {
    recorder_exit_codes: [before.exit_code, after.exit_code],
    legacy_repository_identity_before: before.legacy_repository,
    legacy_repository_identity_after: after.legacy_repository,
    legacy_identity_unchanged_across_two_different_sources: legacy_identity_unchanged,
    independent_content_sha256_before: before.independent_sha256,
    independent_content_sha256_after: after.independent_sha256,
    tracked_source_changed,
    untracked_file_added: 'apps/web/extra.ts',
    new_source_content_hash_before: before.content_hash,
    new_source_content_hash_after: after.content_hash,
    new_source_content_hash_changed,
    conclusion: a02_confirmed && new_source_content_hash_changed
      ? 'AUDIT_BASE_CONFIRMED: legacy fields cannot distinguish the two verified sources while the new content hash does'
      : 'AUDIT_BASE_NOT_REPRODUCED',
  },
  temp_repo: repo,
};
const stem = `a02-baseline-${finishedAt.replace(/[:.]/g, '-')}`;
mkdirSync(path.join(root, 'docs/implementation/evidence'), { recursive: true });
summary.evidence_path = `docs/implementation/evidence/${stem}.json`;
summary.log_path = `docs/implementation/evidence/${stem}.log`;
writeFileSync(path.join(root, summary.evidence_path), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(path.join(root, summary.log_path), `${JSON.stringify({ before, after }, null, 2)}\n`);
console.log(JSON.stringify(summary.reproduction, null, 2));
console.log(`${summary.evidence_path}; exit_code=${summary.exit_code}`);
process.exitCode = summary.exit_code;
