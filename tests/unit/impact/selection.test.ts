import { describe, expect, it } from 'vitest';
import { selectChecks } from '../../../packages/core/src/domain/select-checks.js';
import { aggregateImpacts } from '../../../packages/core/src/domain/aggregate-impacts.js';
import { emptyImpactGraph, type ImpactGraph } from '../../../packages/adapter-typescript/src/impact-graph.js';
const task = { required_checks: ['e2e'], required_test_ids: ['flow-visible'] };
const policy = { required_set: ['types'], optional_failure_policy: 'incomplete' as const };
const unknown = (): ImpactGraph => ({ ...emptyImpactGraph(), unresolved: [{ kind: 'dynamic-call', reference: 'fetch', workspace: 'web', origin: 'web/page.ts:1', reason: 'Dynamic URL' }] });
describe('conservative check selection', () => {
  it('preserves task and policy checks even with no changes or mapping', () => {
    const selected = selectChecks(task, policy, emptyImpactGraph(), ['e2e', 'types']);
    expect(selected.required_set).toEqual(['e2e', 'types']);
    expect(selected.selected_tests).toEqual([{ id: 'flow-visible', sources: ['task'] }]);
    expect(selected.status).toBe('READY');
    expect(selected.optional_failure_policy).toBe('incomplete');
  });
  it('adds confirmed workspace regression while retaining original analysis gaps', () => {
    const graph = unknown();
    const selected = selectChecks(task, { ...policy, workspace_regression: { web: ['web-regression'] } }, graph, ['e2e', 'types', 'web-regression']);
    expect(selected.required_set).toEqual(['e2e', 'types', 'web-regression']);
    expect(selected.analysis_gaps).toEqual(graph.unresolved);
    expect(selected.coverage_gaps).toEqual([]);
    expect(selected.selected_checks.find(check => check.id === 'web-regression')!.sources).toContain('workspace-regression:web');
  });
  it('requires incomplete coverage when unknown impact has no usable regression set', () => {
    const selected = selectChecks(task, policy, unknown(), ['e2e', 'types']);
    expect(selected.status).toBe('INCOMPLETE');
    expect(selected.coverage_gaps).toContainEqual(expect.objectContaining({ workspace: 'web', reason: 'No confirmed workspace regression set' }));
    expect(selected.analysis_gaps).toHaveLength(1);
  });
  it('deduplicates mapped checks and test IDs without losing any provenance', () => {
    const graph = { ...emptyImpactGraph(), selected_checks: [{ id: 'e2e', sources: ['api:GET /a', 'api:POST /a'] }], selected_tests: [{ id: 'flow-visible', sources: ['api:GET /a'] }] };
    const selected = selectChecks(task, policy, graph, ['e2e', 'types']);
    expect(selected.required_set).toEqual(['e2e', 'types']);
    expect(selected.selected_checks.find(check => check.id === 'e2e')!.sources).toEqual(['api:GET /a', 'api:POST /a', 'task']);
    expect(selected.selected_tests[0]!.sources).toEqual(['api:GET /a', 'task']);
  });
  it('retains missing required IDs and rejects unavailable regression checks', () => {
    const selected = selectChecks(task, { ...policy, workspace_regression: { web: ['missing-regression'] } }, unknown(), ['types']);
    expect(selected.required_set).toContain('e2e');
    expect(selected.required_set).toContain('missing-regression');
    expect(selected.status).toBe('INCOMPLETE');
    expect(selected.coverage_gaps.map(gap => gap.reference)).toEqual(expect.arrayContaining(['e2e', 'missing-regression']));
  });
  it('aggregates distinct sources and flags changed operations without reliable mappings', () => {
    const first = unknown(), second = unknown();
    second.unresolved[0]!.origin = 'web/other.ts:2';
    const graph = aggregateImpacts([first, second], ['api:GET /unknown']);
    expect(graph.unresolved).toHaveLength(3);
    expect(graph.unresolved).toContainEqual(expect.objectContaining({ kind: 'operation', operation_key: 'api:GET /unknown', workspace: '*' }));
    const selected = selectChecks(task, { ...policy, workspace_regression: { web: ['web-all'], api: ['api-all'] } }, graph, ['e2e', 'types', 'web-all', 'api-all']);
    expect(selected.required_set).toEqual(['api-all', 'e2e', 'types', 'web-all']);
  });
});
