import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { schemas } from './generated/schema-registry.js';
import type { ValidationResult } from './diagnostic.js';
import type { ProjectConfig } from './generated/project-config.js';
const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const schema of schemas) ajv.addSchema(schema);
export function validateSchema<T = unknown>(name: string, value: unknown): ValidationResult<T> {
  const validate = ajv.getSchema('https://stackgate.local/schemas/0.1/' + name + '.schema.json');
  if (!validate) throw new Error('Unregistered schema: ' + name);
  if (validate(value)) return { ok: true, value: value as T };
  return { ok: false, diagnostics: (validate.errors ?? []).map(error => ({
    code: 'CONFIG_INVALID',
    rule_id: 'SG-POLICY-INVALID_STRUCTURE',
    message: error.message ?? 'Invalid structure',
    location: error.instancePath + (error.keyword === 'additionalProperties' ? '/' + String(error.params.additionalProperty).replaceAll('~','~0').replaceAll('/','~1') : ''),
    observed_facts: { keyword: error.keyword, ...error.params },
    recommended_action: 'Correct the field against the versioned schema; validation never modifies inputs.',
    source: name,
  })) };
}
export function validateProjectConfig(value: unknown): ValidationResult<ProjectConfig> { return validateSchema<ProjectConfig>('project-config', value); }
