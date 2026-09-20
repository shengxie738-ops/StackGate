import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const executable = path.join(root, 'tools/bin/oasdiff-1.32.1/oasdiff.exe');
const output = path.join(root, 'tools/oasdiff/observations');
const fixtureDirectory = path.join(root, 'tests/fixtures/oasdiff/preparation');
await mkdir(output, { recursive: true });
await mkdir(fixtureDirectory, { recursive: true });
const config = path.join(fixtureDirectory, 'empty-config.yaml');
await writeFile(config, '{}\n');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('OASDIFF_')));
const observations = [];
async function run(label, command, base, revision, flags = [], extraEnv = {}) {
  const argv = [command, base, revision, '--format', 'json', '--config', config, ...flags];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { cwd: fixtureDirectory, env: { ...env, ...extraEnv }, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Probe timed out')); }, 10_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (exit_code, signal) => { clearTimeout(timer); resolve({ executable, argv, exit_code, signal, stdout, stderr }); });
  });
  await writeFile(path.join(output, `${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(output, `${label}.stdout.json`), result.stdout);
  observations.push({ label, exit_code: result.exit_code, stderr: result.stderr, stdout: result.stdout });
  console.log(JSON.stringify(observations.at(-1)));
  return result;
}
const retained = (name) => path.join(root, `tests/fixtures/contracts/${name}.json`);
const target = JSON.parse(await readFile(retained('target'), 'utf8'));
const schema = (document) => document.paths['/api/performance'].get.responses['200'].content['application/json'].schema;
async function fixture(name, document) {
  const filename = path.join(fixtureDirectory, `${name}.json`);
  await writeFile(filename, `${JSON.stringify(document, null, 2)}\n`);
  return filename;
}
const safe = ['--allow-external-refs=false'];
for (const [name, expectedId] of [['candidate-correct', null], ['candidate-wrong', 'response-property-type-changed'], ['candidate-missing', 'response-required-property-removed']]) {
  const result = await run(name, 'breaking', retained('target'), retained(name), [...safe, '--fail-on', 'ERR']);
  const findings = JSON.parse(result.stdout);
  if (expectedId === null) { assert.equal(result.exit_code, 0); assert.deepEqual(findings, []); }
  else { assert.equal(result.exit_code, 1); assert(findings.some((finding) => finding.id === expectedId)); }
}
const defaultBreaking = await run('breaking-default-exit', 'breaking', retained('target'), retained('candidate-wrong'), safe);
assert.equal(defaultBreaking.exit_code, 0);
assert.equal(JSON.parse(defaultBreaking.stdout)[0].id, 'response-property-type-changed');
const difference = await run('diff-fail-on-diff', 'diff', retained('target'), retained('candidate-wrong'), [...safe, '--fail-on-diff']);
assert.equal(difference.exit_code, 1);
assert.equal(typeof JSON.parse(difference.stdout).paths.modified, 'object');
const sameDiff = await run('diff-identical', 'diff', retained('target'), retained('target'), safe);
assert.equal(sameDiff.exit_code, 0);
assert.deepEqual(JSON.parse(sameDiff.stdout), {});
const configIsolation = await run('explicit-config-precedence', 'breaking', retained('target'), retained('candidate-wrong'), [...safe, '--fail-on', 'ERR'], { OASDIFF_CONFIG: path.join(fixtureDirectory, 'nonexistent-config.yaml') });
assert.equal(configIsolation.exit_code, 1);
assert.equal(JSON.parse(configIsolation.stdout)[0].id, 'response-property-type-changed');
const requestBase = structuredClone(target);
requestBase.paths['/api/performance'].post = {
  requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } },
  responses: { '204': { description: 'accepted' } },
};
const requestRevision = structuredClone(requestBase);
requestRevision.paths['/api/performance'].post.requestBody.content['application/json'].schema.required = ['name'];
const required = await run('request-required-added', 'breaking', await fixture('request-base', requestBase), await fixture('request-required', requestRevision), [...safe, '--fail-on', 'ERR']);
assert.equal(required.exit_code, 1);
assert(JSON.parse(required.stdout).some((finding) => finding.id === 'request-property-became-required'));
const enumBase = structuredClone(target);
schema(enumBase).properties.data.properties.performance.properties.total_return = { type: 'number', enum: [1] };
const enumRevision = structuredClone(enumBase);
schema(enumRevision).properties.data.properties.performance.properties.total_return.enum.push(2);
const enumResult = await run('response-enum-expanded', 'breaking', await fixture('enum-base', enumBase), await fixture('enum-revision', enumRevision), [...safe, '--fail-on', 'ERR']);
assert.equal(enumResult.exit_code, 1);
assert(JSON.parse(enumResult.stdout).some((finding) => finding.id === 'response-property-enum-value-added'));
let requests = 0;
const server = createServer((request, response) => { assert.equal(request.url, '/schema.json'); requests += 1; response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"type":"number"}'); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const external = structuredClone(target);
  schema(external).properties.data.properties.performance.properties.total_return = { $ref: `http://127.0.0.1:${server.address().port}/schema.json` };
  const externalPath = await fixture('external-http', external);
  const denied = await run('external-http-denied', 'breaking', externalPath, retained('target'), [...safe, '--fail-on', 'ERR']);
  assert.notEqual(denied.exit_code, 0);
  assert.match(denied.stderr, /external refs.*disabled|encountered disallowed external reference/i);
  assert.equal(requests, 0);
  const allowed = await run('external-http-positive-control', 'breaking', externalPath, retained('target'), ['--allow-external-refs=true', '--fail-on', 'ERR']);
  assert.equal(allowed.exit_code, 0);
  assert(requests > 0);
  console.log(JSON.stringify({ external_denied_requests: 0, positive_control_requests: requests }));
} finally { await new Promise((resolve) => server.close(resolve)); }
const externalFile = structuredClone(target);
schema(externalFile).properties.data.properties.performance.properties.total_return = { $ref: './external-schema.json' };
await fixture('external-schema', { type: 'number' });
const fileDenied = await run('external-file-denied', 'diff', await fixture('external-file', externalFile), retained('target'), safe);
assert.equal(fileDenied.exit_code, 102);
assert.match(fileDenied.stderr, /encountered disallowed external reference/i);
await writeFile(path.join(output, 'summary.json'), `${JSON.stringify({ verified_at: new Date().toISOString(), observations }, null, 2)}\n`);
console.log('Real oasdiff capability preparation assertions passed. SG-020 adapter remains unimplemented.');
