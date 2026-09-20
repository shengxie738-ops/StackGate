import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { taskProject } from './task-project.js';
import { TaskService } from '../../packages/core/src/services/task-service.js';
import { TrustService } from '../../packages/core/src/services/trust-service.js';
export async function localPlanProject(confirmed = true, configure?: (repo: Awaited<ReturnType<typeof taskProject>>) => void | Promise<void>) {
  const repo = await taskProject(), store = await fs.mkdtemp(path.join(os.tmpdir(), 'stackgate-plan-trust-'));
  await fs.mkdir(path.join(repo.root, 'apps/web'), {recursive: true});
  await fs.mkdir(path.join(repo.root, 'apps/api'), {recursive: true});
  await fs.writeFile(path.join(repo.root, 'apps/web/run.js'), 'throw new Error("STATIC PLAN MUST NOT EXECUTE");');
  await fs.writeFile(path.join(repo.root, '.gitignore'), 'apps/web/run.js\n.stackgate/state/\n');
  repo.config.commands = {smoke: {workspace: 'web', exec: process.execPath, args: ['run.js'], timeout_seconds: 10}, unit: {workspace: 'web', exec: process.execPath, args: ['run.js'], timeout_seconds: 10}};
  repo.config.checks = {smoke: {adapter: 'command', command: 'smoke', result_kind: 'exit-code'}, unit: {adapter: 'junit', command: 'unit', min_tests: 1}};
  repo.config.profiles = {local: {required_checks: ['smoke'], environment: null, minimum_provenance: 'DECLARED', unknown_impact: 'workspace-regression', workspace_regression: {web: ['unit'], api: ['unit']}, flaky_policy: 'incomplete'}};
  repo.config.environments = {};
  repo.task.task_id = 'local-verification'; repo.task.goal = 'Verify the local unit behavior'; repo.task.required_checks = ['smoke']; repo.task.required_test_ids = ['local-case']; repo.task.constraints.require_backend_observation = false;
  repo.task.expected_behavior = ['The separately reviewed local-case JUnit test executes and reports its observed outcome.'];
  await configure?.(repo);
  await fs.writeFile(path.join(repo.root, '.stackgate.yaml'), JSON.stringify(repo.config));
  await fs.writeFile(repo.taskFile, JSON.stringify(repo.task));
  const taskService = new TaskService(repo.root), trust = new TrustService(repo.root, {storeRoot: store});
  if (confirmed) {
    const preview = await taskService.validate(repo.taskFile);
    if (!preview.valid) throw new Error(JSON.stringify(preview.diagnostics));
    await taskService.confirm(repo.taskFile, preview.confirmation_digest!, {authorized: true, source: 'local-review'});
    const permissions = await trust.review(); await trust.confirm(permissions.execution_digest, {authorized: true});
  }
  return {...repo, store, taskService, trust, async close() { await repo.cleanup(); await fs.rm(store, {recursive: true}); }};
}
