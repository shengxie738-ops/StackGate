import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export class GitError extends Error {
  constructor(public readonly code: string, message: string, public readonly exit_code?: number) { super(message); this.name = 'GitError'; }
}
/** Fixed installation locations are trusted deployment configuration, never repository/PATH commands. */
export async function gitExecutable(): Promise<string> {
  const candidates = process.platform === 'win32' ? ['C:/Program Files/Git/mingw64/bin/git.exe', 'C:/Program Files (x86)/Git/mingw32/bin/git.exe', 'F:/Git/mingw64/bin/git.exe'] : ['/usr/bin/git', '/usr/local/bin/git'];
  for (const candidate of candidates) { try { if ((await fs.stat(candidate)).isFile()) return await fs.realpath(candidate); } catch { /* Try next trusted installation. */ } }
  throw new GitError('GIT_UNAVAILABLE', 'No Git executable exists at a trusted installation path');
}
export async function gitCommand(root: string, args: readonly string[]): Promise<Buffer> {
  const executable = await gitExecutable();
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value;
  Object.assign(env, { GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT:'0', GIT_OPTIONAL_LOCKS:'0', GIT_NO_REPLACE_OBJECTS:'1', GIT_NO_LAZY_FETCH:'1', GIT_PAGER:'', LC_ALL:'C' });
  try {
    const result = await exec(executable, ['--no-pager','-c','core.hooksPath=','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','diff.external=','-c','protocol.allow=never', ...args], { cwd:path.resolve(root), env, encoding:'buffer', windowsHide:true, shell:false, timeout:15000, maxBuffer:32 * 1024 * 1024 });
    return result.stdout;
  } catch (error) { const code = (error as {code?:unknown}).code; throw new GitError('GIT_COMMAND_FAILED', `Git ${args[0] ?? 'command'} failed or exceeded its execution limit`, typeof code === 'number' ? code : undefined); }
}
export async function gitText(root: string, args: readonly string[]): Promise<string> { return (await gitCommand(root,args)).toString('utf8').trimEnd(); }
