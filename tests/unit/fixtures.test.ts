import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { expect, it } from 'vitest';
import { validateSchema } from '../../packages/contracts/src/validation.js';
import { evaluateGate } from '../../packages/core/src/domain/evaluate-gate.js';
import { createCheckFact, createGateInput } from '../support/factories.js';
const fixture = (name: string): any => JSON.parse(readFileSync('tests/fixtures/' + name + '.json', 'utf8'));
const responseSchema = (document: any) => document.paths['/api/performance'].get.responses['200'].content['application/json'].schema;
it('validates all OpenAPI documents against the retained official document schema and strict response schemas', () => {
  const child = spawnSync(process.execPath, ['scripts/verify-openapi-fixtures.mjs'], {encoding:'utf8'});
  expect(child.status,child.stderr).toBe(0);
  expect(child.stdout).toContain('7 OpenAPI');
});
it('default baseline equals target bytes and correct candidate has the same behavior projection', () => {
  const baseline = readFileSync('tests/fixtures/contracts/baseline.json');
  const target = readFileSync('tests/fixtures/contracts/target.json');
  expect(baseline.equals(target)).toBe(true);
  expect(responseSchema(fixture('contracts/candidate-correct'))).toEqual(responseSchema(fixture('contracts/target')));
});
it('preserves string and missing-field faults and does not coerce actual responses', () => {
  const target = responseSchema(fixture('contracts/target'));
  const wrong = responseSchema(fixture('contracts/candidate-wrong'));
  const missing = responseSchema(fixture('contracts/candidate-missing'));
  expect(wrong.properties.data.properties.performance.properties.total_return.type).toBe('string');
  expect(missing.properties.data.properties.performance.required).not.toContain('total_return');
  const validate = new Ajv2020({strict:true,coerceTypes:false,useDefaults:false,removeAdditional:false}).compile(target);
  const good = {data:{performance:{total_return:0.1234}}};
  expect(validate(good)).toBe(true);
  expect((good.data.performance.total_return*100).toFixed(2)+'%').toBe('12.34%');
  for(const bad of [{data:{performance:{total_return:'0.1234'}}},{data:{performance:{}}},{data:{performance:{total_return:null}}}]) {
    const before=structuredClone(bad); expect(validate(bad)).toBe(false); expect(bad).toEqual(before);
  }
});
it('intentional upgrade binds exact operation and real before/after byte hashes', () => {
  const task=fixture('tasks/approved-upgrade');
  expect(validateSchema('task',task).ok).toBe(true);
  const change=task.compatibility.approved_breaking_rules[0];
  expect(change.operation_key).toBe('api:GET /api/performance');
  for(const [field,file] of [['baseline_hash','upgrade-baseline'],['target_hash','upgrade-target']]) {
    expect(change[field!]).toBe(createHash('sha256').update(readFileSync('tests/fixtures/contracts/'+file+'.json')).digest('hex'));
  }
  expect(change.baseline_hash).not.toBe(change.target_hash);
});
it.each(['pass','fail','incomplete','error','stale'])('validates complete %s goldens without treating them as observed runs', name => {
  const golden=fixture('gate/'+name);
  expect(golden.fixture_only).toBe(true);
  expect(validateSchema('run',golden.run).ok).toBe(true);
  expect(validateSchema('gate-input',golden.input).ok).toBe(true);
  expect(validateSchema('gate-evaluation',golden.evaluation).ok).toBe(true);
  const pure = Object.fromEntries(Object.entries(golden.evaluation).filter(([key]) => !['run_id','policy_hash','evaluated_at'].includes(key)));
  expect(evaluateGate(golden.input)).toEqual(pure);
});
it('factory overrides and fixture reads are isolated', () => {
  const override={required_check_ids:['unit']}; const first=createGateInput(override);
  first.required_check_ids.push('extra');expect(override.required_check_ids).toEqual(['unit']);expect(createGateInput().required_check_ids).toEqual(['unit']);
  createCheckFact().reasons.push('mutated');expect(createCheckFact().reasons).toEqual([]);
  fixture('contracts/target').paths={};expect(fixture('contracts/target').paths).toHaveProperty('/api/performance');
});
