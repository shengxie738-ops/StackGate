import { describe, expect, it } from 'vitest';
import { loadMappings } from '../../../packages/adapter-typescript/src/explicit-mappings.js';

const inventory = {
  operation_keys: ['api:GET /items', 'api:POST /items'], paths: ['web/client.ts', 'web/page.tsx'],
  check_ids: ['browser'], test_ids: ['items-visible'], workspaces: ['web'],
};
const mapping = {
  operation_key: 'api:GET /items', consumer_paths: ['web/page.tsx'], check_ids: ['browser'],
  test_ids: ['items-visible'], workspace: 'web',
};
const document = (mappings = [mapping]) => ({ schema_version: '0.1', mappings });
describe('explicit consumer mappings', () => {
  it('retains a deleted consumer as unresolved and preserves its checks', () => {
    const graph = loadMappings(document(), { ...inventory, paths: [] });
    expect(graph.unresolved).toContainEqual(expect.objectContaining({ kind: 'path', reference: 'web/page.tsx', operation_key: mapping.operation_key, workspace: 'web' }));
    expect(graph.selected_checks).toEqual([{ id: 'browser', sources: [mapping.operation_key] }]);
    expect(graph.known).toHaveLength(0);
  });
  it('uses method/path identity independently of operationId changes', () => {
    const graph = loadMappings(document(), inventory);
    expect(graph.known).toHaveLength(1);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'operation:api:GET /items', to: 'module:web/page.tsx', confidence: 'EXPLICIT', origin: 'mappings[0]' }));
    expect(JSON.stringify(graph)).not.toMatch(/percentage|probability|coverage_percent/);
    expect(graph.unresolved).toEqual([]);
  });
  it('deduplicates tests while retaining each operation source', () => {
    const graph = loadMappings(document([mapping, { ...mapping, operation_key: 'api:POST /items' }]), inventory);
    expect(graph.selected_tests).toEqual([{ id: 'items-visible', sources: ['api:GET /items', 'api:POST /items'] }]);
    expect(graph.nodes.filter(node => node.kind === 'test')).toHaveLength(1);
  });
  it('reports all missing reference kinds explicitly', () => {
    const graph = loadMappings(document(), { operation_keys: [], paths: [], check_ids: [], test_ids: [], workspaces: [] });
    expect(graph.unresolved.map(gap => gap.kind).sort()).toEqual(['check', 'operation', 'path', 'test', 'workspace']);
    expect(graph.known).toHaveLength(0);
  });
  it('rejects invalid structures, unsafe paths and unknown fields without coercion', () => {
    for (const value of [document([{ ...mapping, operation_key: 'GET /items' }]), document([{ ...mapping, consumer_paths: ['../secret'] }]), { ...document(), silent: true }, document([{ ...mapping, workspace: 3 } as never])]) {
      expect(() => loadMappings(value, inventory)).toThrow();
    }
  });
  it('uses generated client metadata only when explicitly supplied', () => {
    const graph = loadMappings({ schema_version: '0.1', mappings: [{ ...mapping, generated_client: { path: 'web/client.ts', metadata_source: 'client-generator:v1' } }] }, inventory);
    expect(graph.nodes).toContainEqual({ id: 'client:web/client.ts', kind: 'client', reference: 'web/client.ts' });
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'operation:api:GET /items', to: 'client:web/client.ts', confidence: 'GENERATED', origin: 'client-generator:v1' }));
    expect(loadMappings(document(), inventory).nodes.some(node => node.kind === 'client')).toBe(false);
  });
});
