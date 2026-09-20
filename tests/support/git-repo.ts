import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const exec = promisify(execFile);
export const testGit = process.platform === 'win32' ? 'F:/Git/mingw64/bin/git.exe' : '/usr/bin/git';
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec(testGit, ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', ...args], { cwd, windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid', GIT_TERMINAL_PROMPT: '0' } });
  return result.stdout.trim();
}
export async function makeRepo(prefix = 'stackgate-git-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await git(root, 'init', '-b', 'main');
  await fs.writeFile(path.join(root, 'source.txt'), 'initial\n');
  await git(root, 'add', '--', '.');
  await git(root, 'commit', '-m', 'initial');
  return { root, git: (...args: string[]) => git(root, ...args), async commit(file: string, bytes: string) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), bytes); await git(root, 'add', '--', file); await git(root, 'commit', '-m', 'change'); return git(root, 'rev-parse', 'HEAD'); }, async cleanup() { const target = path.resolve(root); const temporaryRoot = await fs.realpath(os.tmpdir()); if (path.dirname(await fs.realpath(target)) !== temporaryRoot || !path.basename(target).startsWith(prefix) || (await fs.lstat(target)).isSymbolicLink()) throw new Error('Refusing cleanup outside owned temporary repository'); await fs.rm(target, { recursive: true, force: true }); } };
}
