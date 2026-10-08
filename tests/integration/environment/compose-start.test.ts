import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Artifact, Diagnostic, EffectivePolicy, EnvironmentManifest, ProjectConfig } from '../../../packages/contracts/src/index.js';
import { validateSchema } from '../../../packages/contracts/src/index.js';
import type { ExecutionContext } from '../../../packages/core/src/ports/adapter.js';
import type { ArtifactWrite } from '../../../packages/core/src/ports/evidence.js';
import type { RunnerResult } from '../../../packages/core/src/ports/runner.js';
import { LocalRunner } from '../../../packages/runner-local/src/local-runner.js';
import { authorizeBindingOrigin, planServiceBindings, recordObservedBindings } from '../../../packages/adapter-compose/src/target-bindings.js';
import { ComposeAdapter } from '../../../packages/adapter-compose/src/compose-adapter.js';
import {
  assertPermittedArgv,
  classifyStartFailure,
  composeOwnerToken,
  composeProjectNamespace,
  createComposeCommandPort,
  enumerateProjectResources,
} from '../../../packages/adapter-compose/src/start.js';
import { inspectObjects, readPublishedBinding, resolveLocalImageIdentity, verifyImageClaim } from '../../../packages/adapter-compose/src/inspect.js';

/**
 * SG-058 · own Compose bring-up, dynamic host ports and provenance snapshots.
 *
 * This suite brings Compose environments up for real. It was authored on `win32-x64` against Docker CLI
 * 29.5.2 and Docker Compose v5.1.4 with a reachable daemon, and the only image it starts
 * (`python:3.14.3-slim-bookworm`) was already present locally: no pull is issued anywhere. The failure
 * fixture asks for an image that does not exist with `pull_policy: never`, so a silent fetch is impossible.
 *
 * Ownership discipline. This host also runs the user's own containers, so everything here addresses
 * resources only through project namespaces this file generated (`stackgate-...-<12 hex>`), and teardown
 * re-reads the `com.docker.compose.project` label from the daemon before removing any id. Nothing is
 * pruned, no foreign project is brought down, no resource is matched by name or by image. Reclaiming a
 * StackGate run is SG-061's task: `ComposeAdapter.cleanup` shows it deletes nothing by leaving every
 * recorded resource preserved with a refusal diagnostic.
 *
 * Port-conflict provenance. The daemon text given to `classifyStartFailure` is the verbatim stderr of a
 * real `docker compose --project-name stackgate-sg058-probe-720-fixed-b ... up -d` that exited 1 on
 * 2026-10-03 with `Bind for 127.0.0.1:18080 failed: port is already allocated` (two projects, one fixed
 * published port). That collision is not re-executed here, because doing so would mean fighting a port this
 * run does not own; the classifier is tested against the recorded bytes, and that limit is stated here.
 */

vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 });

const CHECK_ID = 'environment';
const SECRET_MARKER = 'stackgate-sg058-canary-4f2a17';
const LOCAL_IMAGE_REFERENCE = 'python:3.14.3-slim-bookworm';
const PORT_CONFLICT_STDERR =
  'Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint stackgate-sg058-probe-720-fixed-b-api-1 (53ac5bb26de8a67a3d805f2b37f3124c5650089ad23dc1858a0ea5505ad8dfae): Bind for 127.0.0.1:18080 failed: port is already allocated';

/** The docker executable the reviewed wiring points at: declared by the caller, never taken from a log line. */
function reviewedDockerPath(): string {
  const declared = process.env.STACKGATE_DOCKER_PATH;
  if (declared && path.isAbsolute(declared)) return declared;
  const win = process.platform === 'win32';
  const output = execFileSync(win ? 'where.exe' : 'which', win ? ['docker.exe'] : ['docker'], { encoding: 'utf8' });
  const found = output.split(/\r?\n/).map((line) => line.trim()).find((line) => path.isAbsolute(line));
  if (!found) throw new Error('SG-058 needs a real Docker CLI: none declared and none locatable on this host');
  return found;
}

const dockerPath = reviewedDockerPath();
const runner = new LocalRunner();

type Stored = { artifact: Artifact; write: ArtifactWrite };
type Invocation = { purpose: string; argv: readonly string[]; exit_code: number | null };
type Harness = { root: string; run_id: string; adapter: ComposeAdapter; context: ExecutionContext; stored: Stored[]; invocations: Invocation[]; results: RunnerResult[] };
type BroughtUp = { h: Harness; manifest: EnvironmentManifest };

/** The compose document this file writes for real; tokens resolve from the environment StackGate authorises. */
function composeDocument(imageReference: string, options: { internal?: boolean; pullNever?: boolean; failing?: boolean } = {}): string {
  const lines = [
    'services:',
    '  api:',
    `    image: ${imageReference}`,
    `    command: ${options.failing ? '["python", "-m", "sg058_module_that_does_not_exist"]' : '["python", "-m", "http.server", "8080"]'}`,
    '    networks: ["gate"]',
    '    labels:',
    '      stackgate.run_id: "${STACKGATE_RUN_ID}"',
    '      stackgate.seed: "${STACKGATE_TEST_SEED}"',
    '      stackgate.managed: "by-stackgate"',
    '    ports:',
    '      - host_ip: 127.0.0.1',
    '        target: 8080',
    '        protocol: tcp',
    '    restart: "no"',
  ];
  if (options.pullNever) lines.push('    pull_policy: never');
  lines.push('networks:', '  gate:');
  if (options.internal) lines.push('    internal: true');
  lines.push('    labels:', '      stackgate.run_id: "${STACKGATE_RUN_ID}"');
  return `${lines.join('\n')}\n`;
}

const BASE_POLICY: EffectivePolicy = {
  schema_version: '0.1',
  policy_id: 'policy_sg058',
  policy_hash: 'b'.repeat(64),
  required_set: ['compose-smoke'],
  allowed_origins: [],
  allowed_paths: ['**'],
  protected_inputs: ['compose.sg058.yaml'],
  minimum_provenance: 'DECLARED',
  approved_change_records: [],
  flaky_policy: 'incomplete',
  source: 'local-review',
};

function configuration(composeFile: string, dataRevision: string): ProjectConfig['environments'][string] {
  return { mode: 'compose', compose_file: composeFile, services: ['api'], data_revision: dataRevision };
}

function executionContext(root: string, runId: string, stored: Stored[]): ExecutionContext {
  const attempt_id = `attempt_${runId.slice(4)}`;
  return {
    run_id: runId,
    check_id: CHECK_ID,
    attempt_id,
    allowed_paths: [root],
    allowed_origins: [],
    environment: { STACKGATE_RUN_ID: runId },
    signal: new AbortController().signal,
    // The compose adapter receives the reviewed runner, not a command-id closure that could hide the argv.
    commands: { async run() { throw new Error('SG-058 never brings compose up through an opaque command id'); } },
    log: { async append() { /* refusals are asserted on the returned manifest */ } },
    artifacts: {
      async store(write) {
        const artifact: Artifact = {
          schema_version: '0.1',
          artifact_id: `artifact_${randomUUID()}`,
          run_id: runId,
          check_id: CHECK_ID,
          attempt_id,
          relative_path: `artifacts/${write.name}`,
          media_type: write.media_type,
          size: write.bytes.byteLength,
          digest: '0'.repeat(64),
          sensitivity: write.sensitivity,
          redaction_state: write.redaction_state,
          artifact_kind: write.artifact_kind,
        };
        stored.push({ artifact, write });
        return artifact;
      },
    },
    clock: { now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
    ids: { create: (kind) => `${kind}_${randomUUID()}` },
  };
}

/** Namespaces this file generated; teardown walks only these, and only through label-verified ids. */
const ownedNamespaces = new Map<string, string>();

async function harness(options: { namespaceEntropy?: () => string; extraEnvironment?: Record<string, string>; protocols?: Record<string, 'http' | 'https'>; run_id?: string } = {}): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stackgate-sg058-'));
  const run_id = options.run_id ?? `run_sg058_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const environment = { STACKGATE_RUN_ID: run_id, STACKGATE_TEST_SEED: SECRET_MARKER, ...(options.extraEnvironment ?? {}) };
  const stored: Stored[] = [];
  const invocations: Invocation[] = [];
  const results: RunnerResult[] = [];
  const command_port = await createComposeCommandPort({
    runner: {
      async run(command, context) {
        const result = await runner.run(command, context);
        results.push(result);
        return result;
      },
    },
    docker: { executable: dockerPath, version: 'reviewed-by-local-trust-grant' },
    cwd: root,
    environment,
    on_command: (record) => invocations.push(record),
  });
  const adapter = new ComposeAdapter({
    command_port,
    cwd: root,
    environment,
    service_protocols: options.protocols ?? { api: 'http' },
    ...(options.namespaceEntropy ? { namespace_entropy: options.namespaceEntropy } : {}),
    profile_directories: [os.homedir()],
    on_namespace: (namespace) => ownedNamespaces.set(namespace, run_id),
  });
  return { root, run_id, adapter, context: executionContext(root, run_id, stored), stored, invocations, results };
}

let pinnedReferenceValue = '';

/** Pin the already-local image by the id the daemon reports, so the run inputs are real, not assumed. */
async function pinnedReference(): Promise<string> {
  if (pinnedReferenceValue.length > 0) return pinnedReferenceValue;
  const probe = await harness();
  const identity = await resolveLocalImageIdentity(probe.adapter.command_port, LOCAL_IMAGE_REFERENCE, probe.context);
  if (!identity.found || !identity.image_id) throw new Error(`SG-058 needs ${LOCAL_IMAGE_REFERENCE} present locally; the daemon reports it is not`);
  expect(identity.image_id).toMatch(/^sha256:[0-9a-f]{64}$/);
  // The digest keeps its `sha256:` algorithm prefix: `name@<bare hex>` is not a Docker reference at all.
  // Observed on this host before the fix — `compose up` exited 1 with
  // `unable to get image 'python:3.14.3-slim-bookworm@f21c0d5a…': Error response from daemon: invalid
  // reference format`, and it failed before creating the network, so the ledger came back empty.
  pinnedReferenceValue = `${LOCAL_IMAGE_REFERENCE}@${identity.image_id}`;
  await fs.rm(probe.root, { recursive: true, force: true });
  return pinnedReferenceValue;
}

async function bringUp(options: { body?: string; revision?: string; input_hash?: string; policy?: EffectivePolicy; extraEnvironment?: Record<string, string>; namespaceEntropy?: () => string; run_id?: string } = {}): Promise<BroughtUp> {
  const h = await harness({
    ...(options.extraEnvironment ? { extraEnvironment: options.extraEnvironment } : {}),
    ...(options.namespaceEntropy ? { namespaceEntropy: options.namespaceEntropy } : {}),
    ...(options.run_id ? { run_id: options.run_id } : {}),
  });
  await fs.writeFile(path.join(h.root, 'compose.sg058.yaml'), options.body ?? composeDocument(await pinnedReference()), 'utf8');
  const manifest = await h.adapter.prepare(
    {
      run_id: h.run_id,
      environment_id: 'env_sg058',
      input_hash: options.input_hash ?? 'c'.repeat(64),
      configuration: configuration('compose.sg058.yaml', options.revision ?? 'rev-sg058-real'),
      policy: options.policy ?? BASE_POLICY,
    },
    h.context,
  );
  return { h, manifest };
}

const bindingOf = (manifest: EnvironmentManifest, service: string): NonNullable<EnvironmentManifest['bindings']>[string] => {
  const entry = manifest.bindings?.[service];
  if (!entry) throw new Error(`the manifest carries no observed binding for ${service}: ${JSON.stringify(manifest.reasons)}`);
  return entry;
};

/** One inspected object, refusing an empty answer instead of reading a property off undefined. */
const oneObject = (objects: { Id?: unknown }[], label: string): Record<string, unknown> => {
  const first = objects[0];
  if (!first) throw new Error(`the daemon returned no inspect element for ${label}`);
  return first as Record<string, unknown>;
};

async function cleanupRoots(...roots: string[]): Promise<void> {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
}

afterAll(async () => {
  for (const namespace of ownedNamespaces.keys()) {
    const list = (args: string[]): string[] => execFileSync(dockerPath, args, { encoding: 'utf8' }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const id of list(['ps', '-aq', '--filter', `label=com.docker.compose.project=${namespace}`])) {
      const label = execFileSync(dockerPath, ['inspect', id, '--format', '{{index .Config.Labels "com.docker.compose.project"}}'], { encoding: 'utf8' }).trim();
      if (label === namespace) execFileSync(dockerPath, ['rm', '-f', id], { encoding: 'utf8' });
    }
    for (const id of list(['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${namespace}`])) {
      if (execFileSync(dockerPath, ['inspect', id, '--format', '{{.Name}}'], { encoding: 'utf8' }).trim().startsWith(`${namespace}_`)) {
        execFileSync(dockerPath, ['network', 'rm', id], { encoding: 'utf8' });
      }
    }
  }
  ownedNamespaces.clear();
});

/* ------------------------------------------------------------------ the reviewed command capability boundary ------------------------------------------------------------------ */

describe('compose command capability', () => {
  const namespace = composeProjectNamespace('run_sg058_capability', 'aaaaaaaaaaaa');

  it('refuses every argv that could reach resources this run does not own', () => {
    const refused = [
      ['system', 'prune', '-f'],
      ['container', 'prune', '-f'],
      ['volume', 'prune', '-f'],
      ['builder', 'prune', '-f'],
      ['image', 'rm', 'whatever:1.0'],
      ['container', 'kill', 'a-user-container'],
      ['container', 'rm', '-f', 'a-user-container'],
      ['compose', '--project-name', namespace, 'down', '-v'],
      ['compose', '--project-name', namespace, 'pull'],
      ['compose', 'ls'],
      ['ps', '-q'],
      ['docker system prune -f'],
      ['compose', '--project-name', 'someone-elses-project', 'up', '-d'],
      ['ps', '-aq', '--filter', 'label=com.docker.compose.project=other-project'],
      ['exec', namespace, 'sh'],
    ];
    for (const argv of refused) {
      const decision = assertPermittedArgv(argv, namespace);
      expect(decision.ok, `argv ${JSON.stringify(argv)} must be refused`).toBe(false);
    }
  });

  it('permits only the argv shapes a run needs, with its own namespace pinned inside them', () => {
    const permitted = [
      ['version', '--format', '{{.Server.Version}}'],
      ['compose', '--project-name', namespace, 'version', '--short'],
      ['compose', '--project-name', namespace, '--project-directory', '/tmp/x', '-f', 'c.yaml', 'config', '--format', 'json'],
      ['compose', '--project-name', namespace, '--project-directory', '/tmp/x', '-f', 'c.yaml', 'up', '-d', '--no-build', 'api'],
      // every one of the three enumerations the adapter really emits
      ['ps', '-a', '--no-trunc', '--filter', `label=com.docker.compose.project=${namespace}`, '--format', '{{.ID}}'],
      ['network', 'ls', '--no-trunc', '--filter', `label=com.docker.compose.project=${namespace}`, '--format', '{{.ID}}'],
      ['volume', 'ls', '--filter', `label=com.docker.compose.project=${namespace}`, '--format', '{{.Name}}'],
      ['inspect', 'b7ae314ed5bc'],
      ['image', 'inspect', 'python:3.14.3-slim-bookworm'],
    ];
    for (const argv of permitted) expect(assertPermittedArgv(argv, namespace).ok, `argv ${JSON.stringify(argv)} must be permitted`).toBe(true);
    // the loose listing shapes are refused, so a truncated or unfiltered answer cannot reach the ledger
    const label = `label=com.docker.compose.project=${namespace}`;
    for (const argv of [
      ['ps', '-aq', '--filter', label],
      ['ps', '-a', '--filter', label, '--format', '{{.Names}}'],
      // without `-a` an exited container this run created is invisible, which is not an enumeration to allow
      ['ps', '--no-trunc', '--filter', label, '--format', '{{.ID}}'],
      // a foreign project label in the otherwise correct shape stays refused
      ['ps', '-a', '--no-trunc', '--filter', 'label=com.docker.compose.project=someone-elses-project', '--format', '{{.ID}}'],
      ['network', 'ls', '--no-trunc', '--filter', 'label=com.docker.compose.project=someone-elses-project', '--format', '{{.ID}}'],
      // `volume ls` gains nothing by truncation here, and this CLI rejects the flag: an extra token is refused
      ['volume', 'ls', '--no-trunc', '--filter', label, '--format', '{{.Name}}'],
      ['volume', 'ls', '--filter', label, '--format', '{{.Name}}', '--filter', 'dangling=true'],
      ['inspect', 'a-user-container-name'],
      ['image', 'inspect', 'one:1', 'two:2'],
    ]) {
      expect(assertPermittedArgv(argv, namespace).ok, `argv ${JSON.stringify(argv)} must be refused`).toBe(false);
    }
    // a request whose namespace is not even a safe compose project name cannot scope anything
    expect(assertPermittedArgv(['ps', '-a', '--no-trunc', '--filter', 'label=com.docker.compose.project=..', '--format', '{{.ID}}'], '..').ok).toBe(false);
    expect(namespace).toMatch(/^stackgate-[a-z0-9-]+-[0-9a-f]{12}$/);
  });

  it('executes a real docker command through the reviewed runner and reports its process identity', async () => {
    const h = await harness();
    const observed = await h.adapter.observeDockerIdentity(h.context);
    expect(observed.daemon_reachable).toBe(true);
    expect(observed.compose_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(observed.executable_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(observed.mechanism).toBe(process.platform === 'win32' ? 'WINDOWS_JOB_OBJECT' : 'POSIX_PROCESS_GROUP_UNVERIFIED');
    expect(h.results.length).toBeGreaterThan(0);
    expect(h.results.every((result) => result.status === 'EXITED')).toBe(true);
    expect(h.invocations.every((record) => record.argv.every((entry) => typeof entry === 'string' && !entry.includes('\0')))).toBe(true);
    await cleanupRoots(h.root);
  });
});

/* ------------------------------------------------------------------ two independent runs against the real daemon ------------------------------------------------------------------ */

describe('SG-058 compose bring-up on a real daemon', () => {
  let runA: BroughtUp;
  let runB: BroughtUp;

  beforeAll(async () => {
    await pinnedReference();
    runA = await bringUp();
    runB = await bringUp();
  });

  afterAll(async () => {
    for (const run of [runA, runB]) await cleanupRoots(run.h.root);
  });

  it('reaches READY from resources it created and keeps both manifests schema-valid', () => {
    for (const run of [runA, runB]) {
      expect(run.manifest.status, JSON.stringify(run.manifest.reasons)).toBe('READY');
      expect(run.manifest.mode).toBe('compose');
      expect(run.manifest.reasons).toEqual([]);
      expect(validateSchema('environment', run.manifest).ok).toBe(true);
    }
  });

  it('gives the two runs different host ports taken from real inspection, never a guessed default', () => {
    const portA = bindingOf(runA.manifest, 'api').host_port;
    const portB = bindingOf(runB.manifest, 'api').host_port;
    expect(typeof portA).toBe('number');
    expect(portA).not.toBe(8080);
    expect(portA).not.toBe(5173);
    expect(portA).not.toBe(portB);
    expect(bindingOf(runA.manifest, 'api').publish_host).toBe('127.0.0.1');
    expect(bindingOf(runA.manifest, 'api').container_port).toBe(8080);
    expect(runA.manifest.backend_origin).toBe(`http://127.0.0.1:${String(portA)}`);
    expect(runA.manifest.frontend_origin).toBeNull();
    expect(runA.h.adapter.namespaceFor(runA.h.run_id)).not.toBe(runB.h.adapter.namespaceFor(runB.h.run_id));
  });

  it('carries this run id and a single owner token on every ledger entry it created', () => {
    expect(runA.manifest.resources.length).toBeGreaterThan(0);
    expect(runA.manifest.resources.every((resource) => resource.run_id === runA.manifest.run_id)).toBe(true);
    expect(runA.manifest.resources.every((resource) => resource.created_by_stackgate === true)).toBe(true);
    expect(runA.manifest.resources.every((resource) => resource.cleanup_status === 'PENDING')).toBe(true);
    expect(runA.manifest.resources.every((resource) => /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(resource.owner_token))).toBe(true);
    expect(runA.manifest.resources.every((resource) => resource.creation_identity.length > 0)).toBe(true);
    expect(new Set(runA.manifest.resources.map((resource) => resource.owner_token)).size).toBe(1);
    expect(new Set(runA.manifest.resources.map((resource) => resource.native_id)).size).toBe(runA.manifest.resources.length);
    const types = new Set(runA.manifest.resources.map((resource) => resource.resource_type));
    expect(types.has('container')).toBe(true);
    expect(types.has('network')).toBe(true);
  });

  it('agrees with an independent docker inspection of the very container it created', async () => {
    const containerId = String(bindingOf(runA.manifest, 'api').container_id);
    expect(containerId).toMatch(/^[0-9a-f]{64}$/);
    const inspector = await harness();
    const actual = oneObject(await inspectObjects(inspector.adapter.command_port, [containerId], inspector.context), containerId);
    const binding = readPublishedBinding(actual, 8080, 'tcp');
    expect(binding.status).toBe('OBSERVED');
    expect(binding.host_ip).toBe('127.0.0.1');
    expect(binding.host_port).toBe(bindingOf(runA.manifest, 'api').host_port);
    expect(String(actual.Id)).toBe(containerId);
    expect(String((((actual.Config ?? {}) as { Labels?: Record<string, string> }).Labels ?? {})['com.docker.compose.project'])).toBe(runA.h.adapter.namespaceFor(runA.h.run_id));
    await cleanupRoots(inspector.root);
  });

  it('serves real bytes over the observed origin and never widens the policy to do it', async () => {
    const origin = String(runA.manifest.backend_origin);
    const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(8000) });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Directory listing');
    const planned = planServiceBindings([{ service: 'api', network_alias: 'api', container_port: 8080, protocol: 'tcp', host_ip: '127.0.0.1' }]);
    const recorded = recordObservedBindings(planned[0]!, { host_ip: '127.0.0.1', host_port: bindingOf(runA.manifest, 'api').host_port, scheme: 'http' });
    expect(recorded.diagnostics).toEqual([]);
    expect(recorded.binding.provenance).toBe('OBSERVED');
    expect(authorizeBindingOrigin(recorded.binding, { allowed_origins: [] }).decision).toBe('DENY');
    expect(authorizeBindingOrigin(recorded.binding, { allowed_origins: [origin] })).toMatchObject({ decision: 'ALLOW' });
    expect(bindingOf(runA.manifest, 'api').origin).toBe(origin);
  });

  it('writes a provenance snapshot whose stored bytes carry no credential-shaped input', () => {
    const names = runA.h.stored.map((entry) => entry.write.name);
    expect(names).toContain('compose-effective-config.json');
    expect(names).toContain('compose-start-evidence.json');
    expect(names).toContain('compose-resource-snapshot.json');
    const config = runA.h.stored.find((entry) => entry.write.name === 'compose-effective-config.json')!;
    const text = Buffer.from(config.write.bytes).toString('utf8');
    expect(text).not.toContain(SECRET_MARKER);
    expect(text).toContain('[REDACTED]');
    expect(config.write.sensitivity).toBe('restricted');
    expect(validateSchema('artifact', config.artifact).ok).toBe(true);
    expect(runA.manifest.provenance).toBe('OBSERVED');
    expect(runA.manifest.observations.length).toBeGreaterThanOrEqual(3);
    // the recorded image id is the id the created container actually runs, not the reference that was asked for
    expect(runA.manifest.image_ids).toEqual([expect.stringMatching(/^sha256:[0-9a-f]{64}$/)]);
    expect(String(runA.manifest.image_ids[0])).toBe(pinnedReferenceValue.slice(pinnedReferenceValue.indexOf('@sha256:') + 1));
  });

  it('accounts for exactly the daemon-side objects its own namespace owns', async () => {
    const namespace = runA.h.adapter.namespaceFor(runA.h.run_id);
    const listed = await enumerateProjectResources(runA.h.adapter.command_port, namespace, runA.h.context);
    expect(listed.containers).toEqual([bindingOf(runA.manifest, 'api').container_id]);
    expect(listed.networks.length).toBeGreaterThan(0);
    expect(new Set(runA.manifest.resources.map((resource) => resource.native_id))).toEqual(new Set([...listed.containers, ...listed.networks, ...listed.volumes]));
  });
});

/* ------------------------------------------------------------------ refusals, collisions and failure accounting ------------------------------------------------------------------ */

describe('SG-058 ownership, refusal and failure accounting', () => {
  let body = '';

  beforeAll(async () => {
    body = composeDocument(await pinnedReference());
  });

  it('refuses to adopt resources that already carry the namespace it would create', async () => {
    const entropy = () => 'b'.repeat(12);
    const first = await bringUp({ namespaceEntropy: entropy, body });
    expect(first.manifest.status).toBe('READY');

    // The namespace is derived from the run id *and* the entropy, so reusing only the entropy would build a
    // different namespace and collide with nothing: the premise of this case is a run that asks for the very
    // namespace the first run already owns. Two separate adapter instances, one real daemon-side collision.
    const second = await bringUp({ namespaceEntropy: entropy, body, run_id: first.h.run_id });
    expect(second.h.adapter.namespaceFor(second.h.run_id)).toBe(first.h.adapter.namespaceFor(first.h.run_id));
    expect(second.manifest.status).toBe('BLOCKED');
    expect(second.manifest.reasons.join(' ')).toContain('RESOURCE_ADOPTION_REFUSED');
    // and it says so before spawning anything, so the occupied namespace is never written to
    expect(second.h.invocations.filter((record) => record.purpose === 'up')).toEqual([]);
    // the occupied objects are still listed, but only as resources this run does not claim
    expect(second.manifest.resources.length).toBeGreaterThan(0);
    expect(second.manifest.resources.every((resource) => resource.created_by_stackgate === false && resource.cleanup_status === 'PRESERVED')).toBe(true);
    const inspector = await harness();
    const stillThere = oneObject(await inspectObjects(inspector.adapter.command_port, [String(bindingOf(first.manifest, 'api').container_id)], inspector.context), 'first run container');
    expect(String(((stillThere.State ?? {}) as { Status?: unknown }).Status)).toBe('running');
    await cleanupRoots(inspector.root, first.h.root, second.h.root);
  });

  it('puts resources created before a failed start into the ledger instead of losing them', async () => {
    const failed = await bringUp({ body: composeDocument('stackgate-sg058-missing-image:1.2.3', { pullNever: true }), revision: 'rev-sg058-fail' });
    expect(failed.manifest.status).toBe('BLOCKED');
    expect(failed.manifest.reasons.join(' ')).toMatch(/IMAGE_UNAVAILABLE|DOCKER_COMMAND_FAILED/);
    expect(validateSchema('environment', failed.manifest).ok).toBe(true);
    expect(failed.h.invocations.some((record) => record.argv.includes('pull'))).toBe(false);
    const listed = await enumerateProjectResources(failed.h.adapter.command_port, failed.h.adapter.namespaceFor(failed.h.run_id), failed.h.context);
    expect(listed.networks.length).toBeGreaterThan(0);
    expect(failed.manifest.resources.map((resource) => resource.native_id)).toEqual(expect.arrayContaining(listed.networks));
    expect(failed.manifest.resources.every((resource) => resource.created_by_stackgate && resource.cleanup_status === 'PENDING')).toBe(true);
    await cleanupRoots(failed.h.root);
  });

  it('reports a service that started and then exited as not ready while still accounting for it', async () => {
    const exited = await bringUp({ body: composeDocument(await pinnedReference(), { failing: true }), revision: 'rev-sg058-exited' });
    expect(exited.manifest.status).not.toBe('READY');
    expect(exited.manifest.reasons.join(' ')).toContain('SERVICE_NOT_RUNNING');
    const listed = await enumerateProjectResources(exited.h.adapter.command_port, exited.h.adapter.namespaceFor(exited.h.run_id), exited.h.context);
    expect(listed.containers.length).toBe(1);
    expect(exited.manifest.resources.map((resource) => resource.native_id)).toEqual(expect.arrayContaining(listed.containers));
    await cleanupRoots(exited.h.root);
  });

  it('refuses to certify a binding the daemon reports as unpublished instead of assuming a port', async () => {
    const internal = await bringUp({ body: composeDocument(await pinnedReference(), { internal: true }), revision: 'rev-sg058-internal' });
    // An `internal: true` network silently drops the published mapping. SG-057 approves that shape, so this
    // case pins what the real daemon does with it: no host binding, therefore no origin and no READY.
    expect(internal.manifest.status).toBe('BLOCKED');
    expect(internal.manifest.reasons.join(' ')).toContain('HOST_BINDING_ABSENT');
    expect(internal.manifest.bindings).toBeUndefined();
    const listed = await enumerateProjectResources(internal.h.adapter.command_port, internal.h.adapter.namespaceFor(internal.h.run_id), internal.h.context);
    expect(listed.containers.length).toBe(1);
    await cleanupRoots(internal.h.root);
  });

  it('creates nothing while the data revision is still unconfirmed', async () => {
    const prepared = await harness();
    await fs.writeFile(path.join(prepared.root, 'compose.sg058.yaml'), body, 'utf8');
    for (const revision of ['', 'UNCONFIRMED', `local-input-${'f'.repeat(64)}`]) {
      const manifest = await prepared.adapter.prepare(
        { run_id: prepared.run_id, environment_id: 'env_revision', input_hash: '1'.repeat(64), configuration: configuration('compose.sg058.yaml', revision), policy: BASE_POLICY },
        prepared.context,
      );
      expect(manifest.status).toBe('BLOCKED');
      expect(manifest.reasons.join(' ')).toContain('DATA_REVISION_UNCONFIRMED');
      expect(manifest.resources).toEqual([]);
    }
    expect(prepared.invocations).toEqual([]);
    await cleanupRoots(prepared.root);
  });

  it('refuses before creating anything when the profile demands CONTROLLED provenance', async () => {
    const prepared = await harness();
    await fs.writeFile(path.join(prepared.root, 'compose.sg058.yaml'), body, 'utf8');
    const manifest = await prepared.adapter.prepare(
      { run_id: prepared.run_id, environment_id: 'env_controlled', input_hash: '5'.repeat(64), configuration: configuration('compose.sg058.yaml', 'rev-sg058-controlled'), policy: { ...BASE_POLICY, minimum_provenance: 'CONTROLLED' } },
      prepared.context,
    );
    expect(manifest.status).toBe('BLOCKED');
    expect(manifest.reasons.join(' ')).toContain('CONTROLLED_NOT_CERTIFIABLE');
    expect(manifest.provenance).not.toBe('CONTROLLED');
    expect(prepared.invocations.filter((record) => record.purpose === 'up')).toEqual([]);
    await cleanupRoots(prepared.root);
  });

  it('does not upgrade a locally started environment to CONTROLLED even when CI claims it', async () => {
    const ci = await bringUp({ body, revision: 'rev-sg058-ci', extraEnvironment: { CI: 'true' } });
    expect(ci.manifest.status).toBe('READY');
    expect(ci.manifest.provenance).toBe('OBSERVED');
    const evidence = ci.h.stored.find((entry) => entry.write.name === 'compose-start-evidence.json')!;
    const text = Buffer.from(evidence.write.bytes).toString('utf8');
    expect(text).toContain('OBSERVED');
    expect(text).not.toContain('CONTROLLED');
    // the CI flag really was in the environment of the real compose command, and changed nothing
    expect(ci.h.invocations.some((record) => record.purpose === 'up')).toBe(true);
    await cleanupRoots(ci.h.root);
  });

  it('maps the recorded daemon port-allocation failure to a blocked environment, never to killing the occupant', () => {
    expect(classifyStartFailure(PORT_CONFLICT_STDERR)).toBe('HOST_PORT_CONFLICT');
    expect(classifyStartFailure('Error response from daemon: No such image: stackgate-sg058-missing-image:1.2.3')).toBe('IMAGE_UNAVAILABLE');
    expect(classifyStartFailure('error during build: Dockerfile not found')).toBe('BUILD_FAILED');
    expect(classifyStartFailure('Cannot connect to the Docker daemon at npipe:////./pipe/dockerDesktopLinuxEngine. Is the docker daemon running?')).toBe('DAEMON_UNREACHABLE');
    // recorded on this host: the CLI reaches the daemon but its compose plugin never loaded, so every
    // compose flag was reported against the root command instead (see the PROGRAMFILES note in provenance.ts)
    expect(classifyStartFailure('unknown flag: --short\n\nUsage:  docker [OPTIONS] COMMAND [ARG...]')).toBe('COMPOSE_UNAVAILABLE');
    expect(classifyStartFailure('something else entirely')).toBe('UNKNOWN_FAILURE');
  });

  it('rejects an image claim the daemon cannot confirm and accepts the identity it observed', async () => {
    const claimed = await bringUp({ body, revision: 'rev-sg058-image' });
    const containerId = String(bindingOf(claimed.manifest, 'api').container_id);
    const inspector = await harness();
    const container = oneObject(await inspectObjects(inspector.adapter.command_port, [containerId], inspector.context), containerId);
    const observedImage = String(container.Image);
    expect(observedImage).toMatch(/^sha256:[0-9a-f]{64}$/);
    const unknownImageClaim = verifyImageClaim({ claimed_image_id: `sha256:${'9'.repeat(64)}`, container, daemon_image_ids: claimed.manifest.image_ids });
    expect(unknownImageClaim.satisfied).toBe(false);
    expect(unknownImageClaim.reason).toBe('IMAGE_CLAIM_NOT_OBSERVED');
    expect(verifyImageClaim({ claimed_image_id: observedImage.slice(0, 12), container, daemon_image_ids: claimed.manifest.image_ids }).satisfied).toBe(false);
    expect(verifyImageClaim({ claimed_image_id: observedImage, container, daemon_image_ids: claimed.manifest.image_ids }).satisfied).toBe(true);
    await cleanupRoots(inspector.root, claimed.h.root);
  });

  it('leaves every created resource pending for SG-061 rather than cleaning it up here', async () => {
    const pending = await bringUp({ body, revision: 'rev-sg058-cleanup' });
    const namespace = pending.h.adapter.namespaceFor(pending.h.run_id);
    const before = await enumerateProjectResources(pending.h.adapter.command_port, namespace, pending.h.context);
    const result = await pending.h.adapter.cleanup({ run_id: pending.h.run_id, owner_token: pending.manifest.resources[0]!.owner_token, resources: pending.manifest.resources, signal: new AbortController().signal });
    expect(result.cleaned).toEqual([]);
    expect(result.preserved.length).toBe(pending.manifest.resources.length);
    expect(result.failed).toEqual([]);
    expect(result.diagnostics.map((diagnostic: Diagnostic) => diagnostic.rule_id)).toContain('SG-POLICY-COMPOSE-START-CLEANUP_RESERVED_FOR_SG061');
    const after = await enumerateProjectResources(pending.h.adapter.command_port, namespace, pending.h.context);
    expect(after).toEqual(before);
    expect(after.containers.length).toBeGreaterThan(0);
    await cleanupRoots(pending.h.root);
  });

  it('keeps observe() honest about an input hash it did not expect', async () => {
    const observer = await bringUp({ body, revision: 'rev-sg058-observe' });
    const unchanged = await observer.h.adapter.observe({ manifest: observer.manifest, expected_input_hash: 'c'.repeat(64), signal: new AbortController().signal });
    expect(unchanged.reasons.join(' '), JSON.stringify(unchanged.reasons)).toBe('');
    expect(unchanged.status).toBe('READY');
    expect(unchanged.resources.length).toBe(observer.manifest.resources.length);
    const mismatched = await observer.h.adapter.observe({ manifest: observer.manifest, expected_input_hash: '7'.repeat(64), signal: new AbortController().signal });
    expect(mismatched.status).toBe('BLOCKED');
    expect(mismatched.reasons.join(' ')).toContain('ENV_INPUT_MISMATCH');
    await cleanupRoots(observer.h.root);
  });

  it('derives distinct run identities for the same run id and a stable one for a given entropy', () => {
    const first = composeProjectNamespace('run_sg058_identity', undefined);
    const second = composeProjectNamespace('run_sg058_identity', undefined);
    expect(first).not.toBe(second);
    expect(composeProjectNamespace('run_sg058_identity', 'cccccccccccc')).toBe(composeProjectNamespace('run_sg058_identity', 'cccccccccccc'));
    expect(composeOwnerToken('d'.repeat(24))).toBe(composeOwnerToken('d'.repeat(24)));
    expect(composeOwnerToken()).not.toBe(composeOwnerToken());
    expect(composeOwnerToken('e'.repeat(24))).toMatch(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/);
  });
});
