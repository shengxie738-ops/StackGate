import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import type { CheckStep } from '../../../packages/contracts/src/index.js';
import { normalizePlanDag } from '../../../packages/core/src/domain/plan-dag.js';
import { parseConfiguration } from '../../../packages/core/src/services/config-service.js';
const step = (id: string, dependencies: string[] = []): CheckStep => ({ step_id: id, check_id: id, adapter_id: 'command', command_id: id, depends_on: dependencies, required: true, timeout_ms: 1000, resource_locks: [], expected_artifacts: [], expected_test_ids: [], min_tests: null, parameters: { adapter_id: 'command', result_kind: 'exit-code' } });
it('normalizes a DAG deterministically without mutating input and retains all required checks', () => {
  const a = step('a'), b = step('b', ['a']), c = step('c', ['a']);
  b.resource_locks = ['z', 'a'];
  const first = normalizePlanDag([c, b, a], ['a', 'b', 'c']);
  expect(first.map(item => item.step_id)).toEqual(['a', 'b', 'c']);
  expect(first[1]!.resource_locks).toEqual(['a', 'z']);
  expect(b.resource_locks).toEqual(['z', 'a']);
  expect(normalizePlanDag([b, a, c], ['c', 'b', 'a'])).toEqual(first);
});
it.each(['cycle', 'missing', 'duplicate-step', 'duplicate-check', 'empty', 'required-missing', 'required-optional', 'required-omitted', 'invalid-lock'])('rejects %s plan ambiguity', kind => {
  let steps = [step('a'), step('b', ['a'])], required = ['a', 'b'];
  if (kind === 'cycle') steps[0]!.depends_on = ['b'];
  if (kind === 'missing') steps[1]!.depends_on = ['missing'];
  if (kind === 'duplicate-step') steps[1]!.step_id = 'a';
  if (kind === 'duplicate-check') steps[1]!.check_id = 'a';
  if (kind === 'empty') { steps = []; required = []; }
  if (kind === 'required-missing') required.push('absent');
  if (kind === 'required-optional') steps[1]!.required = false;
  if (kind === 'required-omitted') required = ['a'];
  if (kind === 'invalid-lock') steps[0]!.resource_locks = ['../outside'];
  expect(() => normalizePlanDag(steps, required)).toThrow();
});
const sample = JSON.parse(await fs.readFile('tests/fixtures/config/original.json', 'utf8'));
it('accepts an explicitly local command/JUnit profile without external environment requirements', () => {
  const config = structuredClone(sample);
  config.profiles = { local: {...sample.profiles.integration, environment: null, minimum_provenance: 'DECLARED', required_checks: ['typecheck', 'unit']} };
  config.environments = {};
  expect(parseConfiguration(Buffer.from(JSON.stringify(config)), 'config').profiles.local!.environment).toBeNull();
});
it('does not treat observed provenance requirements as satisfied by a null environment', () => {
  const config = structuredClone(sample);
  config.profiles = {local: {...sample.profiles.integration, environment: null, required_checks: ['unit'], minimum_provenance: 'OBSERVED'}};
  expect(() => parseConfiguration(Buffer.from(JSON.stringify(config)), 'config')).toThrowError(expect.objectContaining({exit_code: 64}));
});
it('rejects local profile requirements or regression checks that silently require M3 runtime', () => {
  for (const runtimeChecks of [{required_checks: ['runtime']}, {required_checks: ['unit'], workspace_regression: {web: ['e2e']}}]) {
    const config = structuredClone(sample);
    config.profiles = {local: {...sample.profiles.integration, environment: null, ...runtimeChecks}};
    expect(() => parseConfiguration(Buffer.from(JSON.stringify(config)), 'config')).toThrowError(expect.objectContaining({exit_code: 64}));
  }
});
