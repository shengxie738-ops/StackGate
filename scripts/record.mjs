import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureVerificationInputs } from './verification-inputs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [taskId, label, separator, command, ...args] = process.argv.slice(2);
const AUDIT_LEDGER = 'docs/implementation/audit-m3-fixes.json';
function allowedTaskId(value) {
  if (/^SG-\d{3}$/.test(value) && Number(value.slice(3)) >= 1 && Number(value.slice(3)) <= 100) return true;
  if (/^M1-R0[0-7]$/.test(value)) return true;
  if (/^AUD-\d{3}$/.test(value)) {
    try {
      const ledger = JSON.parse(readFileSync(path.join(root, AUDIT_LEDGER), 'utf8'));
      return (ledger.tasks ?? []).some(task => task.task_id === value);
    } catch { return false; }
  }
  return false;
}
if (!allowedTaskId(taskId ?? '') || !/^[a-z0-9-]+$/i.test(label ?? '') || separator !== '--' || !command) {
  console.error('Usage: node scripts/record.mjs SG-001|AUD-000 label -- command args...');
  process.exit(64);
}
const startedAt = new Date().toISOString();
function repositoryIdentity() {
  const options={cwd:root,encoding:'utf8',windowsHide:true,timeout:10000};
  const head=spawnSync('git',['rev-parse','HEAD'],options);
  const top=spawnSync('git',['rev-parse','--show-toplevel'],options);
  const branch=spawnSync('git',['branch','--show-current'],options);
  const valid=head.status===0&&top.status===0;
  return {identity_status:valid?'VERIFIED':'UNVERIFIED',head:valid?head.stdout.trim():null,
    branch:branch.status===0?branch.stdout.trim():null,
    repo_path_id:valid?createHash('sha256').update(top.stdout.trim().replaceAll('\\','/')).digest('hex'):null,
    worktree_digest:valid?createHash('sha256').update(top.stdout.trim().replaceAll('\\','/')).digest('hex'):null,
    worktree_digest_semantics:'LEGACY_REPOSITORY_PATH_IDENTITY_NOT_SOURCE_CONTENT'};
}
const repository=repositoryIdentity();
const stem = `${taskId.toLowerCase()}-${label}-${startedAt.replace(/[:.]/g, '-')}`;
const evidencePath = `docs/implementation/evidence/${stem}.json`;
const logPath = `docs/implementation/evidence/${stem}.log`;
mkdirSync(path.join(root, 'docs/implementation/evidence'), { recursive: true });

function resolveCommand(name, argv) {
  if (name === 'node') return [process.execPath, argv];
  if (['pnpm', 'npm', 'npx'].includes(name)) {
    const suffixes = name === 'pnpm'
      ? ['node_modules/pnpm/bin/pnpm.cjs', 'node_modules/pnpm/bin/pnpm.mjs', 'node_modules/pnpm/bin/pnpm.js']
      : [`node_modules/npm/bin/${name}-cli.js`];
    const dirs = [path.dirname(process.execPath), ...(process.env.PATH ?? '').split(path.delimiter)];
    for (const dir of dirs) for (const suffix of suffixes) {
      const entry = path.join(dir, suffix);
      if (existsSync(entry)) return [process.execPath, [entry, ...argv]];
    }
    if (process.platform === 'win32') throw new Error(`Cannot resolve ${name} JavaScript entry; refusing implicit shell fallback`);
  }
  if (/\.(cmd|bat)$/i.test(name)) throw new Error('Batch commands require an explicit reviewed shell; no implicit shell fallback');
  return [name, argv];
}

let output = '';
let child;
let recorded = false;
async function record(exitCode, signal = null) {
  if (recorded) return;
  recorded = true;
  const finishedAt = new Date().toISOString();
  const sourceAfter = await captureVerificationInputs(root);
  const manifest = (name, snapshot) => {
    const relative = `docs/implementation/evidence/${name}.json`;
    writeFileSync(path.join(root, relative), `${JSON.stringify(snapshot, null, 2)}\n`);
    return { manifest_path: relative, content_hash: snapshot.content_hash, completeness: snapshot.completeness, file_count: snapshot.file_count, incomplete_reasons: snapshot.incomplete_reasons };
  };
  const sourceBeforeRef = manifest(`${stem}-source-before`, sourceBefore);
  const sourceAfterRef = manifest(`${stem}-source-after`, sourceAfter);
  const sourceChangedDuringVerification = sourceBefore.content_hash !== sourceAfter.content_hash;
  const attributable = exitCode === 0
    && sourceBefore.completeness === 'COMPLETE' && sourceAfter.completeness === 'COMPLETE'
    && !sourceChangedDuringVerification;
  const result = {
    task_id: taskId,
    repository,
    command: [command, ...args].map(value => /\s/.test(value) ? JSON.stringify(value) : value).join(' '),
    argv: [command, ...args], cwd_relative: '.', started_at: startedAt, finished_at: finishedAt,
    exit_code: exitCode, result: exitCode === 0 ? 'PASSED' : 'FAILED', evidence_path: evidencePath,
    log_path: logPath, signal, duration_ms: Date.parse(finishedAt) - Date.parse(startedAt),
    source_before: sourceBeforeRef, source_after: sourceAfterRef,
    source_changed_during_verification: sourceChangedDuringVerification,
    verification_attributable: attributable,
    content_hash: attributable ? sourceAfter.content_hash : null,
  };
  writeFileSync(path.join(root, logPath), output);
  writeFileSync(path.join(root, evidencePath), `${JSON.stringify(result, null, 2)}\n`);
  console.error(`Evidence: ${evidencePath}; exit_code=${exitCode}; source=${sourceAfter.content_hash ?? 'INCOMPLETE'}; attributable=${attributable}`);
  process.exitCode = exitCode;
}
const sourceBefore = await captureVerificationInputs(root);
try {
  const [executable, argv] = resolveCommand(command, args);
  child = spawn(executable, argv, { cwd: root, shell: false, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', chunk => { output += chunk.toString(); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { output += chunk.toString(); process.stderr.write(chunk); });
  child.on('error', async error => { output += `${error.stack}\n`; console.error(error.message); await record(3); });
  child.on('close', async (code, signal) => await record(code ?? 3, signal));
} catch (error) {
  output += `${error.stack}\n`; console.error(error.message); await record(3);
}
