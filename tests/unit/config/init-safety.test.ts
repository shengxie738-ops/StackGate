import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { InitService } from '../../../packages/core/src/services/init-service.js';
import { withTestDirectory } from '../../support/test-paths.js';
const templates = path.resolve('presets/fastapi-react');

it.each(['.stackgate.yml', '.stackgate.json'])('preserves an existing %s configuration without creating a competing yaml file', async (name) => withTestDirectory(async (root) => {
  const existing = Buffer.from('existing bytes\r\n'); await fs.writeFile(path.join(root, name), existing);
  const service = new InitService(root, templates), preview = await service.preview();
  expect(preview.conflicts).toContain(name);
  expect(preview.files.find((file) => file.path === '.stackgate.yaml')?.conflict).toBe(true);
  await service.apply(preview);
  await expect(fs.access(path.join(root, '.stackgate.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(root, name))).toEqual(existing);
}));
it('rejects an existing .gitignore hard link before creating any generated files', async () => withTestDirectory(async (root) => {
  const original = Buffer.from('user-owned content\n'); await fs.writeFile(path.join(root, 'user-file'), original);
  await fs.link(path.join(root, 'user-file'), path.join(root, '.gitignore'));
  const service = new InitService(root, templates);
  await expect(service.preview()).rejects.toThrow(/link/i);
  expect(await fs.readFile(path.join(root, 'user-file'))).toEqual(original);
  await expect(fs.access(path.join(root, '.stackgate.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
}));
it('rejects a real linked generated directory before writing the first configuration', async () => withTestDirectory(async (root) => {
  const destination = path.join(root, 'user-directory'); await fs.mkdir(destination);
  await fs.symlink(destination, path.join(root, '.stackgate'), process.platform === 'win32' ? 'junction' : 'dir');
  const service = new InitService(root, templates);
  await expect(service.preview()).rejects.toThrow(/link/i);
  expect(await fs.readdir(destination)).toEqual([]);
  await expect(fs.access(path.join(root, '.stackgate.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
}));
it('revalidates ignore-file identity before any apply write after a safe preview', async () => withTestDirectory(async (root) => {
  await fs.writeFile(path.join(root, '.gitignore'), 'do not append');
  const service = new InitService(root, templates), preview = await service.preview();
  await fs.writeFile(path.join(root, 'user-file'), 'do not append');
  await fs.unlink(path.join(root, '.gitignore'));
  await fs.link(path.join(root, 'user-file'), path.join(root, '.gitignore'));
  await expect(service.apply(preview)).rejects.toThrow(/link/i);
  expect(await fs.readFile(path.join(root, 'user-file'), 'utf8')).toBe('do not append');
  await expect(fs.access(path.join(root, '.stackgate.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
}));
it('appends only the displayed patch and preserves ordinary existing ignore bytes', async () => withTestDirectory(async (root) => {
  const original = Buffer.from('# custom\r\nsecrets/'); await fs.writeFile(path.join(root, '.gitignore'), original);
  const service = new InitService(root, templates), preview = await service.preview(); await service.apply(preview);
  expect(await fs.readFile(path.join(root, '.gitignore'))).toEqual(Buffer.concat([original, Buffer.from(preview.gitignore_patch)]));
  const again = await service.preview(); expect(again.gitignore_patch).toBe(''); expect(again.conflicts).toContain('.stackgate.yaml');
}));
