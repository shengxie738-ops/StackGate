import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckPlan, PlanContext } from '../../packages/contracts/src/index.js';
import { validateSchema } from '../../packages/contracts/src/index.js';
import { PlanService } from '../../packages/core/src/services/plan-service.js';
import { localPlanProject } from '../support/local-plan-project.js';
vi.setConfig({testTimeout: 180000});
it('persists a deterministic verified plan with exact ignored script bytes and required JUnit IDs', async () => {
  const f = await localPlanProject(true, repo => { repo.config.workspaces.api.path = 'apps/web'; repo.config.commands.smoke.workspace = 'api'; });
  try {
    const service = new PlanService(f.root, {trustStoreRoot: f.store});
    const plan = await service.create({task: f.taskFile, profile: 'local'}) as CheckPlan;
    expect(validateSchema('plan', plan).ok).toBe(true);
    expect(plan.required_check_ids).toEqual(['smoke', 'unit']);
    expect(plan.steps.find(step => step.check_id === 'smoke')!.expected_test_ids).toEqual([]);
    expect(plan.steps.find(step => step.check_id === 'unit')!.expected_test_ids).toEqual(['local-case']);
    expect(plan.steps.find(step => step.check_id === 'smoke')!.resource_locks).toEqual(plan.steps.find(step => step.check_id === 'unit')!.resource_locks);
    expect(await service.create({task: f.taskFile, profile: 'local'})).toEqual(plan);
    const loaded = await service.load(plan.plan_id) as {plan: CheckPlan; context: PlanContext};
    expect(loaded.context.environment_requirements).toEqual({required: false});
    expect(loaded.context.blockers).toEqual([]);
    expect((loaded.context as unknown as {selection_sources: Record<string, string[]>}).selection_sources?.unit).toEqual(['workspace-regression:api', 'workspace-regression:web']);
    expect((loaded.context as unknown as {analysis_gaps: unknown[]}).analysis_gaps).toContainEqual(expect.objectContaining({workspace: '*', reference: '.stackgate/mappings.json'}));
    expect(loaded.context.input_manifest.files).toContainEqual(expect.objectContaining({relative_path: 'apps/web/run.js', tracked: false, digest: expect.stringMatching(/^[a-f0-9]{64}$/)}));
    expect(await service.inspectCurrent(plan.plan_id)).toMatchObject({valid: true, freshness: 'FRESH'});
    const originalDirectory = path.join(f.root, f.config.state_dir, 'plans', plan.plan_id), movedDirectory = path.join(f.root, f.config.state_dir, 'moved-plan');
    await fs.rename(originalDirectory, movedDirectory);
    await fs.symlink(movedDirectory, originalDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(service.load(plan.plan_id)).rejects.toThrow();
  } finally { await f.close(); }
});
it('rejects oversized plan files before allocating their contents', async () => {
  const f = await localPlanProject(false);
  try {
    const planId = 'plan_' + 'a'.repeat(64), directory = path.join(f.root, f.config.state_dir, 'plans', planId);
    await fs.mkdir(directory, {recursive: true});
    const planFile = path.join(directory, 'plan.json'); await fs.writeFile(planFile, Buffer.alloc(16 * 1024 * 1024 + 1, 32));
    const spy = vi.spyOn(fs, 'readFile');
    try {
      await expect(new PlanService(f.root, {trustStoreRoot: f.store}).load(planId)).rejects.toThrow();
      expect(spy.mock.calls.some(call => String(call[0]) === planFile)).toBe(false);
    } finally { spy.mockRestore(); }
  } finally { await f.close(); }
});
it('rejects unconfirmed task or unreviewed trust before persisting an executable plan', async () => {
  const f = await localPlanProject(false);
  try {
    const service = new PlanService(f.root, {trustStoreRoot: f.store});
    await expect(service.create({task: f.taskFile, profile: 'local'})).rejects.toThrowError(expect.objectContaining({exit_code: 64}));
    const p = await f.taskService.validate(f.taskFile); await f.taskService.confirm(f.taskFile, p.confirmation_digest!, {authorized: true, source: 'local-review'});
    await expect(service.create({task: f.taskFile, profile: 'local'})).rejects.toThrowError(expect.objectContaining({exit_code: 64}));
  } finally { await f.close(); }
});
it('rechecks ignored script, policy and task identity, and rejects modified stored context', async () => {
  const f = await localPlanProject();
  try {
    const service = new PlanService(f.root, {trustStoreRoot: f.store}), plan = await service.create({task: f.taskFile, profile: 'local'}) as CheckPlan;
    const script = path.join(f.root, 'apps/web/run.js'), original = await fs.readFile(script);
    await fs.appendFile(script, '\n// changed executable input');
    expect(await service.inspectCurrent(plan.plan_id)).toMatchObject({valid: false, freshness: 'STALE'});
    await fs.writeFile(script, original);
    f.config.checks.unit.min_tests = 2; await fs.writeFile(path.join(f.root, '.stackgate.yaml'), JSON.stringify(f.config));
    expect(await service.inspectCurrent(plan.plan_id)).toMatchObject({valid: false, freshness: 'STALE'});
    f.config.checks.unit.min_tests = 1; await fs.writeFile(path.join(f.root, '.stackgate.yaml'), JSON.stringify(f.config));
    f.task.revision = 2; await fs.writeFile(f.taskFile, JSON.stringify(f.task));
    expect(await service.inspectCurrent(plan.plan_id)).toMatchObject({valid: false, freshness: 'STALE'});
    const contextPath = path.join(f.root, f.config.state_dir, 'plans', plan.plan_id, 'context.json');
    const context = JSON.parse(await fs.readFile(contextPath, 'utf8')); context.base_ref = 'unrelated'; await fs.writeFile(contextPath, JSON.stringify(context));
    await expect(service.load(plan.plan_id)).rejects.toThrow();
  } finally { await f.close(); }
});
it('retains an explicitly required runtime check and marks unsupported local backend requirements blocked', async () => {
  const f = await localPlanProject(true, repo => {
    repo.config.checks.probe = {adapter: 'stackgate-probe', command: 'unit', required_operations: ['GET /api/performance']};
    repo.task.required_checks = ['smoke', 'probe']; repo.task.constraints.require_backend_observation = true;
  });
  try {
    const service = new PlanService(f.root, {trustStoreRoot: f.store}), plan = await service.create({task: f.taskFile, profile: 'local'});
    expect(plan.required_check_ids).toContain('probe');
    const {context} = await service.load(plan.plan_id);
    expect(context.blockers).toContainEqual(expect.objectContaining({code: 'ENV_PROVENANCE_INSUFFICIENT'}));
    expect(context.blockers).toContainEqual(expect.objectContaining({code: 'UNSUPPORTED_CAPABILITY', check_id: 'probe'}));
    expect(await service.inspectCurrent(plan.plan_id)).toMatchObject({valid: false, identity_valid: true, executable: false, freshness: 'FRESH'});
  } finally { await f.close(); }
});
it('keeps required e2e and an explicit environment dependency when M3 environment is unavailable', async () => {
  const f = await localPlanProject(true, repo => {
    repo.config.profiles.local.environment = 'test'; repo.config.profiles.local.minimum_provenance = 'OBSERVED';
    repo.config.environments = {test: {mode: 'attach', frontend_origin: 'http://127.0.0.1:5173', backend_origin: 'http://127.0.0.1:8000', health_path: '/health', provenance_file: '.stackgate-runtime.json'}};
    repo.config.checks.e2e = {adapter: 'playwright', command: 'unit', required_test_ids: ['local-case'], require_real_backend: true};
    repo.task.required_checks = ['smoke', 'e2e']; repo.task.constraints.require_backend_observation = true;
  });
  try {
    const service = new PlanService(f.root, {trustStoreRoot: f.store}), plan = await service.create({task: f.taskFile, profile: 'local'});
    const environment = plan.steps.find(step => step.adapter_id === 'environment')!;
    expect(environment).toBeTruthy(); expect(plan.required_check_ids).toContain(environment.check_id);
    expect(plan.steps.find(step => step.check_id === 'e2e')!.depends_on).toContain(environment.step_id);
    expect((await service.load(plan.plan_id)).context.blockers).toContainEqual(expect.objectContaining({code: 'ENV_PROVENANCE_INSUFFICIENT', check_id: environment.check_id}));
  } finally { await f.close(); }
});
it('binds the raw bytes of ignored mappings used to select checks', async () => {
  const f = await localPlanProject(true, async repo => {
    await fs.appendFile(path.join(repo.root, '.gitignore'), '.stackgate/mappings.json\n');
    await fs.writeFile(path.join(repo.root, 'apps/web/consumer.ts'), 'fetch("/api/performance");');
    await fs.writeFile(path.join(repo.root, '.stackgate/mappings.json'), JSON.stringify({schema_version: '0.1', mappings: [{operation_key: 'api:GET /api/performance', consumer_paths: ['apps/web/consumer.ts'], check_ids: ['unit'], test_ids: ['local-case'], workspace: 'web'}]}));
  });
  try {
    const service = new PlanService(f.root, {trustStoreRoot: f.store}), plan = await service.create({task: f.taskFile, profile: 'local'});
    expect((await service.load(plan.plan_id)).context.input_manifest.files).toContainEqual(expect.objectContaining({relative_path: '.stackgate/mappings.json', digest: expect.stringMatching(/^[a-f0-9]{64}$/)}));
    await fs.appendFile(path.join(f.root, '.stackgate/mappings.json'), '\n');
    expect(await service.inspectCurrent(plan.plan_id)).toMatchObject({identity_valid: false, freshness: 'STALE'});
  } finally { await f.close(); }
});
