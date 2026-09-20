import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [taskId, label, separator, command, ...args] = process.argv.slice(2);
if (!/^SG-\d{3}$/.test(taskId ?? '') || !/^[a-z0-9-]+$/i.test(label ?? '') || separator !== '--' || !command) {
  console.error('Usage: node scripts/record.mjs SG-001 label -- command args...');
  process.exit(64);
}
const startedAt = new Date().toISOString();
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
function record(exitCode, signal = null) {
  if (recorded) return;
  recorded = true;
  const finishedAt = new Date().toISOString();
  const result = {
    task_id: taskId,
    command: [command, ...args].map(value => /\s/.test(value) ? JSON.stringify(value) : value).join(' '),
    argv: [command, ...args], cwd_relative: '.', started_at: startedAt, finished_at: finishedAt,
    exit_code: exitCode, result: exitCode === 0 ? 'PASSED' : 'FAILED', evidence_path: evidencePath,
    log_path: logPath, signal, duration_ms: Date.parse(finishedAt) - Date.parse(startedAt),
  };
  writeFileSync(path.join(root, logPath), output);
  writeFileSync(path.join(root, evidencePath), `${JSON.stringify(result, null, 2)}\n`);
  console.error(`Evidence: ${evidencePath}; exit_code=${exitCode}`);
  process.exitCode = exitCode;
}
try {
  const [executable, argv] = resolveCommand(command, args);
  child = spawn(executable, argv, { cwd: root, shell: false, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', chunk => { output += chunk.toString(); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { output += chunk.toString(); process.stderr.write(chunk); });
  child.on('error', error => { output += `${error.stack}\n`; console.error(error.message); record(3); });
  child.on('close', (code, signal) => record(code ?? 3, signal));
} catch (error) {
  output += `${error.stack}\n`; console.error(error.message); record(3);
}
