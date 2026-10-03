import {expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {ProbeDeclaration} from '../../../packages/contracts/src/index.js';
import {
  JsonResponseError,
  evaluateAssertion,
  evaluateDeclaration,
  jsonRootKind,
  parseJsonResponse,
  parsePointer,
} from '../../../packages/core/src/services/probe-assertions.js';

// V2-R04. The behaviour is defined by one shared table that the Python helper reads too
// (tests/contract/probe-assertions-parity.test.ts), so this file pins the TypeScript half of it and adds the
// cases only the core side can express: prototype objects, the strict parse entry and the declaration path.
const fixturePath = path.resolve('tests/fixtures/v2-regressions/assertions.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  assertion_cases: {name: string; body: string; pointer: string; operator: string; expected?: unknown;
    expected_passed: boolean; expected_reason: string | null}[];
  parse_cases: {name: string; body?: string; body_hex?: string; max_bytes?: number; max_depth?: number;
    expected_status: 'parsed' | 'refused'; expected_reason: string | null; expected_root: string | null}[];
};

const declaration = JSON.parse(readFileSync('examples/contract-drift-demo/probes/performance.json', 'utf8')) as ProbeDeclaration;

/** The harness-side classification of a parsed root, so parity compares like for like with the Python rows. */
function classifyRoot(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'object': return 'object';
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    default: return 'absent';
  }
}

function assertionOf(case_: (typeof fixture.assertion_cases)[number]) {
  return {assertion_id: case_.name, pointer: case_.pointer, operator: case_.operator,
    ...('expected' in case_ ? {expected: case_.expected} : {})} as unknown as ProbeDeclaration['assertions'][number];
}

/** Assertion bodies are read with the plain JSON parser on purpose, below the strict gate. */
function evaluateCase(case_: (typeof fixture.assertion_cases)[number]) {
  return evaluateAssertion(JSON.parse(case_.body) as unknown, assertionOf(case_));
}

function parseCase(case_: (typeof fixture.parse_cases)[number]) {
  const bytes = case_.body_hex !== undefined
    ? Buffer.from(case_.body_hex, 'hex')
    : Buffer.from(case_.body ?? '', 'utf8');
  const limits = {
    ...(case_.max_bytes === undefined ? {} : {max_bytes: case_.max_bytes}),
    ...(case_.max_depth === undefined ? {} : {max_depth: case_.max_depth}),
  };
  try {
    return {status: 'parsed' as const, reason: null, root: classifyRoot(parseJsonResponse(bytes, limits))};
  } catch (error) {
    if (!(error instanceof JsonResponseError)) throw error;
    return {status: 'refused' as const, reason: error.reason, root: 'absent'};
  }
}

// The four lines the task card names as the contract, kept verbatim in a file that builds these fixtures.
it('refuses inherited prototype members, reads an own field of the same name and refuses a non-finite number', () => {
  expect(evaluateAssertion(JSON.parse('{}'), {assertion_id: 'a', pointer: '/constructor', operator: 'exists'}).passed).toBe(false);
  expect(evaluateAssertion(JSON.parse('{"constructor":0}'), {assertion_id: 'a', pointer: '/constructor', operator: 'exists'}).passed).toBe(true);
  expect(evaluateAssertion({value: Infinity}, {assertion_id: 'b', pointer: '/value', operator: 'type', expected: 'number'}).passed).toBe(false);
  expect(() => parseJsonResponse(Buffer.from('{"value":1e400}'))).toThrow();
});

it('does not let a prototype chain answer for the document', () => {
  const inherited = Object.create({constructor: 'inherited', toString: 'inherited', polluted: true}) as Record<string, unknown>;
  expect(evaluateAssertion(inherited, {assertion_id: 'i', pointer: '/constructor', operator: 'exists'}).passed).toBe(false);
  expect(evaluateAssertion(inherited, {assertion_id: 'i', pointer: '/toString', operator: 'exists'}).passed).toBe(false);
  expect(evaluateAssertion(inherited, {assertion_id: 'i', pointer: '/polluted', operator: 'exists'}).passed).toBe(false);
  // The same name does become readable the moment it is an own member, which is why there is no keyword list.
  const own = Object.assign(Object.create({constructor: 'inherited', toString: 'inherited'}) as Record<string, unknown>,
    {constructor: 'own', toString: 'own'});
  expect(evaluateAssertion(own, {assertion_id: 'i', pointer: '/constructor', operator: 'equals', expected: 'own'}))
    .toEqual({assertion_id: 'i', passed: true, reason: null});
});

it('parses a response body and then reads only its own fields', () => {
  const document = parseJsonResponse(Buffer.from('{"constructor":0,"data":{"period":"2026-Q3"}}', 'utf8')) as object;
  expect(Object.hasOwn(document, 'constructor')).toBe(true);
  expect(evaluateAssertion(document, {assertion_id: 'p', pointer: '/constructor', operator: 'type', expected: 'number'})
    .passed).toBe(true);
  expect(evaluateAssertion(document, {assertion_id: 'p', pointer: '/__proto__/polluted', operator: 'exists'})
    .passed).toBe(false);
  expect(evaluateAssertion(document, {assertion_id: 'p', pointer: '/data/period', operator: 'equals', expected: '2026-Q3'})
    .passed).toBe(true);
});

it('keeps the strict parse bounds it advertises', () => {
  expect(() => parseJsonResponse(Buffer.from('{"a":1}', 'utf8'), {max_bytes: 4}))
    .toThrowError(JsonResponseError);
  try {
    parseJsonResponse(Buffer.from('{"a":1}', 'utf8'), {max_bytes: 4});
    expect.unreachable('a body over the byte budget must not parse');
  } catch (error) {
    expect((error as JsonResponseError).reason).toBe('RESPONSE_BODY_OVER_BUDGET');
  }
  // The 1 MiB default is the same ceiling the declaration schema allows for a response.
  expect(parseJsonResponse(Buffer.from('null', 'utf8'))).toBe(null);
});

it('decodes pointer escapes in one pass so a doubled escape is a key and not a second escape', () => {
  expect(parsePointer('/~01')).toEqual({ok: true, tokens: ['~1']});
  expect(parsePointer('/~0~1')).toEqual({ok: true, tokens: ['~/']});
  expect(parsePointer('/')).toEqual({ok: true, tokens: ['']});
  expect(parsePointer('//x')).toEqual({ok: true, tokens: ['', 'x']});
  expect(parsePointer('/~2')).toEqual({ok: false, reason: 'POINTER_ESCAPE_INVALID'});
  expect(parsePointer('')).toEqual({ok: false, reason: 'POINTER_INVALID'});
});

it.each(fixture.assertion_cases)('assertion $name', case_ => {
  const outcome = evaluateCase(case_);
  expect(outcome.assertion_id).toBe(case_.name);
  expect(outcome.passed, `${case_.name}: ${JSON.stringify(outcome)}`).toBe(case_.expected_passed);
  expect(outcome.reason).toBe(case_.expected_reason);
});

it.each(fixture.parse_cases)('parse $name', case_ => {
  const observed = parseCase(case_);
  expect(observed.status, `${case_.name}: ${JSON.stringify(observed)}`).toBe(case_.expected_status);
  expect(observed.reason).toBe(case_.expected_reason);
  if (case_.expected_status === 'parsed') expect(observed.root).toBe(case_.expected_root);
});

it('separates a body that was not JSON from one that is JSON with an addressable root', () => {
  const evaluated = (document: unknown) => evaluateDeclaration(declaration, document,
    {status_code: 200, media_type: 'application/json', truncated: false});
  const objectRoot = evaluated(JSON.parse('{"data":{"performance":{"total_return":0.1234,"period":"2026-Q3"}}}') as unknown);
  expect(objectRoot).toMatchObject({status_ok: true, media_type_ok: true, body_parseable: true, root_kind: 'object', failed: 0});
  expect(objectRoot.diagnostics).toEqual([]);

  const arrayRoot = evaluated([1, 2]);
  expect(arrayRoot.body_parseable).toBe(true);
  expect(arrayRoot.root_kind).toBe('array');
  expect(arrayRoot.diagnostics, 'an array root is addressable, so it is not an unsupported shape').not.toContain('RESPONSE_BODY_ROOT_UNSUPPORTED');

  // A `null` or scalar root is a parse fact, not "not JSON": the parse gate accepted it and said what it is.
  for (const [document, kind] of [[null, 'null'], [42, 'number'], ['text', 'string'], [false, 'boolean']] as (readonly [unknown, string])[]) {
    const scalarRoot = evaluated(document);
    expect(scalarRoot.body_parseable, `a ${kind} root is parseable JSON`).toBe(true);
    expect(scalarRoot.diagnostics).not.toContain('RESPONSE_BODY_NOT_JSON');
    expect(scalarRoot.diagnostics).toContain('RESPONSE_BODY_ROOT_UNSUPPORTED');
    expect(scalarRoot.outcomes.every(outcome => outcome.reason === 'POINTER_NOT_FOUND')).toBe(true);
  }

  const notDocument = evaluated(undefined);
  expect(notDocument.body_parseable).toBe(false);
  expect(notDocument.root_kind).toBe('absent');
  expect(notDocument.diagnostics).toContain('RESPONSE_BODY_NOT_JSON');
});

it('reports a non-finite number in the document instead of leaving it to the assertions', () => {
  const evaluated = evaluateDeclaration(declaration, JSON.parse('{"data":{"performance":{"total_return":1e400,"period":"2026-Q3"}}}') as unknown,
    {status_code: 200, media_type: 'application/json', truncated: false});
  expect(evaluated.diagnostics).toContain('JSON_NUMBER_NOT_FINITE');
  expect(evaluated.failed).toBeGreaterThan(0);
  expect(evaluated.outcomes.find(outcome => outcome.assertion_id === 'total-return-type')?.reason).toBe('TYPE_MISMATCH');
  expect(evaluated.outcomes.find(outcome => outcome.assertion_id === 'period-present')?.passed).toBe(true);
});

it('keeps the policy and artifact diagnostics it already reported', () => {
  const observed = {status_code: 500, media_type: 'text/plain', truncated: true};
  const evaluated = evaluateDeclaration(declaration, {data: {performance: {total_return: 0.1234, period: '2026-Q3'}}}, observed);
  expect(evaluated.status_ok).toBe(false);
  expect(evaluated.media_type_ok).toBe(false);
  expect(evaluated.diagnostics).toEqual(expect.arrayContaining(
    ['ARTIFACT_BUDGET_EXCEEDED', 'STATUS_MISMATCH', 'MEDIA_TYPE_MISMATCH']));
  const oversized = evaluateDeclaration({...declaration, max_response_bytes: 2 * 1024 * 1024}, {a: 1},
    {status_code: 200, media_type: 'application/json', truncated: false});
  expect(oversized.diagnostics).toContain('RESPONSE_BUDGET_OUT_OF_RANGE');
});

it('classifies the root the way the declaration path reports it', () => {
  expect(jsonRootKind(null)).toBe('null');
  expect(jsonRootKind([])).toBe('array');
  expect(jsonRootKind({})).toBe('object');
  expect(jsonRootKind('x')).toBe('string');
  expect(jsonRootKind(1)).toBe('number');
  expect(jsonRootKind(true)).toBe('boolean');
  expect(jsonRootKind(undefined)).toBe('absent');
  expect(jsonRootKind(() => undefined)).toBe('absent');
});
