import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { parseConfiguration } from '../../../packages/core/src/services/config-service.js';
const sample = JSON.parse(await fs.readFile('tests/fixtures/config/original.json', 'utf8'));
it.each([{ inputs: ['apps/web/*.json'] }, { inputs: ['apps/web/fixture.json', 'apps/web/fixture.json'] }, { inputs: ['../outside.json'] }])('requires unique concrete relative ignored input paths: %j', ({inputs}) => {
  const config = structuredClone(sample); config.security.required_ignored_inputs = inputs;
  expect(() => parseConfiguration(Buffer.from(JSON.stringify(config)), '.stackgate.yaml')).toThrowError(expect.objectContaining({ exit_code: 64 }));
});
