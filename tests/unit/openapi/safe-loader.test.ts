import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadContract } from '../../../packages/adapter-oasdiff/src/load-contract.js';
import { inspectSupportedSchema } from '../../../packages/adapter-oasdiff/src/supported-schema.js';
import { resolveOperationScope } from '../../../packages/adapter-oasdiff/src/operation-scope.js';

function contract(schema: any = { type: 'number' }): any {
  return { openapi: '3.1.1', info: { title: 'fixture', version: '1' }, paths: { '/value': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema } } } } } } } };
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const load = (value: unknown) => loadContract(bytes(value), 'test-contract');
const capability = (schema: any) => inspectSupportedSchema(load(contract(schema)));

describe('SG019 strict OpenAPI boundary', () => {
  it('loads retained contract raw bytes without normalizing the raw hash', async () => {
    const data = await readFile('tests/fixtures/contracts/target.json');
    const result = loadContract(data, 'retained-target');
    expect(result.supported).toBe(true);
    expect(result.raw_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.raw_hash).not.toBe(loadContract(Buffer.concat([data, Buffer.from(' ')]), 'same').raw_hash);
    expect(inspectSupportedSchema(result).supported).toBe(true);
    expect(result.operations.map((operation) => operation.key)).toEqual(['GET /api/performance']);
  });
  it.each([
    '{"openapi":"3.1.1","openapi":"3.0.3"}',
    'openapi: 3.1.1\nopenapi: 3.1.0',
    'openapi: !custom 3.1.1',
    'a: &a [1]\nb: *a',
    '{"a":',
  ])('rejects ambiguous or malformed documents: %s', (text) => {
    expect(loadContract(Buffer.from(text), 'invalid').supported).toBe(false);
  });
  it.each([null, [], {}, { openapi: '3.0.3', info: {}, paths: {} }, { ...contract(), openapi: '3.1.bad' }, { ...contract(), info: {} }, { ...contract(), paths: [] }])('rejects invalid OpenAPI document basics', (document) => {
    const loaded = load(document);
    expect(loaded.supported).toBe(false);
    expect(loaded.diagnostics.length).toBeGreaterThan(0);
    expect(inspectSupportedSchema(loaded).verdict).toBe('INCOMPLETE');
  });
  it('accepts strict YAML and preserves trailing slash and path-parameter spelling', () => {
    const document = contract(); document.paths['/value/{Id}/'] = document.paths['/value']; delete document.paths['/value'];
    expect(load(document).operations[0]?.key).toBe('GET /value/{Id}/');
    const yaml = 'openapi: 3.1.0\ninfo: {title: fixture, version: "1"}\npaths: {}\n';
    expect(loadContract(Buffer.from(yaml), 'yaml').supported).toBe(true);
  });
  it('denies external HTTP refs in unused components without a single request', async () => {
    let requests = 0;
    const server = createServer((request, response) => { requests++; response.end(request.url); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw Error('No listener');
      const document = contract(); document.components = { schemas: { Unused: { $ref: `http://127.0.0.1:${address.port}/secret` } } };
      const result = load(document);
      expect(result.supported).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.location === '/components/schemas/Unused/$ref')).toBe(true);
      expect(requests).toBe(0);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it.each(['other.json#/schema', 'file:///secret', '//host/path', 'http://example.invalid/schema', '#not-a-pointer', '#/%ZZ', 17])('rejects external or invalid refs %s', (ref) => {
    const result = load(contract({ $ref: ref }));
    expect(result.supported).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.location.endsWith('/$ref'))).toBe(true);
  });
  it('identifies a missing fragment at the referring pointer', () => {
    const result = load(contract({ $ref: '#/components/schemas/Missing' }));
    expect(result.supported).toBe(false);
    expect(result.diagnostics[0]?.location).toBe('/paths/~1value/get/responses/200/content/application~1json/schema/$ref');
  });
  it('resolves escaped and percent-encoded local pointers recursively', () => {
    const document = contract({ $ref: '#/components/schemas/A~1B' });
    document.components = { schemas: { 'A/B': { $ref: '#/components/schemas/Spaced%20Name' }, 'Spaced Name': { type: 'number' } } };
    const loaded = load(document);
    expect(loaded.supported).toBe(true);
    expect(inspectSupportedSchema(loaded).supported).toBe(true);
  });
  it('diagnoses recursive and dynamic reference constructs', () => {
    const document = contract({ $ref: '#/components/schemas/A' });
    document.components = { schemas: { A: { type: 'object', properties: { next: { $ref: '#/components/schemas/A' } } } } };
    const loaded = load(document);
    expect(loaded.supported).toBe(false);
    expect(loaded.diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_SCHEMA')).toBe(true);
    expect(load(contract({ $dynamicRef: '#x' })).supported).toBe(false);
  });
  it('enforces byte, depth and reference traversal bounds', () => {
    expect(loadContract(bytes(contract()), 'small', { maxBytes: 20 }).supported).toBe(false);
    expect(loadContract(bytes(contract()), 'shallow', { maxDepth: 3 }).supported).toBe(false);
    const document = contract({ $ref: '#/components/schemas/A' }); document.components = { schemas: { A: { $ref: '#/components/schemas/B' }, B: { type: 'number' } } };
    expect(loadContract(bytes(document), 'refs', { maxRefVisits: 1 }).supported).toBe(false);
  });
  it.each([
    { type: 'number' }, { type: 'integer' }, { type: 'boolean' }, { type: 'null' },
    { type: ['number', 'null'] }, { anyOf: [{ type: 'number' }, { type: 'null' }] },
    { type: 'string', enum: ['a', 'b'] },
    { type: 'array', items: { type: 'number' } },
    { type: 'object', required: ['id'], properties: { id: { type: 'string', readOnly: true }, password: { type: 'string', writeOnly: true } }, additionalProperties: false },
  ])('supports the explicit basic schema subset %j', (schema) => {
    expect(capability(schema)).toMatchObject({ supported: true, verdict: 'SUPPORTED' });
  });
  it.each([
    { oneOf: [{ type: 'number' }, { type: 'string' }] }, { allOf: [{ type: 'number' }] },
    { anyOf: [{ type: 'number' }, { type: 'string' }] }, { type: ['number', 'string'] },
    { type: 'string', format: 'unregistered-format' }, { type: 'string', pattern: '[a-z]' },
    { type: 'number', default: 5 }, { type: 'number', example: 5 },
    { if: { type: 'string' }, then: { minLength: 1 } },
    { type: 'number', madeUpKeyword: true }, { $schema: 'https://example.invalid/dialect', type: 'number' },
    { type: 'array' }, { type: 'object', additionalProperties: { type: 'number' } },
    { type: 'string', readOnly: 'yes' }, { type: 'object', required: ['absent'], properties: {} },
    { type: 'number', enum: ['wrong-type'] }, { type: 'integer', enum: [1.5] },
    { type: 'number', anyOf: [{ type: 'object' }, { type: 'null' }] },
  ])('does not silently pass untested schema constructs %j', (schema) => {
    const result = capability(schema);
    expect(result).toMatchObject({ supported: false, verdict: 'INCOMPLETE' });
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_SCHEMA' && diagnostic.location.includes('/schema'))).toBe(true);
  });
  it('limits schema inspection to known selected operations but expands unknown scope', () => {
    const document = contract(); document.paths['/other'] = { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { oneOf: [{ type: 'string' }, { type: 'number' }] } } } } } } };
    const loaded = load(document);
    expect(inspectSupportedSchema(loaded, ['GET /value']).supported).toBe(true);
    expect(inspectSupportedSchema(loaded, ['GET /unknown'])).toMatchObject({ supported: false, conservative: true });
    expect(resolveOperationScope(loaded, []).operation_scope).toEqual(['GET /other', 'GET /value']);
  });
  it('does not decode literal percent escapes in operation paths during scope inspection', () => {
    const document = contract({ type: 'string', format: 'unknown' });
    document.paths['/literal%2Fvalue'] = document.paths['/value']; delete document.paths['/value'];
    const loaded = load(document);
    expect(loaded.operations[0]?.key).toBe('GET /literal%2Fvalue');
    expect(inspectSupportedSchema(loaded).supported).toBe(false);
  });
  it('inspects shared parameters and recursively referenced schemas for the chosen operation', () => {
    const document = contract(); document.paths['/value'].parameters = [{ in: 'query', name: 'x', schema: { $ref: '#/components/schemas/Bad' } }];
    document.components = { schemas: { Bad: { type: 'string', format: 'unknown' } } };
    const result = inspectSupportedSchema(load(document), ['GET /value']);
    expect(result.supported).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.location === '/components/schemas/Bad/format')).toBe(true);
  });
  it.each([
    { responses: { '200': { description: 'ok', content: { 'application/json': {} } } } },
    { responses: { '200': { description: 'ok', content: { 'text/plain': { schema: { type: 'string' } } } } } },
    { responses: { '200': { description: 'ok' } }, parameters: 'invalid' },
    { responses: { '200': { description: 'ok' } }, parameters: [{ in: 'query', name: 'x', schema: { type: 'string' }, required: 'yes' }] },
  ])('rejects malformed or unsupported request/response envelopes', (operation) => {
    const document = contract(); document.paths['/value'].get = operation;
    expect(inspectSupportedSchema(load(document)).supported).toBe(false);
  });
});

