import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { analyzeTypeScript } from '../../../packages/adapter-typescript/src/program.js';

const source = (path: string, content: string) => ({ path, content, workspace: 'web' });
const operation_keys = ['api:GET /api/performance', 'api:POST /api/items'];
describe('bounded TypeScript impact analysis', () => {
  it('finds literal fetch and explicitly configured wrappers as candidates only', () => {
    const graph = analyzeTypeScript({ files: [source('web/page.ts', 'fetch("/api/performance"); apiPost("/api/items");')], operation_keys, wrapper_calls: [{ callee: 'apiPost', method: 'POST' }] });
    expect(graph.candidate.map(item => item.operation_key)).toEqual(operation_keys);
    expect(graph.known).toEqual([]);
    expect(graph.unresolved).toEqual([]);
    expect(graph.candidate.every(item => item.confidence === 'STATIC_CANDIDATE')).toBe(true);
  });
  it('preserves dynamic template, concatenated URL and injected-client uncertainty', () => {
    const graph = analyzeTypeScript({ files: [source('web/page.ts', 'fetch(base + dynamicPath); fetch(`/api/${id}`); service.get(path);')], operation_keys });
    expect(graph.candidate).toEqual([]);
    expect(graph.unresolved.filter(item => item.kind === 'dynamic-call')).toHaveLength(3);
  });
  it('tracks transitive imports and re-exports from a changed type file', () => {
    const graph = analyzeTypeScript({ files: [source('web/types.ts', 'export type Item = string;'), source('web/client.ts', 'export type { Item } from "./types";'), source('web/page.ts', 'import type { Item } from "./client";')], operation_keys, changed_paths: ['web/types.ts'] });
    expect(graph.affected_modules).toEqual(['web/client.ts', 'web/page.ts', 'web/types.ts']);
    expect(graph.edges.filter(item => item.origin.startsWith('import:'))).toHaveLength(2);
  });
  it('resolves finite static aliases but records unresolved aliases', () => {
    const graph = analyzeTypeScript({ files: [source('web/types.ts', 'export type Item = string;'), source('web/page.ts', 'import type { Item } from "@app/types"; import hidden from "@unknown/lib";')], operation_keys, changed_paths: ['web/types.ts'] }, { baseUrl: '.', paths: { '@app/*': ['web/*'] } });
    expect(graph.affected_modules).toEqual(['web/page.ts', 'web/types.ts']);
    expect(graph.unresolved).toContainEqual(expect.objectContaining({ kind: 'import', reference: '@unknown/lib' }));
  });
  it('never executes supplied plugins, extends or source code', async () => {
    const marker = '__STACKGATE_STATIC_SENTINEL__';
    const content = await readFile('tests/fixtures/ts-impact/unsafe.ts.txt', 'utf8');
    const graph = analyzeTypeScript({ files: [source('web/page.ts', content)], operation_keys }, { plugins: [{ name: './malicious-plugin.js' }], extends: './executable.js' });
    expect(Reflect.get(globalThis, marker)).toBeUndefined();
    expect(graph.unresolved.filter(item => item.kind === 'configuration')).toHaveLength(2);
    expect(graph.limitations).toContain('Source parsing only; no plugins, type checking, module evaluation or complete call graph.');
  });
  it('retains cross-language, malformed source, ambiguous services and unknown HTTP methods', () => {
    const graph = analyzeTypeScript({ files: [source('api/consumer.py', 'requests.get(path)'), source('web/broken.ts', 'const = ;'), source('web/page.ts', 'fetch("/api/performance"); fetch("/api/items", options);')], operation_keys: [...operation_keys, 'other:GET /api/performance'] });
    expect(graph.unresolved.some(item => item.kind === 'scope')).toBe(true);
    expect(graph.unresolved.filter(item => item.kind === 'dynamic-call')).toHaveLength(2);
    expect(graph.candidate).toEqual([]);
    expect(graph.selected_checks).toEqual([]);
  });
});
