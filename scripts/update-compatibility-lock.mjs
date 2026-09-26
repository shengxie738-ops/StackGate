import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Additive compatibility-lock update.
 *
 * tools/compatibility-lock.json accumulates VERIFIED entries from task-specific preparation scripts;
 * `scripts/inspect-toolchain.mjs` regenerates only what it can observe itself and would silently drop
 * the rest. Use this updater whenever a newly executed tool combination must be recorded.
 */
const lockPath = 'tools/compatibility-lock.json';
const [command = 'node scripts/update-compatibility-lock.mjs --sample-web'] = process.argv.slice(2);
if (command !== '--sample-web') {
  console.error('usage: node scripts/update-compatibility-lock.mjs --sample-web');
  process.exit(64);
}
const platform = process.platform + '-' + process.arch;
const webRoot = 'examples/contract-drift-demo/apps/web';
const sampleLockFile = 'examples/contract-drift-demo/pnpm-lock.yaml';
const evidenceCommand = 'pnpm exec vitest run tests/integration/demo/web-fixtures.test.ts';

const observed = {
  react: 'renders the sample performance page against both mock and target-shaped responses',
  'react-dom': 'createRoot mount inside the jsdom environment used by the sample unit tests',
  jsdom: 'DOM environment for the sample component assertions',
  vite: 'sample build/dev configuration consumed by the recorded test run',
  vitest: 'sample test runner executed as a real child process from Node',
  '@vitejs/plugin-react': 'TSX transform for the sample page and tests',
};

async function digest(file) {
  return 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex');
}
function pick(list, prefix) {
  const matches = list.filter(entry => entry.evidence_path.startsWith(prefix) && entry.exit_code === 0);
  return matches.sort((left, right) => right.finished_at.localeCompare(left.finished_at))[0] ?? null;
}

const lock = JSON.parse(await readFile(lockPath, 'utf8'));
if (!Array.isArray(lock.tools)) throw new Error('Lock has no tools array');
const evidenceFiles = [];
const { readdir } = await import('node:fs/promises');
for (const file of await readdir('docs/implementation/evidence')) {
  if (!file.endsWith('.json')) continue;
  evidenceFiles.push(JSON.parse(await readFile(path.join('docs/implementation/evidence', file), 'utf8')));
}
const proof = pick(evidenceFiles, 'sg-052-web-fixtures-green') ?? evidenceFiles
  .find(entry => entry.command === evidenceCommand && entry.exit_code === 0);
if (!proof) throw new Error(`No passing evidence recorded for: ${evidenceCommand}`);
if (!existsSync(sampleLockFile)) throw new Error('Sample workspace lockfile is missing; run pnpm install in examples/contract-drift-demo');

const samplePkg = JSON.parse(await readFile(path.join(webRoot, 'package.json'), 'utf8'));
const { parse } = await import('yaml');
const sampleLock = parse(await readFile(sampleLockFile, 'utf8'));
const pins = { ...samplePkg.dependencies, ...samplePkg.devDependencies };
const added = [];
for (const [name, capability] of Object.entries(observed)) {
  const metadataPath = path.join(webRoot, 'node_modules', name, 'package.json');
  if (!existsSync(metadataPath)) throw new Error(`Sample dependency not installed: ${name}`);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (metadata.version !== pins[name]) throw new Error(`Sample pin drift for ${name}: ${metadata.version} != ${pins[name]}`);
  const integrity = sampleLock.packages?.[`${name}@${metadata.version}`]?.resolution?.integrity;
  if (!integrity) throw new Error(`No sample lockfile integrity for ${name}@${metadata.version}`);
  const entry = {
    name: `${name} (sample)`,
    version: metadata.version,
    platform,
    source: `https://registry.npmjs.org/${name}/${metadata.version}`,
    checksum_or_lock_integrity: integrity,
    tested_capabilities: [capability],
    status: 'VERIFIED',
    verified_at: proof.finished_at,
    evidence_refs: [proof.evidence_path],
    sample_lockfile_sha256: await digest(sampleLockFile),
  };
  const index = lock.tools.findIndex(tool => tool.name === entry.name);
  if (index === -1) lock.tools.push(entry);
  else lock.tools[index] = { ...lock.tools[index], ...entry };
  added.push(entry.name);
}
lock.generated_at = new Date().toISOString();
await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log(`Merged ${added.length} sample entries; lock now holds ${lock.tools.length} tools (no entries dropped)`);
