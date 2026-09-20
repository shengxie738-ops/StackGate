import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
export async function verifyOpenapiFixtures() {
  const raw = await readFile('tests/fixtures/vendor/openapi-3.1.schema.json');
  const source = JSON.parse(await readFile('tests/fixtures/vendor/SOURCES.json', 'utf8'));
  if (createHash('sha256').update(raw).digest('hex') !== source.sha256) throw new Error('Official schema byte digest changed');
  // The official meta-schema uses required/properties in separate applicators.
  // Its properties and patternProperties overlap deliberately. These authoring
  // warnings are relaxed only for the retained official document meta-schema.
  const documentAjv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allowMatchingProperties: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  addFormats(documentAjv);
  documentAjv.addFormat('media-range', /^[^\s/;]+\/[^\s/;]+(?:\s*;.*)?$/);
  // Ajv #1745: nested dynamic anchors resolve incorrectly. For this hash-pinned,
  // unextended document meta-schema only, #meta denotes exactly $defs/schema.
  // Keep the original bytes; this is not an OpenAPI product loader or a claim
  // to support arbitrary dynamic references in candidate response schemas.
  const meta = JSON.parse(raw.toString('utf8'));
  function bindStaticMeta(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$dynamicRef === '#meta') { delete value.$dynamicRef; value.$ref = '#/$defs/schema'; }
    for (const child of Object.values(value)) bindStaticMeta(child);
  }
  bindStaticMeta(meta);
  const validateDocument = documentAjv.compile(meta);
  const responseAjv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  const files = (await readdir('tests/fixtures/contracts')).filter(name => name.endsWith('.json'));
  if (files.length < 7) throw new Error('Missing mandatory contract fixture');
  for (const name of files) {
    const document = JSON.parse(await readFile('tests/fixtures/contracts/' + name, 'utf8'));
    if (!validateDocument(document)) throw new Error(name + ': ' + JSON.stringify(validateDocument.errors));
    for (const item of Object.values(document.paths)) for (const operation of Object.values(item)) {
      for (const response of Object.values(operation.responses)) for (const content of Object.values(response.content)) responseAjv.compile(content.schema);
    }
    const invalid = structuredClone(document); delete invalid.info;
    if (validateDocument(invalid)) throw new Error('OpenAPI validator failed the missing-info counterexample');
  }
  console.log('Validated ' + files.length + ' OpenAPI documents and strict fixture response schemas (no network at verification time)');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyOpenapiFixtures();
