import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContract } from '../../packages/adapter-oasdiff/src/load-contract.js';
import { OasdiffAdapter } from '../../packages/adapter-oasdiff/src/tool.js';
import { parseBreakingResult } from '../../packages/adapter-oasdiff/src/breaking.js';
import { parseDiffResult } from '../../packages/adapter-oasdiff/src/diff.js';

const identity = { executable: resolve('tools/bin/oasdiff-1.32.1/oasdiff.exe'), expected_sha256: 'sha256:cce550834cddfa7584a5cfde8deb2a6a57effcbc445f040f4f7ac37da47e8173', expected_version: '1.32.1', trusted: true };
const fixture = async (name: string) => loadContract(await readFile(`tests/fixtures/contracts/${name}.json`), name);
const preparation = async (name: string) => loadContract(await readFile(`tests/fixtures/oasdiff/preparation/${name}.json`), name);
describe('SG020 real pinned oasdiff adapter', () => {
  it('retains real version, raw IDs, raw JSON, original hashes and business exit status', async () => {
    const base = await fixture('target'); const revised = await fixture('candidate-wrong');
    const result = await new OasdiffAdapter(identity).breaking(base, revised);
    expect(result.status).toBe('FAIL');
    expect(result.value?.[0]).toMatchObject({ raw_rule_id: 'response-property-type-changed', rule_id: 'SG-CONTRACT-TYPE_CHANGED', operation_key: 'GET /api/performance', severity: 'error' });
    expect(result.evidence[0]?.stdout.trim()).toBe('oasdiff version 1.32.1');
    expect(result.evidence.at(-1)?.exit_code).toBe(1);
    expect(result.evidence.at(-1)?.argv).toContain('--allow-external-refs=false');
    expect(result.evidence.at(-1)?.argv).toContain('--config');
    expect(JSON.parse(result.evidence.at(-1)!.stdout)[0].id).toBe('response-property-type-changed');
    expect(result.evidence.at(-1)?.base_hash).toBe(base.raw_hash);
    console.log(JSON.stringify({ fixture: 'type-change', status: result.status, evidence: result.evidence }));
  });
  it('returns PASS only from real empty valid breaking output', async () => {
    const result = await new OasdiffAdapter(identity).breaking(await fixture('target'), await fixture('candidate-correct'));
    expect(result.status).toBe('PASS'); expect(result.value).toEqual([]);
    expect(result.evidence.at(-1)?.stdout).toBe('[]\n');
  });
  it.each([
    ['target', 'candidate-missing', 'response-required-property-removed'],
    ['upgrade-baseline', 'upgrade-target', 'response-required-property-removed'],
  ])('maps real removed-property finding %s→%s', async (base, revised, id) => {
    const result = await new OasdiffAdapter(identity).breaking(await fixture(base), await fixture(revised));
    expect(result.status).toBe('FAIL'); expect(result.value?.some((finding) => finding.raw_rule_id === id)).toBe(true);
  });
  it.each([
    ['request-base', 'request-required', 'request-property-became-required'],
    ['enum-base', 'enum-revision', 'response-property-enum-value-added'],
  ])('preserves direction-dependent finding %s→%s', async (base, revised, id) => {
    const result = await new OasdiffAdapter(identity).breaking(await preparation(base), await preparation(revised));
    expect(result.status).toBe('FAIL'); expect(result.value?.some((finding) => finding.raw_rule_id === id)).toBe(true);
  });
  it('retains structural diff and distinguishes real empty diff', async () => {
    const adapter = new OasdiffAdapter(identity); const base = await fixture('target');
    const changed = await adapter.diff(base, await fixture('candidate-wrong'));
    expect(changed.status).toBe('FAIL'); expect(changed.value?.paths).toBeDefined();
    const same = await adapter.diff(base, await fixture('candidate-correct'));
    expect(same.status).toBe('PASS'); expect(same.value).toEqual({});
  });
  it('blocks missing tools without inventing empty findings', async () => {
    const result = await new OasdiffAdapter({ ...identity, executable: resolve('tools/bin/not-installed.exe') }).breaking(await fixture('target'), await fixture('candidate-correct'));
    expect(result.status).toBe('BLOCKED'); expect(result.value).toBeNull(); expect(result.evidence).toEqual([]);
  });
  it('requires trusted pinned identity and rejects digest changes before version execution', async () => {
    const base = await fixture('target');
    const denied = await new OasdiffAdapter({ ...identity, trusted: false }).breaking(base, base);
    expect(denied.status).toBe('BLOCKED'); expect(denied.evidence).toEqual([]);
    const mismatch = await new OasdiffAdapter({ ...identity, expected_sha256: '0'.repeat(64) }).breaking(base, base);
    expect(mismatch.status).toBe('ERROR'); expect(mismatch.evidence).toEqual([]);
  });
  it('blocks a mismatched tool version after preserving actual version evidence', async () => {
    const base = await fixture('target'); const result = await new OasdiffAdapter({ ...identity, expected_version: '1.0.0' }).breaking(base, base);
    expect(result.status).toBe('BLOCKED'); expect(result.evidence).toHaveLength(1);
  });
  it('rechecks mutated LoadedContract documents before any process including --version', async () => {
    const base = await fixture('target'); const unsafe = await fixture('candidate-correct');
    unsafe.document!.components = { schemas: { Unused: { $ref: 'http://127.0.0.1:1/no-network' } } };
    const result = await new OasdiffAdapter(identity).breaking(base, unsafe);
    expect(result.status).toBe('BLOCKED'); expect(result.evidence).toEqual([]);
  });
  it('rejects unsupported schema before even checking tool availability', async () => {
    const base = await fixture('target'); const revised = await fixture('candidate-correct');
    revised.document!.components = { schemas: { Unused: { $dynamicRef: '#not-supported' } } };
    const result = await new OasdiffAdapter({ ...identity, executable: resolve('missing.exe') }).breaking(base, revised);
    expect(result.status).toBe('BLOCKED'); expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_SCHEMA')).toBe(true);
  });
  it('does not attribute changed supported documents or forged hashes to original source bytes', async () => {
    const base = await fixture('target'); const target = await fixture('candidate-correct');
    target.document!.info = { title: 'mutated after loading', version: '2' };
    const changed = await new OasdiffAdapter(identity).breaking(base, target);
    expect(changed.status).toBe('BLOCKED'); expect(changed.evidence).toEqual([]);
    const forged = await fixture('candidate-correct'); forged.raw_hash = `sha256:${'1'.repeat(64)}`;
    expect((await new OasdiffAdapter(identity).breaking(base, forged)).status).toBe('BLOCKED');
  });
  it('bounds real tool output and keeps truncated evidence without returning PASS', async () => {
    const base = await fixture('target');
    const result = await new OasdiffAdapter({ ...identity, max_output_bytes: 5 }).breaking(base, base);
    expect(result.status).toBe('BLOCKED'); expect(result.evidence[0]?.interrupted).toBe('output-limit');
    expect(Buffer.byteLength(result.evidence[0]!.stdout)).toBeLessThanOrEqual(5);
  });
  it('does not expose absolute temporary paths in filesystem errors', async () => {
    const base = await fixture('target');
    const result = await new OasdiffAdapter({ ...identity, temp_root: resolve('tests/fixtures/oasdiff/private-path-canary-not-present') }).breaking(base, base);
    expect(result.status).toBe('ERROR');
    expect(result.evidence).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('private-path-canary');
    expect(result.diagnostics[0]?.observed_facts.system_error_code).toBe('ENOENT');
  });
  it('ignores inherited malicious oasdiff config environment', async () => {
    const previous = process.env.OASDIFF_CONFIG; process.env.OASDIFF_CONFIG = resolve('tests/fixtures/oasdiff/no-such-config.yaml');
    try { expect((await new OasdiffAdapter(identity).breaking(await fixture('target'), await fixture('candidate-wrong'))).status).toBe('FAIL'); }
    finally { if (previous === undefined) delete process.env.OASDIFF_CONFIG; else process.env.OASDIFF_CONFIG = previous; }
  });
});
describe('SG020 strict evidence interpretation', () => {
  const observed = (stdout: string, exit_code = 0) => ({ command: 'breaking' as const, argv: [], stdout, stderr: '', exit_code, signal: null, version: '1.32.1', executable_sha256: identity.expected_sha256 });
  it.each(['{}', 'null', '[{"newField":true}]', '[{"id":"response-property-type-changed","level":3}]', '[] trailing', '', '[{"id":"response-property-type-changed","id":"response-required-property-removed","text":"duplicate ID","level":3,"operation":"GET","path":"/x","section":"paths"}]'])('rejects unknown breaking JSON shape %s', (stdout) => {
    expect(parseBreakingResult(observed(stdout)).status).toBe('ERROR');
  });
  it('preserves unknown IDs but cannot return PASS or an approvable mapped rule', () => {
    const stdout = JSON.stringify([{ id: 'new-unrecognized-rule', level: 3, text: 'unknown', operation: 'GET', path: '/x', section: 'paths' }]);
    const result = parseBreakingResult(observed(stdout, 1));
    expect(result.status).toBe('ERROR'); expect(result.value?.[0]?.raw_rule_id).toBe('new-unrecognized-rule');
  });
  it('rejects duplicate JSON keys even when status and fields otherwise match', () => {
    expect(parseBreakingResult(observed('[{"id":"response-property-type-changed","id":"response-required-property-removed","text":"duplicate ID","level":3,"operation":"GET","path":"/x","section":"paths"}]', 1)).status).toBe('ERROR');
  });
  it('rejects inconsistent exit/output pairs and tool-error exits', () => {
    expect(parseBreakingResult(observed('[]', 1)).status).toBe('ERROR');
    expect(parseBreakingResult(observed('[]', 102)).status).toBe('ERROR');
    expect(parseDiffResult({ ...observed('{}', 1), command: 'diff' }).status).toBe('ERROR');
    expect(parseBreakingResult({ ...observed('[]'), interrupted: 'output-limit' }).status).toBe('ERROR');
  });
  it.each(['[]', 'null', '{"unexpected":true}', '{"paths":{"modified":[]}}', '{"paths":{}}'])('rejects unknown structural diff shape %s', (stdout) => {
    expect(parseDiffResult({ ...observed(stdout), command: 'diff' }).status).toBe('ERROR');
  });
});
