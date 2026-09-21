import fs from 'node:fs/promises';
import type { ProjectConfig } from '../../../contracts/src/index.js';
import { resolveWithin } from '../storage/safe-path.js';
import { protectedPrefix } from './task-service.js';
import { configurationError } from './service-error.js';

export const generatedDirectoryNames = ['node_modules', '.venv', 'venv', 'dist', 'build', 'coverage', '.next', '.vite', '.cache', '.pytest_cache', '__pycache__'] as const;
const dependencyNames = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'requirements.txt', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'Pipfile', 'Pipfile.lock'];
export interface ExecutionInputScope {
  workspace_sources: string[];
  command_inputs: string[];
  dependency_identity_files: string[];
  explicitly_required_ignored_inputs: string[];
  protected_inputs: string[];
  excluded_generated_paths: string[];
}
export async function executionInputScope(root: string, config: ProjectConfig, commandInputs: readonly string[]) {
  const sorted = (values: readonly string[]) => [...new Set(values)].sort();
  const workspace_sources = sorted(Object.values(config.workspaces).map(workspace => workspace.path));
  const dependency_identity_files: string[] = [];
  for (const directory of ['', ...workspace_sources]) for (const name of dependencyNames) {
    const relative = directory ? directory + '/' + name : name;
    try {
      const file = await resolveWithin(root, relative);
      if ((await fs.stat(file)).isFile()) dependency_identity_files.push(relative);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const explicitly_required_ignored_inputs = sorted(config.security.required_ignored_inputs ?? []);
  const requiredStat = async (relative: string) => {
    try { return await fs.stat(await resolveWithin(root, relative)); }
    catch { throw configurationError('REQUIRED_INPUT_UNVERIFIED: required execution input is missing or unsafe', relative); }
  };
  for (const relative of explicitly_required_ignored_inputs) {
    if (!(await requiredStat(relative)).isFile()) throw configurationError('REQUIRED_INPUT_UNVERIFIED: required ignored input must identify an ordinary file', relative);
  }
  const protected_inputs = sorted(config.security.protected_inputs.map(protectedPrefix));
  const preciseProtected: string[] = [];
  for (const relative of protected_inputs) {
    if ((await requiredStat(relative)).isFile()) preciseProtected.push(relative);
  }
  const descriptor: ExecutionInputScope = { workspace_sources, command_inputs: sorted(commandInputs), dependency_identity_files: sorted(dependency_identity_files), explicitly_required_ignored_inputs, protected_inputs, excluded_generated_paths: generatedDirectoryNames.map(name => '**/' + name + '/**') };
  const required_files = sorted([...descriptor.command_inputs, ...descriptor.dependency_identity_files, ...explicitly_required_ignored_inputs, ...preciseProtected]);
  return { descriptor, required_files, include_ignored: sorted([...required_files, ...protected_inputs]) };
}
