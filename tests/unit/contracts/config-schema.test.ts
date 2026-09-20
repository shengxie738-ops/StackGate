import { expect, it } from 'vitest';
import { validateProjectConfig, validateSchema } from '../../../packages/contracts/src/validation.js';
import { sourceFixture } from '../../support/source-fixtures.js';
it('accepts the unmodified original project config', () => {
  const input = sourceFixture('12.2'); const before = structuredClone(input);
  expect(validateProjectConfig(input)).toMatchObject({ ok: true });
  expect(input).toEqual(before);
});
it('rejects misspelled nested required checks and reports a JSON pointer', () => {
  const input = sourceFixture('12.2') as any;
  input.profiles.integration.required_cheks = ['unit'];
  const result = validateProjectConfig(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics.some(d => d.location.includes('/profiles/integration/required_cheks'))).toBe(true);
});
it.each([['args', 'run test'], ['timeout_seconds', -1], ['timeout_seconds', '120']])('does not coerce invalid command %s', (field, value) => {
  const input = sourceFixture('12.2') as any; input.commands.web_unit[field] = value;
  const before = structuredClone(input);
  expect(validateProjectConfig(input).ok).toBe(false); expect(input).toEqual(before);
});
it('rejects unknown properties and mismatched adapter options', () => {
  const input = sourceFixture('12.2') as any;
  input.checks.unit.require_real_backend = true;
  expect(validateProjectConfig(input).ok).toBe(false);
});
it('rejects duplicate check IDs and environment interpolation', () => {
  const input = sourceFixture('12.2') as any;
  input.profiles.integration.required_checks = ['unit','unit'];
  expect(validateProjectConfig(input).ok).toBe(false);
  input.profiles.integration.required_checks = ['unit'];
  input.commands.web_unit.args = ['${TOKEN}'];
  expect(validateProjectConfig(input).ok).toBe(false);
});
it('supports E17 explicit environment bindings but rejects undeclared security options', () => {
  const input = sourceFixture('12.2') as any;
  input.extensions = { stackgate_v0_1: { environment_bindings: { test: { backend: { service: 'api', container_port: 8000, protocol: 'http', publish_host: '127.0.0.1' } } } } };
  input.security.extensions = { stackgate_v0_1: { allowed_environment_bindings: ['test.backend'] } };
  expect(validateProjectConfig(input).ok).toBe(true);
  input.security.sudo = true;
  expect(validateProjectConfig(input).ok).toBe(false);
});
it('requires explicit adapter capability state', () => {
  expect(validateSchema('adapter-capabilities', { schema_version: '0.1', adapter_id: 'openapi' }).ok).toBe(false);
});
