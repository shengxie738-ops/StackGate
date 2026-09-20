import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { parseConfiguration } from '../../packages/core/src/services/config-service.js';
import { selectChecks } from '../../packages/core/src/domain/select-checks.js';
import { emptyImpactGraph } from '../../packages/adapter-typescript/src/impact-graph.js';
const sample = JSON.parse(await fs.readFile('tests/fixtures/config/original.json', 'utf8'));
const parse = (value: unknown) => parseConfiguration(Buffer.from(JSON.stringify(value)), '.stackgate.yaml');
it('accepts workspace regression while preserving explicit profile requirements', () => {
  const value = structuredClone(sample);
  value.profiles.integration.workspace_regression = { web: ['typecheck', 'unit'], api: ['runtime'] };
  expect(parse(value).profiles.integration).toMatchObject({ required_checks: sample.profiles.integration.required_checks, workspace_regression: { web: ['typecheck', 'unit'], api: ['runtime'] } });
});
it.each([{ missing: ['unit'] }, { web: ['missing'] }, { web: ['unit', 'unit'] }, { web: [] }])('rejects unknown or ambiguous regression references: %j', regression => {
  const value = structuredClone(sample); value.profiles.integration.workspace_regression = regression;
  expect(() => parse(value)).toThrowError(expect.objectContaining({ exit_code: 64 }));
});
it('wildcard impact requires coverage for every configured workspace', () => {
  const graph = emptyImpactGraph(); graph.unresolved.push({ kind: 'scope', workspace: '*', reference: 'consumer', origin: 'test', reason: 'Unknown consumer' });
  const policy = { required_set: ['typecheck'], workspace_regression: { web: ['unit'] }, workspace_ids: ['web', 'api'], optional_failure_policy: 'incomplete' as const };
  const result = selectChecks({ required_checks: ['e2e'], required_test_ids: ['required-flow'] }, policy, graph, ['typecheck', 'unit', 'e2e']);
  expect(result.required_set).toEqual(['e2e', 'typecheck', 'unit']);
  expect(result.selected_tests).toEqual([{ id: 'required-flow', sources: ['task'] }]);
  expect(result.status).toBe('INCOMPLETE');
  expect(result.coverage_gaps).toContainEqual(expect.objectContaining({ workspace: 'api' }));
});
