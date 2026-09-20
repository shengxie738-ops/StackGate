import ts from 'typescript';
import { isRelativePath, parseOperationKey } from '../../contracts/src/identifiers.js';
import { addNode, emptyImpactGraph, type ImpactGraph } from './impact-graph.js';
import { importSpecifiers, resolveStaticImport, type StaticCompilerOptions } from './imports.js';
import { literalCalls, type WrapperCall } from './literal-calls.js';
export interface TypeScriptSource { path: string; workspace: string; content: string }
export interface TypeScriptScope { files: readonly TypeScriptSource[]; operation_keys: readonly string[]; changed_paths?: readonly string[]; wrapper_calls?: readonly WrapperCall[] }
export interface StaticImpactResult extends ImpactGraph { affected_modules: string[]; limitations: string[] }

/** Uses only caller-supplied bytes: no ts.sys, config loading, plugin loading or evaluation. */
export function analyzeTypeScript(scope: TypeScriptScope, compiler_options: StaticCompilerOptions = {}): StaticImpactResult {
  const result: StaticImpactResult = { ...emptyImpactGraph(), affected_modules: [], limitations: ['Source parsing only; no plugins, type checking, module evaluation or complete call graph.', 'Only supplied workspace sources, static relative/alias imports, literal fetch and configured wrappers are supported.'] };
  const gap = (kind: ImpactGraph['unresolved'][number]['kind'], reference: string, workspace: string, origin: string, reason: string) => result.unresolved.push({ kind, reference, workspace, origin, reason });
  if (compiler_options.plugins !== undefined) gap('configuration', 'plugins', '*', 'compiler_options', 'Plugins are never loaded');
  if (compiler_options.extends !== undefined) gap('configuration', 'extends', '*', 'compiler_options', 'Inherited config is not loaded; supply resolved static fields');
  const paths = compiler_options.paths;
  if (paths && (typeof paths !== 'object' || Array.isArray(paths) || Object.entries(paths).some(([key, values]) => key.split('*').length > 2 || !Array.isArray(values) || !values.every(value => typeof value === 'string' && value.split('*').length <= 2)))) {
    gap('configuration', 'paths', '*', 'compiler_options', 'Only finite arrays of paths with at most one wildcard are supported');
    compiler_options = { ...compiler_options, paths: {} };
  }
  const files = new Set(scope.files.map(file => file.path));
  const reverseImports = new Map<string, string[]>();
  const operations = scope.operation_keys.map(key => ({ key, ...parseOperationKey(key) }));
  for (const file of scope.files) {
    if (!isRelativePath(file.path) || !/\.(?:[cm]?ts|tsx)$/.test(file.path) || file.content.length > 2 * 1024 * 1024) { gap('scope', file.path, file.workspace, file.path, 'Unsupported source path, language or size'); continue; }
    const parsed = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    // Parse diagnostics are present on the parser result but not exported in SourceFile's public interface.
    if ((parsed as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) gap('scope', file.path, file.workspace, file.path, 'Source contains parse errors; associations are incomplete');
    const module = addNode(result, 'module', file.path);
    for (const specifier of importSpecifiers(parsed)) {
      const resolved = resolveStaticImport(specifier, file.path, files, compiler_options);
      if (!resolved) gap('import', specifier, file.workspace, file.path, 'Module not uniquely resolved within the supplied source inventory');
      else {
        result.edges.push({ from: addNode(result, 'module', resolved), to: module, origin: `import:${file.path}:${specifier}`, confidence: 'STATIC_CANDIDATE' });
        reverseImports.set(resolved, [...(reverseImports.get(resolved) ?? []), file.path]);
      }
    }
    for (const call of literalCalls(parsed, scope.wrapper_calls ?? [])) {
      const origin = `${file.path}:${call.line}:${call.callee}`;
      if (call.reason || !call.url?.startsWith('/') || call.url.startsWith('//')) { gap('dynamic-call', call.callee, file.workspace, origin, call.reason ?? 'URL is not a same-origin absolute literal path'); continue; }
      const urlPath = call.url.split(/[?#]/)[0];
      const matches = operations.filter(operation => operation.method === call.method && operation.path === urlPath);
      if (matches.length !== 1) { gap('dynamic-call', call.url, file.workspace, origin, 'Operation is absent or ambiguous across services'); continue; }
      const operation = matches[0]!;
      result.candidate.push({ operation_key: operation.key, consumer_paths: [file.path], check_ids: [], test_ids: [], workspace: file.workspace, origin, confidence: 'STATIC_CANDIDATE' });
      result.edges.push({ from: addNode(result, 'operation', operation.key), to: module, origin, confidence: 'STATIC_CANDIDATE' });
    }
  }
  const affected = new Set(scope.changed_paths ?? []);
  const queue = [...affected];
  for (let index = 0; index < queue.length; index++) for (const consumer of reverseImports.get(queue[index]!) ?? []) if (!affected.has(consumer)) { affected.add(consumer); queue.push(consumer); }
  result.affected_modules = [...affected].filter(file => files.has(file)).sort();
  return result;
}
