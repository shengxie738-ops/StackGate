import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
export async function withTestDirectory<T>(action: (directory: string) => Promise<T>): Promise<T> {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'stackgate-test-'));
  try { return await action(directory); }
  finally {
    const target = resolve(directory);
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith('stackgate-test-')) throw new Error('Unsafe test cleanup target');
    await rm(target, { recursive: true, force: true });
  }
}
