import {expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import type {HttpRequestPolicy, RequestAuthorizationInput} from '../../../packages/core/src/services/http-policy.js';
import {DEFAULT_HTTP_REQUEST_POLICY, authorizeRequest, normalizeOrigin} from '../../../packages/core/src/services/http-policy.js';
import {parseDeclaredOperation} from '../../../packages/core/src/services/operation-authorization.js';

const fixture = JSON.parse(readFileSync('tests/fixtures/v2-regressions/http-policy.json', 'utf8')) as {
  declaration: string; origin: string; path: string;
  cases: {name: string; path?: string; method?: string; origin?: string; allowed_origins?: string[];
    service_origins?: Record<string, string>; declared_operation_key?: string | null; policy?: Record<string, unknown>;
    expected_allowed: boolean; expected_reason: string | null}[];
};

/** Sentinels keep the table valid JSON while still carrying values JSON cannot express. */
function decode(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('__string__:')) return value.slice('__string__:'.length);
  if (value === '__nan__') return Number.NaN;
  if (value === '__infinity__') return Number.POSITIVE_INFINITY;
  if (value === '__negative_infinity__') return Number.NEGATIVE_INFINITY;
  return value;
}

function inputOf(case_: (typeof fixture.cases)[number]): RequestAuthorizationInput {
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(case_.policy ?? {})) overrides[key] = decode(value);
  const policy: HttpRequestPolicy = {...DEFAULT_HTTP_REQUEST_POLICY, allowed_origins: case_.allowed_origins ?? [fixture.origin], ...overrides} as HttpRequestPolicy;
  return {
    policy,
    origin: case_.origin ?? fixture.origin,
    method: case_.method ?? 'GET',
    path: case_.path ?? fixture.path,
    declared_operation_key: case_.declared_operation_key === undefined ? fixture.declaration : case_.declared_operation_key,
    ...(case_.service_origins ? {service_origins: case_.service_origins} : {}),
  };
}
function baselinePolicy(overrides: Record<string, unknown> = {}): HttpRequestPolicy {
  return {...DEFAULT_HTTP_REQUEST_POLICY, allowed_origins: [fixture.origin], ...overrides} as HttpRequestPolicy;
}

it('authorizes exactly the declared literal path and nothing else', () => {
  const policy = {...DEFAULT_HTTP_REQUEST_POLICY, allowed_origins: ['http://127.0.0.1:8000']};
  const input = {policy, origin: 'http://127.0.0.1:8000', method: 'GET', path: '/different-operation',
    declared_operation_key: 'api:GET /api/performance'} satisfies RequestAuthorizationInput;
  expect(authorizeRequest(input).allowed).toBe(false);
  expect(authorizeRequest({...input, path: '/api/performance', declared_operation_key: null}).allowed).toBe(false);
  expect(authorizeRequest({...input, path: '/api/performance#ignored'}).allowed).toBe(false);
  expect(authorizeRequest({...input, path: '/api/performance'}).allowed).toBe(true);
});

it.each(fixture.cases)('$name', case_ => {
  const decision = authorizeRequest(inputOf(case_));
  expect(decision.allowed, JSON.stringify(decision)).toBe(case_.expected_allowed);
  if (!case_.expected_allowed) {
    expect((decision as {reason?: string}).reason).toBe(case_.expected_reason);
  }
});

it('never lets a null declaration execute a business probe but still allows a registered health operation', () => {
  const health = 'monitor:GET /healthz';
  const denied = authorizeRequest({policy: baselinePolicy(), origin: fixture.origin, method: 'GET', path: '/healthz',
    declared_operation_key: null});
  expect(denied).toEqual({allowed: false, reason: 'DECLARATION_MISSING'});
  const allowed = authorizeRequest({policy: baselinePolicy(), origin: fixture.origin, method: 'GET', path: '/healthz',
    declared_operation_key: health});
  expect(allowed).toEqual({allowed: true});
});

it('binds the declared service to its confirmed origin instead of to any allowed origin', () => {
  const policy = baselinePolicy({allowed_origins: ['http://127.0.0.1:8000', 'http://127.0.0.1:8001']});
  const bindings = {api: 'http://127.0.0.1:8000', mirror: 'http://127.0.0.1:8001'};
  expect(authorizeRequest({policy, origin: 'http://127.0.0.1:8001', method: 'GET', path: '/api/performance',
    declared_operation_key: 'api:GET /api/performance', service_origins: bindings}))
    .toEqual({allowed: false, reason: 'SERVICE_ORIGIN_MISMATCH'});
  expect(authorizeRequest({policy, origin: 'http://127.0.0.1:8000', method: 'GET', path: '/api/performance',
    declared_operation_key: 'api:GET /api/performance', service_origins: bindings}))
    .toEqual({allowed: true});
  expect(authorizeRequest({policy, origin: 'http://127.0.0.1:8000', method: 'GET', path: '/api/performance',
    declared_operation_key: 'api:GET /api/performance', service_origins: {api: 'http://127.0.0.1:8000/'}}))
    .toEqual({allowed: true});
});

it('parses an operation key into the three fields it binds', () => {
  expect(parseDeclaredOperation('api:GET /api/performance')).toEqual({service_id: 'api', method: 'GET', path: '/api/performance'});
  for (const key of ['', 'api:GET', 'api: GET /x', 'GET /x', 'api:GET x', 'api:get /x', '1api:GET /x',
    'api:GET /x y', 'api:GETx', 'bad service!:GET /x', 'api:GETLY /x']) {
    expect(() => parseDeclaredOperation(key), `accepted key ${JSON.stringify(key)}`).toThrow(/OPERATION_KEY_INVALID/);
  }
  // The key grammar comes from the confirmed schema, so a grammatically valid key may still be unsupported.
  expect(parseDeclaredOperation('api:GET /a#b')).toEqual({service_id: 'api', method: 'GET', path: '/a#b'});
  expect(authorizeRequest({policy: baselinePolicy(), origin: fixture.origin, method: 'GET', path: '/a#b',
    declared_operation_key: 'api:GET /a#b'})).toEqual({allowed: false, reason: 'PATH_FRAGMENT_FORBIDDEN'});
  expect(authorizeRequest({policy: baselinePolicy(), origin: fixture.origin, method: 'GET', path: '/a?b',
    declared_operation_key: 'api:GET /a?b'})).toEqual({allowed: false, reason: 'PATH_QUERY_FORBIDDEN'});
});

it('normalizes the origin it compares and the origin it emits', () => {
  expect(normalizeOrigin('http://EXAMPLE.com')).toEqual({ok: true, value: {origin: 'http://example.com', host: 'example.com', port: null, loopback: false}});
  expect(normalizeOrigin('https://example.com:443')).toMatchObject({ok: true, value: {origin: 'https://example.com'}});
  expect(normalizeOrigin('http://127.0.0.1:8000/../x')).toMatchObject({ok: false, reason: 'ORIGIN_PATH_NOT_ALLOWED'});
});

it('reports the same decision and reason from the Python probe helper for every fixture case', async () => {
  const rows = await runPythonCaseTable();
  expect(rows.length).toBe(fixture.cases.length);
  for (const row of rows) {
    const expected = fixture.cases.find(case_ => case_.name === row.name);
    expect(expected, `python reported an unknown case ${row.name}`).toBeTruthy();
    expect(row.allowed, `${row.name}: ${row.reason}`).toBe(expected!.expected_allowed);
    if (!expected!.expected_allowed) expect(row.reason, row.name).toBe(expected!.expected_reason);
  }
}, 120000);

function runPythonCaseTable(): Promise<{name: string; allowed: boolean; reason: string | null}[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3',
      ['-B', '-E', path.resolve('tests/support/v2_http_policy_cases.py'), path.resolve('tests/fixtures/v2-regressions/http-policy.json')],
      {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error(`python case table exited ${code}: ${stderr}`));
      else resolve(JSON.parse(stdout) as {name: string; allowed: boolean; reason: string | null}[]);
    });
  });
}
