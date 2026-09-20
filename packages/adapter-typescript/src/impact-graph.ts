export type ImpactConfidence = 'EXPLICIT' | 'GENERATED' | 'STATIC_CANDIDATE';
export type ImpactNodeKind = 'operation' | 'client' | 'module' | 'test' | 'workspace';
export interface ImpactNode { id: string; kind: ImpactNodeKind; reference: string }
export interface ImpactEdge { from: string; to: string; origin: string; confidence: ImpactConfidence }
export interface ImpactAssociation {
  operation_key: string; consumer_paths: string[]; check_ids: string[]; test_ids: string[];
  workspace: string; origin: string; confidence: ImpactConfidence;
}
export interface ImpactGap {
  kind: 'path' | 'operation' | 'check' | 'test' | 'workspace' | 'dynamic-call' | 'import' | 'configuration' | 'scope';
  reference: string; workspace: string; origin: string; reason: string; operation_key?: string;
}
export interface ImpactSelection { id: string; sources: string[] }
export interface ImpactGraph {
  nodes: ImpactNode[]; edges: ImpactEdge[]; known: ImpactAssociation[]; candidate: ImpactAssociation[];
  unresolved: ImpactGap[]; selected_checks: ImpactSelection[]; selected_tests: ImpactSelection[];
}
export interface MappingInventory {
  operation_keys: readonly string[]; paths: readonly string[]; check_ids: readonly string[];
  test_ids: readonly string[]; workspaces: readonly string[];
}
export function emptyImpactGraph(): ImpactGraph {
  return { nodes: [], edges: [], known: [], candidate: [], unresolved: [], selected_checks: [], selected_tests: [] };
}
export function addNode(graph: ImpactGraph, kind: ImpactNodeKind, reference: string): string {
  const id = `${kind}:${reference}`;
  if (!graph.nodes.some(node => node.id === id)) graph.nodes.push({ id, kind, reference });
  return id;
}
export function addSelection(target: ImpactSelection[], id: string, source: string): void {
  const selected = target.find(item => item.id === id);
  if (!selected) target.push({ id, sources: [source] });
  else if (!selected.sources.includes(source)) selected.sources.push(source);
}
