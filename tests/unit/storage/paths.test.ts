import { expect, it } from 'vitest';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveWithin, inspectPathWithin, decodeGitPath } from '../../../packages/core/src/storage/safe-path.js';
import { withTestDirectory } from '../../support/test-paths.js';

it('preserves Chinese, spaces, exact case and raw CRLF file contents', async () => withTestDirectory(async root => {
  await mkdir(join(root,'中文 目录'));
  await writeFile(join(root,'中文 目录','File.txt'),'中文\r\n');
  const file=await resolveWithin(root,'中文 目录/File.txt');
  expect(await readFile(file,'utf8')).toBe('中文\r\n');
  expect(await resolveWithin(root,'新目录/new.json')).toBe(join(root,'新目录','new.json'));
  await expect(resolveWithin(root,'中文 目录/file.txt')).rejects.toMatchObject({code:'PATH_CASE_CONFLICT'});
}));
it.each(['','..','../outside','a/../../outside','/absolute','C:\\outside','C:relative','\\\\server\\share','\\\\?\\C:\\outside','a\0b','a/./b','a//b','a\\..\\b','file:stream','a.','a ','CON','NUL.json','COM1','LPT².txt','a\ud800','a?b'])('rejects unsafe portable path %j', async relative => withTestDirectory(async root => {
  await expect(resolveWithin(root,relative)).rejects.toMatchObject({code:'UNSAFE_PATH'});
}));
it('rejects a directory junction that escapes to a sibling, even with a shared prefix', async () => withTestDirectory(async parent => {
  const root=join(parent,'repo'),outside=join(parent,'repo-other');
  await mkdir(root);await mkdir(outside);await writeFile(join(outside,'secret'),'untouched');
  await symlink(outside,join(root,'escape'),'junction');
  await expect(resolveWithin(root,'escape/secret')).rejects.toMatchObject({code:'UNSAFE_PATH'});
}));
it('retains link text and verified target for an in-root junction', async () => withTestDirectory(async root => {
  await mkdir(join(root,'real'));await writeFile(join(root,'real','file'),'inside');
  await symlink(join(root,'real'),join(root,'alias'),'junction');
  const result=await inspectPathWithin(root,'alias/file');
  expect(result.path).toBe(join(root,'real','file'));
  expect(result.links).toHaveLength(1);
  expect(result.links[0]).toMatchObject({path:'alias',target:'real'});
  expect(result.links[0]?.link_text).toContain('real');
}));
it('rejects dangling links, cycles and non-directory ancestors', async () => withTestDirectory(async root => {
  await writeFile(join(root,'file'),'x');
  await symlink(join(root,'missing'),join(root,'dangling'),'junction');
  await symlink(join(root,'cycle'),join(root,'cycle'),'junction');
  for(const name of ['dangling/x','cycle/x','file/x']) await expect(resolveWithin(root,name)).rejects.toThrow();
}));
it('rejects a symbolic-link root and undecodable Git path bytes', async () => withTestDirectory(async parent => {
  await mkdir(join(parent,'real'));await symlink(join(parent,'real'),join(parent,'root'),'junction');
  await expect(resolveWithin(join(parent,'root'),'file')).rejects.toThrow();
  expect(decodeGitPath(Buffer.from('中文 空格.txt'))).toBe('中文 空格.txt');
  for(const bytes of [new Uint8Array([0xff]),new Uint8Array([0xc0,0xaf]),Buffer.from('a\0b')]) expect(()=>decodeGitPath(bytes)).toThrow();
}));
