import { validateSchema } from '../../contracts/src/validation.js';
import type { ConsumerMappings } from '../../contracts/src/generated/mappings.js';
import { ServiceError } from '../../core/src/services/service-error.js';
import { addNode, addSelection, emptyImpactGraph, type ImpactGraph, type MappingInventory, type ImpactGap } from './impact-graph.js';

/** The caller supplies an observed inventory, never inferred existence from a mapping. */
export function loadMappings(document: unknown, inventory: MappingInventory): ImpactGraph {
  const validated = validateSchema<ConsumerMappings>('mappings', document);
  if (!validated.ok) throw new ServiceError(64, validated.diagnostics);
  const graph = emptyImpactGraph();
  validated.value.mappings.forEach((mapping, index) => {
    const origin = `mappings[${index}]`;
    const before = graph.unresolved.length;
    const check = (kind: ImpactGap['kind'], reference: string, observed: readonly string[]) => {
      if (!observed.includes(reference)) graph.unresolved.push({ kind, reference, workspace: mapping.workspace, origin, operation_key: mapping.operation_key, reason: 'Reference missing from the supplied inventory' });
    };
    check('operation', mapping.operation_key, inventory.operation_keys);
    check('workspace', mapping.workspace, inventory.workspaces);
    const operation = addNode(graph, 'operation', mapping.operation_key);
    const workspace = addNode(graph, 'workspace', mapping.workspace);
    let source = operation;
    if (mapping.generated_client) {
      check('path', mapping.generated_client.path, inventory.paths);
      source = addNode(graph, 'client', mapping.generated_client.path);
      graph.edges.push({ from: operation, to: source, origin: mapping.generated_client.metadata_source, confidence: 'GENERATED' });
    }
    for (const consumer of mapping.consumer_paths) {
      check('path', consumer, inventory.paths);
      const module = addNode(graph, 'module', consumer);
      graph.edges.push({ from: source, to: module, origin, confidence: 'EXPLICIT' }, { from: module, to: workspace, origin, confidence: 'EXPLICIT' });
      for (const id of mapping.test_ids) graph.edges.push({ from: module, to: addNode(graph, 'test', id), origin, confidence: 'EXPLICIT' });
    }
    for (const id of mapping.check_ids) { check('check', id, inventory.check_ids); addSelection(graph.selected_checks, id, mapping.operation_key); }
    for (const id of mapping.test_ids) { check('test', id, inventory.test_ids); addSelection(graph.selected_tests, id, mapping.operation_key); }
    if (graph.unresolved.length === before) graph.known.push({ operation_key: mapping.operation_key, consumer_paths: [...mapping.consumer_paths], check_ids: [...mapping.check_ids], test_ids: [...mapping.test_ids], workspace: mapping.workspace, origin, confidence: 'EXPLICIT' });
  });
  return graph;
}
