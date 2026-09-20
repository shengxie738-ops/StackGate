import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { taskProject } from '../support/task-project.js';
import { ScanService } from '../../packages/core/src/services/scan-service.js';
import { TaskService } from '../../packages/core/src/services/task-service.js';
vi.setConfig({ testTimeout: 120000 });
it('scan adds both workspace regressions and preserves task/profile checks and test IDs', async () => {
  const repo = await taskProject();
  try {
    repo.config.profiles.integration.required_checks = ['contract'];
    repo.config.profiles.integration.workspace_regression = { web: ['typecheck', 'unit'], api: ['runtime'] };
    repo.task.required_checks = ['e2e'];
    await fs.writeFile(path.join(repo.root, '.stackgate.yaml'), JSON.stringify(repo.config));
    await fs.writeFile(repo.taskFile, JSON.stringify(repo.task));
    const service = new TaskService(repo.root), preview = await service.validate(repo.taskFile);
    expect(preview.valid, JSON.stringify(preview.diagnostics)).toBe(true);
    await service.confirm(repo.taskFile, preview.confirmation_digest!, { authorized: true, source: 'local-review' });
    const result = await new ScanService(repo.root).scan({ task: repo.taskFile, profile: 'integration' });
    expect(result.selection.required_set).toEqual(['contract', 'e2e', 'runtime', 'typecheck', 'unit']);
    expect('selected_tests' in result.selection && result.selection.selected_tests).toContainEqual({ id: 'performance-summary', sources: ['task'] });
    expect(result.runtime).toBe('NOT_EXECUTED');
    expect('impacts' in result && result.impacts.unresolved.length).toBeGreaterThan(0);
    expect('acceptance_drift' in result && result.acceptance_drift.some(f => f.decision === 'DENY')).toBe(false);
    repo.config.profiles.integration.workspace_regression.api = ['unit'];
    await fs.writeFile(path.join(repo.root, '.stackgate.yaml'), JSON.stringify(repo.config));
    const changed = await service.validate(repo.taskFile);
    expect(changed.confirmation_digest).not.toBe(preview.confirmation_digest);
    const drift = await new ScanService(repo.root).scan({ task: repo.taskFile });
    expect('policy_hash' in drift && drift.policy_hash).not.toBe('policy_hash' in result && result.policy_hash);
    expect('acceptance_drift' in drift && drift.acceptance_drift).toContainEqual(expect.objectContaining({ code: 'TARGET_CONFIGURATION_CHANGED', decision: 'DENY' }));
  } finally { await repo.cleanup(); }
});
it('scan retains uncovered workspace gaps when only one regression set exists', async () => {
  const repo = await taskProject();
  try {
    repo.config.profiles.integration.workspace_regression = { web: ['unit'] };
    await fs.writeFile(path.join(repo.root, '.stackgate.yaml'), JSON.stringify(repo.config));
    const result = await new ScanService(repo.root).scan();
    expect('status' in result.selection && result.selection.status).toBe('INCOMPLETE');
    expect(result.coverage_gaps).toContainEqual(expect.objectContaining({ workspace: 'api' }));
  } finally { await repo.cleanup(); }
});
