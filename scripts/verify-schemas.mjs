import { readFile, readdir } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { generateTypes } from './generate-types.mjs';
import { verifyOpenapiFixtures } from './verify-openapi-fixtures.mjs';
const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const files = (await readdir('schemas/0.1')).filter(name => name.endsWith('.schema.json'));
for (const file of files) ajv.addSchema(JSON.parse(await readFile('schemas/0.1/' + file, 'utf8')));
for (const file of files) ajv.getSchema('https://stackgate.local/schemas/0.1/' + file);
const manifest = JSON.parse(await readFile('schemas/fixtures.json', 'utf8'));
if (!manifest.length) throw new Error('No schema fixtures registered');
for (const fixture of manifest) {
  const validate = ajv.getSchema('https://stackgate.local/schemas/0.1/' + fixture.schema + '.schema.json');
  if (!validate) throw new Error('Unknown fixture schema: ' + fixture.schema);
  const value = JSON.parse(await readFile(fixture.path, 'utf8'));
  const before = JSON.stringify(value);
  if (validate(value) !== fixture.valid) throw new Error(fixture.path + ': ' + JSON.stringify(validate.errors));
  if (JSON.stringify(value) !== before) throw new Error('Validator mutated ' + fixture.path);
}
await generateTypes(true);
await verifyOpenapiFixtures();
console.log(`Validated ${files.length} schemas, ${manifest.length} fixtures, generated type drift: none`);
