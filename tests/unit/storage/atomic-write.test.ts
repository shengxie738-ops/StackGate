import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../../../packages/core/src/storage/atomic-write.js';
import { hashBytes } from '../../../packages/core/src/storage/hash.js';
import { withTestDirectory } from '../../support/test-paths.js';

afterEach(()=>vi.restoreAllMocks());
it('publishes complete canonical JSON and leaves no temporary files', async () => withTestDirectory(async root => {
  await writeJsonAtomic(join(root,'state.json'),{z:2,a:'中文'},{root});
  expect(await fs.readFile(join(root,'state.json'),'utf8')).toBe('{"a":"中文","z":2}\n');
  expect(await fs.readdir(root)).toEqual(['state.json']);
}));
it('does not overwrite existing files without an explicit matching prior digest', async () => withTestDirectory(async root => {
  const file=join(root,'state.json');await fs.writeFile(file,'{"old":1}\r\n');
  await expect(writeJsonAtomic(file,{new:2},{root})).rejects.toMatchObject({code:'TARGET_EXISTS'});
  await expect(writeJsonAtomic(file,{new:2},{root,expectedHash:'a'.repeat(64)})).rejects.toMatchObject({code:'TARGET_CHANGED'});
  expect(await fs.readFile(file,'utf8')).toBe('{"old":1}\r\n');
  const expectedHash=hashBytes(await fs.readFile(file));
  await writeJsonAtomic(file,{new:2},{root,expectedHash});
  expect(await fs.readFile(file,'utf8')).toBe('{"new":2}\n');
}));
it('rejects escaped paths, linked parents, directory targets and invalid JSON before publication', async () => withTestDirectory(async parent => {
  const root=join(parent,'root'),outside=join(parent,'outside');await fs.mkdir(root);await fs.mkdir(outside);
  await fs.symlink(outside,join(root,'alias'),'junction');await fs.mkdir(join(root,'directory'));
  for(const file of [join(outside,'state.json'),join(root,'alias','state.json'),join(root,'directory')]) await expect(writeJsonAtomic(file,{x:1},{root})).rejects.toThrow();
  await expect(writeJsonAtomic(join(root,'invalid.json'),{x:NaN},{root})).rejects.toThrow();
  expect(await fs.readdir(outside)).toEqual([]);
  expect(await fs.readdir(root)).toEqual(['alias','directory']);
}));
it('preserves the old target and cleans its own temporary file after real rename fails', async () => withTestDirectory(async root => {
  const file=join(root,'state.json');await fs.writeFile(file,'{"old":1}');
  // Only the final OS rename fails; temp creation, writing, sync and cleanup remain real.
  vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(new Error('disk failure'),{code:'EIO'}));
  await expect(writeJsonAtomic(file,{next:2},{root,expectedHash:hashBytes(await fs.readFile(file))})).rejects.toMatchObject({code:'EIO'});
  expect(await fs.readFile(file,'utf8')).toBe('{"old":1}');
  expect(await fs.readdir(root)).toEqual(['state.json']);
}));
it('publishes at most one concurrent creation without clobbering the winner', async () => withTestDirectory(async root => {
  const file=join(root,'state.json');
  const results=await Promise.allSettled([writeJsonAtomic(file,{writer:1},{root}),writeJsonAtomic(file,{writer:2},{root})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect([1,2]).toContain(JSON.parse(await fs.readFile(file,'utf8')).writer);
  expect(await fs.readdir(root)).toEqual(['state.json']);
}));
it('a partial temporary write failure never replaces the old JSON', async () => withTestDirectory(async root => {
  const file=join(root,'state.json');await fs.writeFile(file,'{"old":1}');
  const expectedHash=hashBytes(await fs.readFile(file));
  const open=fs.open.bind(fs);
  vi.spyOn(fs,'open').mockImplementation(async (...args) => {
    const handle=await open(...args);
    if(args[1]==='wx') {
      const write=handle.writeFile.bind(handle);
      vi.spyOn(handle,'writeFile').mockImplementationOnce(async () => {
        await write('{"partial":');throw Object.assign(new Error('partial write failure'),{code:'EIO'});
      });
    }
    return handle;
  });
  await expect(writeJsonAtomic(file,{next:2},{root,expectedHash})).rejects.toMatchObject({code:'EIO'});
  expect(await fs.readFile(file,'utf8')).toBe('{"old":1}');
  expect(await fs.readdir(root)).toEqual(['state.json']);
}));
