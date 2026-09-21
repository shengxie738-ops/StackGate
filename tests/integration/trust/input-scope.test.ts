import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { taskProject } from '../../support/task-project.js';
import { TrustService } from '../../../packages/core/src/services/trust-service.js';
vi.setConfig({ testTimeout: 120000 });
async function fixture() {
  const repo = await taskProject(), store = await fs.mkdtemp(path.join(os.tmpdir(), 'stackgate-trust-scope-'));
  for (const workspace of Object.values(repo.config.workspaces) as {path: string}[]) {
    await fs.mkdir(path.join(repo.root, workspace.path), {recursive: true});
    await fs.writeFile(path.join(repo.root, workspace.path, 'run.js'), 'throw new Error("MUST NOT EXECUTE");');
  }
  for (const command of Object.values(repo.config.commands) as {exec: string; args: string[]}[]) { command.exec = process.execPath; command.args = ['run.js']; }
  await fs.writeFile(path.join(repo.root, '.stackgate.yaml'), JSON.stringify(repo.config));
  await fs.writeFile(path.join(repo.root, '.gitignore'), 'node_modules/\n.venv/\n*.local.json\n.env\ndist/\n');
  return { ...repo, store, service: new TrustService(repo.root, {storeRoot: store}), async save() { await fs.writeFile(path.join(repo.root, '.stackgate.yaml'), JSON.stringify(repo.config)); }, async close() { await repo.cleanup(); await fs.rm(store, {recursive: true}); } };
}
it('ignored dependencies and untracked generated caches do not alter trust or get recursively read', async () => {
  const f = await fixture();
  try {
    const before = await f.service.review();
    for (const dir of ['apps/web/node_modules', 'apps/api/.venv', 'apps/web/build', 'apps/web/.cache']) {
      await fs.mkdir(path.join(f.root, dir, 'nested'), {recursive: true});
      await fs.writeFile(path.join(f.root, dir, 'nested', 'cache.js'), 'not a source input');
    }
    const reads: string[] = [], original = fs.readdir.bind(fs);
    const spy = vi.spyOn(fs, 'readdir').mockImplementation(((...args: Parameters<typeof fs.readdir>) => { reads.push(String(args[0])); return original(...args); }) as typeof fs.readdir);
    try {
      const after = await f.service.review();
      expect(after.execution_digest).toBe(before.execution_digest);
      expect(reads.filter(file => /(?:node_modules|\.venv|[\\/]build|\.cache)(?:[\\/]|$)/.test(file))).toEqual([]);
    } finally { spy.mockRestore(); }
  } finally { await f.close(); }
});
it('tracked generated-looking source, untracked source, and dependency identities each change trust', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, 'apps/web/dist'), {recursive: true});
    await fs.writeFile(path.join(f.root, 'apps/web/dist/owned.ts'), 'export const value = 1;');
    await f.git('add', '-f', '--', 'apps/web/dist/owned.ts');
    for (const file of ['apps/web/dist/owned.ts', 'apps/web/new-source.ts', 'pnpm-lock.yaml', 'apps/api/requirements.txt']) {
      const before = await f.service.review(); await fs.appendFile(path.join(f.root, file), '\nchanged');
      expect((await f.service.review()).execution_digest).not.toBe(before.execution_digest);
    }
  } finally { await f.close(); }
});
it('direct ignored dist script is retained without reading sibling generated files', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, 'apps/web/dist'), {recursive: true});
    await fs.writeFile(path.join(f.root, 'apps/web/dist/custom-runner.js'), '// reviewed runner');
    await fs.writeFile(path.join(f.root, 'apps/web/dist/unrelated.js'), '// generated sibling');
    f.config.commands.web_unit.args = ['dist/custom-runner.js']; await f.save();
    const before = await f.service.review();
    await fs.appendFile(path.join(f.root, 'apps/web/dist/unrelated.js'), '\nchanged cache');
    expect((await f.service.review()).execution_digest).toBe(before.execution_digest);
    await fs.appendFile(path.join(f.root, 'apps/web/dist/custom-runner.js'), '\nchanged runner');
    expect((await f.service.review()).execution_digest).not.toBe(before.execution_digest);
  } finally { await f.close(); }
});
it('explicit ignored required files bind bytes and reject missing or secret-bearing inputs', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, 'apps/web/fixture.local.json'), '{"answer":1}');
    f.config.security.required_ignored_inputs = ['apps/web/fixture.local.json']; await f.save();
    const before = await f.service.review();
    await fs.writeFile(path.join(f.root, 'apps/web/fixture.local.json'), '{"answer":2}');
    expect((await f.service.review()).execution_digest).not.toBe(before.execution_digest);
    f.config.security.required_ignored_inputs = ['missing.local.json']; await f.save();
    await expect(f.service.review()).rejects.toThrowError(expect.objectContaining({ exit_code: 64 }));
    await fs.writeFile(path.join(f.root, '.env'), 'PRIVATE_TOKEN=do-not-read');
    f.config.security.required_ignored_inputs = ['.env']; await f.save();
    await expect(f.service.review()).rejects.toThrow();
  } finally { await f.close(); }
});
it('ordinary ignored .env bytes do not enter preview or change digest', async () => {
  const f = await fixture();
  try {
    const before = await f.service.review();
    await fs.writeFile(path.join(f.root, 'apps/web/.env'), 'PRIVATE_TOKEN=sentinel-secret');
    const after = await f.service.review();
    expect(after.execution_digest).toBe(before.execution_digest);
    expect(JSON.stringify(after)).not.toContain('sentinel-secret');
  } finally { await f.close(); }
});
it('rejects command directory entry points whose concrete executed inputs are unknown', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, 'apps/web/dist'), {recursive: true});
    await fs.writeFile(path.join(f.root, 'apps/web/dist/index.js'), '// hidden entry point');
    f.config.commands.web_unit.args = ['dist']; await f.save();
    await expect(f.service.review()).rejects.toThrowError(expect.objectContaining({ exit_code: 64, message: expect.stringContaining('REQUIRED_INPUT_UNVERIFIED') }));
  } finally { await f.close(); }
});
it('explicit command input through an escaping directory link is rejected', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.store, 'escape.js'), '// external');
    await fs.symlink(f.store, path.join(f.root, 'apps/web/link'), process.platform === 'win32' ? 'junction' : 'dir');
    f.config.commands.web_unit.args = ['link/escape.js']; await f.save();
    await expect(f.service.review()).rejects.toThrow();
  } finally { await f.close(); }
});
