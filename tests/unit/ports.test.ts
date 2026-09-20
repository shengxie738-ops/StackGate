import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { AdapterCapabilities, RunEvent } from '../../packages/contracts/src/index.js';
import { negotiateCapabilities } from '../../packages/core/src/domain/negotiate-capabilities.js';
import { reduceEvents } from '../../packages/core/src/domain/reduce-events.js';
import { FakeAdapter } from '../support/fake-adapters.js';
import { withTestDirectory } from '../support/test-paths.js';

const capabilities: AdapterCapabilities = { schema_version: '0.1', adapter_id: 'openapi', version: '1.0.0', platforms: ['win32'], schema_dialects: ['openapi-3.1'], schema_features: ['type', 'required'], evidence_formats: ['contract-json-0.1'], provenance_levels: ['OBSERVED'], status: 'SUPPORTED', limitations: [] };
const request = { adapter_id: 'openapi', version: '1.0.0', platform: 'win32' as const, schema_dialect: 'openapi-3.1', schema_features: ['type'], evidence_format: 'contract-json-0.1', minimum_provenance: 'OBSERVED' as const };
const started: RunEvent = { schema_version: '0.1', event_id: 'event_1', run_id: 'run_test', seq: 1, at: '2026-09-20T00:00:00Z', type: 'run.started', payload: { payload_version: '0.1', plan_id: 'plan_test', input_hash: 'a'.repeat(64) } };
const finished: RunEvent = { schema_version: '0.1', event_id: 'event_2', run_id: 'run_test', seq: 2, at: '2026-09-20T00:00:01Z', type: 'run.finalized', payload: { payload_version: '0.1', phase: 'COMPLETED', verdict: 'PASS' } };

it('negotiates only the declared exact adapter version, platform and dialect', () => {
  expect(negotiateCapabilities(capabilities, request)).toEqual({ supported: true, diagnostics: [] });
  for (const patch of [{ adapter_id: 'other' }, { version: '2.0.0' }, { platform: 'linux' as const }, { schema_dialect: 'openapi-3.0' }, { schema_features: ['oneOf'] }, { evidence_format: 'junit' }, { minimum_provenance: 'CONTROLLED' as const }]) {
    const result = negotiateCapabilities(capabilities, { ...request, ...patch });
    expect(result.supported, JSON.stringify(patch)).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('UNSUPPORTED_CAPABILITY');
  }
});
it.each(['UNKNOWN', 'UNSUPPORTED'] as const)('does not promote %s capabilities', status => {
  expect(negotiateCapabilities({ ...capabilities, status }, request).supported).toBe(false);
});
it('counts an identical fake event only once and preserves input objects', async () => {
  const events = [started, structuredClone(started), finished];
  const before = structuredClone(events);
  const adapter = new FakeAdapter(capabilities, events);
  const received = [];
  for await (const event of adapter.events()) received.push(event);
  const state = reduceEvents(received);
  expect(state.status).toBe('VALID');
  expect(state.events).toHaveLength(2);
  expect(state.next_seq).toBe(3);
  expect(events).toEqual(before);
});
it('compares duplicate event objects independently of JSON key insertion order', () => {
  const same = { ...started, payload: { input_hash: 'a'.repeat(64), plan_id: 'plan_test', payload_version: '0.1' as const } };
  expect(reduceEvents([started, same]).status).toBe('VALID');
});
it.each(([
  [started, { ...started, payload: { ...started.payload, plan_id: 'plan_other' } }],
  [{ ...started, seq: 0 }], [started, { ...finished, seq: 3 }],
  [started, { ...finished, run_id: 'run_other' }],
  [started, { ...finished, seq: 1 }],
] as RunEvent[][]).map(events => ({ events })))('rejects conflicting identities, noncontiguous sequence or mixed runs (%#)', ({ events }) => {
  const result = reduceEvents(events);
  expect(result.status).toBe('ERROR');
  expect(result.diagnostics[0]?.code).toBe('REPORT_INVALID');
});

const checker = path.resolve('scripts/verify-boundaries.mjs');
async function checkFixture(files: Record<string, string>) {
  return withTestDirectory(async root => {
    for (const [name, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), content); }
    return spawnSync(process.execPath, [checker, '--root', root], { encoding: 'utf8' });
  });
}
it.each([
  ['domain IO', 'packages/core/src/domain/bad.ts', "import { readFile } from 'node:fs/promises'; export const read = readFile;"],
  ['domain dynamic IO', 'packages/core/src/domain/bad.ts', "export const read = () => import('node:fs');"],
  ['domain time', 'packages/core/src/domain/bad.ts', 'export const now = () => Date.now();'],
  ['domain date constructor', 'packages/core/src/domain/bad.ts', 'export const now = () => new Date();'],
  ['domain environment', 'packages/core/src/domain/bad.ts', 'export const token = process.env.TOKEN;'],
  ['domain console IO', 'packages/core/src/domain/bad.ts', "export const compute = () => console.log('side effect');"],
  ['domain require alias', 'packages/core/src/domain/bad.ts', "const load = require; export const read = () => load('node:fs');"],
  ['domain indirect random', 'packages/core/src/domain/bad.ts', 'const { random } = Math; export const value = random();'],
  ['domain spread clock', 'packages/core/src/domain/bad.ts', 'export const now = (args: any[]) => new Date(...args);'],
  ['domain network', 'packages/core/src/domain/bad.ts', "export const data = () => fetch('https://example.com');"],
  ['test fake import', 'apps/cli/src/bad.ts', "export { FakeAdapter } from '../../../tests/support/fake-adapters.js';"],
  ['reporter runner', 'packages/reporters/src/bad.ts', "import type { RunnerPort } from '../../core/src/ports/runner.js'; export type Bad = RunnerPort;"],
  ['reporter execution', 'packages/reporters/src/bad.ts', 'export const render = (RunService: any) => RunService.execute();'],
  ['reporter computed execution', 'packages/reporters/src/bad.ts', "export const render = (service: any) => service['execute']();"],
  ['reporter destructured execution', 'packages/reporters/src/bad.ts', 'export const render = (service: any) => { const { execute: invoke } = service; return invoke(); };'],
])('runs the AST checker and rejects %s', async (_label, file, source) => {
  const result = await checkFixture({ [file]: source });
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toMatch(/boundary|forbidden/i);
});
it('rejects IO reached indirectly through a domain helper', async () => {
  const result = await checkFixture({ 'packages/core/src/domain/main.ts': "import { read } from '../helper.js'; export { read };", 'packages/core/src/helper.ts': "export { readFile as read } from 'node:fs';" });
  expect(result.status).toBe(1);
});
it('allows pure objects, type-only ports and words in comments or strings', async () => {
  const result = await checkFixture({ 'packages/core/src/domain/good.ts': "import type { Clock } from '../ports/clock.js'; export const compute = (input: number) => input + 1; export const label = 'process.env Date.now() node:fs'; // RunService.execute\nexport type Injected = Clock;", 'packages/core/src/ports/clock.ts': 'export interface Clock { now(): string }', 'packages/reporters/src/good.ts': "export const render = () => 'execute';" });
  expect(result.status, result.stderr).toBe(0);
});
