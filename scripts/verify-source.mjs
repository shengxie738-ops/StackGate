import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePairs = [
  ['StackGate_功能与架构设计_v0.1.md', 'docs/specs/stackgate-v0.1.md', '56b349eda55673090dee2c611baa250b90f1afa5a3f85a0e78c670fa553af8a9'],
  ['StackGate_Codex可执行开发任务规划_v0.1.md', 'docs/plans/2026-09-18-stackgate-v0.1-execution.md', null],
];
export function inspectSources({ rootDir = root, read = readFileSync } = {}) {
  const errors = [];
  const sources = [];
  for (const [original, retained, expected] of sourcePairs) {
    try {
      const bytes = read(path.join(rootDir, original).replaceAll('\\', '/'));
      const copy = read(path.join(rootDir, retained).replaceAll('\\', '/'));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      sources.push({ original, retained, sha256, expected_sha256: expected, bytes: bytes.length });
      if (!bytes.equals(copy)) errors.push(`${retained}: original and retained bytes differ`);
      if (expected && sha256 !== expected) errors.push(`${original}: digest mismatch: expected ${expected}; observed ${sha256}`);
    } catch (error) { errors.push(`${original}: ${error.message}`); }
  }
  return { sources, errors };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectSources();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.errors.length ? 1 : 0;
}
