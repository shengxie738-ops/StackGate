import { expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Artifact, EnvironmentCleanup, EnvironmentFinalization, EnvironmentManifest, EffectivePolicy, RunManifest } from '../../../packages/contracts/src/index.js';
import { validateSchema } from '../../../packages/contracts/src/index.js';
import type { ExecutionContext } from '../../../packages/core/src/ports/adapter.js';
import type { EnvironmentRequest } from '../../../packages/core/src/ports/environment.js';
import { FileEvidenceStore } from '../../../packages/core/src/storage/file-evidence-store.js';
import { assessEnvironment, type ConfirmedEnvironmentRequirements } from '../../../packages/core/src/services/environment-assessment.js';
import { AttachAdapter } from '../../../packages/adapter-compose/src/attach/adapter.js';
import {
  ATTACH_REFUSAL_CODES, PROVENANCE_CHECKS, collectAttachRecordEvidence, verifyAttachProvenance,
} from '../../../packages/adapter-compose/src/attach/provenance.js';
import { observeLiveProcessIdentity, observeListeningProcess } from '../../../packages/adapter-compose/src/attach/process-observation.js';
import { withTestDirectory } from '../../support/test-paths.js';

/**
 * SG-056 integration suite: attach provenance over two real services.
 *
 * Every case below starts the demo's real FastAPI application twice through the SG-055 test-only launcher,
 * on two OS-assigned loopback ports, and then asks whether the stack can tell the two instances apart.
 * Nothing is mocked: the health responses are real HTTP responses, the start records are the bytes the
 * launcher processes committed, the live process facts are read from the operating system, and the only
 * processes that ever get killed are the two this file spawned and holds handles for.
 */
vi.setConfig({ testTimeout: 240000 });

const apiRoot = path.resolve('examples/contract-drift-demo/apps/api');
const python = process.platform === 'win32' ? 'python' : 'python3';
// Replaced, not inherited, exactly as SG-055 does: no proxy and no user credential reaches these services.
const baseEnv: NodeJS.ProcessEnv = {
  SystemRoot: process.env.SystemRoot ?? '', PATH: process.env.PATH ?? '', TEMP: process.env.TEMP ?? '',
  TMP: process.env.TMP ?? '', APPDATA: process.env.APPDATA ?? '', PYTHONIOENCODING: 'utf-8',
};
const RUN = 'run_sg056_attach';
const CHECK = 'environment_attach';
const ATTEMPT = 'attempt_sg056_1';
const ENVIRONMENT = 'test_api';
const SERVICE = 'api';
const HEALTH_OPERATION = 'api:GET /health';
const HEALTH_PATH = '/health';
const INPUT_HASH = createHash('sha256').update('stackgate-sg056-candidate-input').digest('hex');
const OTHER_INPUT_HASH = createHash('sha256').update('stackgate-sg056-other-candidate-input').digest('hex');

type Instance = {
  child: ChildProcess;
  pid: number;
  port: number;
  origin: string;
  instanceId: string;
  dataRevision: string;
  stateDirectory: string;
  recordPath: string;
  /** Repository/test-root-relative POSIX form, which is what an attach configuration carries. */
  recordRelative: string;
  record: Record<string, unknown>;
  recordBytes: Buffer;
  recordDigest: string;
  /** Resolves with the launcher's own exit code; only ever used to reap a process this file started. */
  exited: Promise<number | null>;
  stderr: string;
};

/** Starts one real instance of the sample API through the test-only launcher and reads back its own record. */
async function startInstance(root: string, name: string, inputHash: string): Promise<Instance> {
  // Under `instances/`, so the path pattern the attach configuration is authorised against covers the record.
  const stateDirectory = path.join(root, 'instances', name, 'state');
  await fs.mkdir(stateDirectory, { recursive: true });
  const child = spawn(python, ['-B', '-E', 'scripts/launch_test_api.py'], {
    cwd: apiRoot,
    env: {
      ...baseEnv, STACKGATE_STATE_DIR: stateDirectory, STACKGATE_ALLOWED_RUN_IDS: RUN, STACKGATE_INPUT_HASH: inputHash,
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const exited = new Promise<number | null>(resolve => child.on('close', code => resolve(code)));
  const ready = await new Promise<Record<string, unknown>>((resolve, reject) => {
    let buffered = '';
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString('utf8');
      const newline = buffered.indexOf('\n');
      if (newline >= 0) {
        child.stdout?.off('data', onData);
        try { resolve(JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>); }
        catch (error) { reject(error as Error); }
        return;
      }
      if (buffered.length > 65536) {
        child.stdout?.off('data', onData);
        reject(new Error(`launcher prelude exceeded 64 KiB: ${buffered.slice(0, 200)}`));
      }
    };
    child.stdout?.on('data', onData);
    child.on('error', error => { child.stdout?.off('data', onData); reject(error); });
    void exited.then(code => {
      child.stdout?.off('data', onData);
      if (buffered.indexOf('\n') < 0) reject(new Error(`launcher exited with ${String(code)} before it was ready: ${stderr}`));
    });
  });
  const recordPath = String(ready.start_record);
  const recordBytes = await fs.readFile(recordPath);
  const record = JSON.parse(recordBytes.toString('utf8')) as Record<string, unknown>;
  return {
    child,
    pid: Number(ready.pid),
    port: Number(ready.port),
    origin: String(ready.origin),
    instanceId: String(ready.instance_id),
    dataRevision: String(ready.data_revision),
    stateDirectory,
    recordPath,
    recordRelative: path.relative(root, recordPath).split(path.sep).join('/'),
    record,
    recordBytes,
    recordDigest: createHash('sha256').update(recordBytes).digest('hex'),
    exited,
    stderr,
  };
}

/** Kills only the child handle this file created, and waits for it so no service is left running behind us. */
async function stopInstance(instance: Instance): Promise<void> {
  instance.child.kill();
  const settled = await Promise.race([instance.exited, new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 30000))]);
  if (settled === 'timeout') throw new Error(`launcher pid ${String(instance.pid)} did not exit after the kill this file issued`);
  if (processAlive(instance.pid)) throw new Error(`launcher pid ${String(instance.pid)} survived the kill this file issued`);
}

/** Existence only: signal 0 asks the operating system whether the process is there, and never signals it. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code !== 'ESRCH';
  }
}

type Health = { status: number; mediaType: string | null; bytes: Buffer; digest: string };

/** The same bounded single request the adapter is allowed to make: literal path, no redirects, hard deadline. */
async function getHealth(origin: string): Promise<Health> {
  const response = await fetch(`${origin}${HEALTH_PATH}`, {
    method: 'GET', redirect: 'error', headers: { accept: 'application/json', 'accept-encoding': 'identity' },
    signal: AbortSignal.timeout(15000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, mediaType: response.headers.get('content-type'), bytes, digest: createHash('sha256').update(bytes).digest('hex') };
}

/** A real run in a real store, so every reference below is an artifact id the store actually handed out. */
async function createStoreRun(root: string): Promise<FileEvidenceStore> {
  const fixture = JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json', 'utf8')) as RunManifest;
  // The store insists its state root already exists; each attach case gets its own directory inside the test root.
  await fs.mkdir(root, { recursive: true });
  const store = new FileEvidenceStore({ stateRoot: root, owner: { repo_id: 'repo_fixture', worktree_id: 'worktree_fixture' } });
  await store.createRun({
    ...structuredClone(fixture), run_id: RUN, input_hash: INPUT_HASH, plan_hash: INPUT_HASH, policy_hash: INPUT_HASH,
    phase: 'CREATED', verdict: 'INCOMPLETE', started_at: null, finished_at: null, checks: [],
    artifact_refs: [], environment_ref: null, data_revision: 'revision_of_the_attached_service',
  });
  return store;
}

function attachManifest(record: Record<string, unknown>, patch: Partial<EnvironmentManifest> = {}): EnvironmentManifest {
  const creation = record.process_creation as Record<string, unknown>;
  return {
    schema_version: '0.1', run_id: RUN, mode: 'attach', status: 'READY',
    frontend_origin: null, backend_origin: String(record.origin), instance_id: String(record.instance_id),
    // The level a health-200-only attach could write today, because the field is just text in a document.
    provenance: 'OBSERVED', input_hash: INPUT_HASH, image_ids: [], data_revision: 'revision_of_the_attached_service',
    resources: [{
      run_id: RUN, owner_token: 'owner_sg056', resource_type: 'process', native_id: `pid-${String(record.pid)}`,
      created_at: String(creation.created_at), creation_identity: String(creation.creation_identity),
      created_by_stackgate: false, cleanup_status: 'PRESERVED',
    }],
    observations: [], reasons: [], ...patch,
  };
}

function finalizeRecord(record: Record<string, unknown>): EnvironmentFinalization {
  return {
    schema_version: '0.1', run_id: RUN, phase: 'finalize', observed_at: new Date().toISOString(),
    provenance: 'OBSERVED', instance_id: String(record.instance_id), input_hash: INPUT_HASH,
    data_revision: 'revision_of_the_attached_service', frontend_origin: null, backend_origin: String(record.origin),
    requests_observed: 1, instance_changed: false, evidence_refs: ['evidence_finalize_placeholder'], reasons: [],
  };
}

function cleanupRecord(record: Record<string, unknown>): EnvironmentCleanup {
  const manifest = attachManifest(record);
  return {
    schema_version: '0.1', run_id: RUN, cleaned_at: new Date().toISOString(), status: 'PRESERVED', trigger: 'COMPLETED',
    resources: manifest.resources.map(resource => ({ ...resource, ownership_basis: 'attach ledger entry: this run did not create the process' })),
    evidence_refs: ['evidence_cleanup_placeholder'], reasons: [],
  };
}

function requirements(origin: string, patch: Partial<ConfirmedEnvironmentRequirements> = {}): ConfirmedEnvironmentRequirements {
  return {
    required_by_profile: true, required_by_task: true, requires_backend_observation: false,
    minimum_provenance: 'OBSERVED', expected_data_revision: 'revision_of_the_attached_service',
    expected_origins: { frontend: null, backend: origin }, required_operations: [], ...patch,
  };
}

it('a healthy response is not provenance: two live instances look identical and a copied record still satisfies the core', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    const b = await startInstance(root, 'b', INPUT_HASH);
    try {
      expect(a.pid).not.toBe(b.pid);
      expect(a.origin).not.toBe(b.origin);
      expect(a.instanceId).not.toBe(b.instanceId);

      const healthA = await getHealth(a.origin);
      const healthB = await getHealth(b.origin);
      expect(healthA.status).toBe(200);
      expect(healthB.status).toBe(200);
      // The response a health check can see is byte-identical for two different instances...
      expect(healthA.digest).toBe(healthB.digest);
      expect(healthA.bytes.toString('utf8')).toBe(JSON.stringify({ status: 'ready' }));

      // ...so the only thing that could tell them apart is the start record, and a start record is a file.
      const copiedPath = path.join(b.stateDirectory, 'launcher.copy.json');
      await fs.copyFile(a.recordPath, copiedPath, fs.constants.COPYFILE_EXCL);
      const copied = JSON.parse(await fs.readFile(copiedPath, 'utf8')) as Record<string, unknown>;
      expect(copied.pid).toBe(a.pid);
      expect(copied.origin).toBe(a.origin);
      expect(copied.instance_id).toBe(a.instanceId);
      // The copy is byte-identical to the original, so any digest of the record file itself matches too:
      // checking that the record is intact proves nothing about which process is answering.
      expect(createHash('sha256').update(await fs.readFile(copiedPath)).digest('hex')).toBe(a.recordDigest);
      // And a prepare document built from it is structurally perfect against the versioned schema.
      expect(validateSchema('environment', attachManifest(copied)).ok).toBe(true);

      // And the deterministic core, which never looks at a process, accepts a prepare document that only
      // asserts OBSERVED. The origin and instance it vouches for are A's, while B is the service the run
      // is attached to; nothing in this path could notice, which is the gap SG-056 has to close.
      const store = await createStoreRun(root);
      const prepare = await store.store({ run_id: RUN, check_id: null, attempt_id: null }, {
        kind: 'document', value: { kind: 'environment', value: attachManifest(copied) },
      });
      const finalization = await store.store({ run_id: RUN, check_id: null, attempt_id: null }, {
        kind: 'document', value: { kind: 'environment-finalization', value: finalizeRecord(copied) },
      });
      const cleanup = await store.store({ run_id: RUN, check_id: null, attempt_id: null }, {
        kind: 'document', value: { kind: 'environment-cleanup', value: cleanupRecord(copied) },
      });
      const assessment = assessEnvironment({
        run_id: RUN, expected_input_hash: INPUT_HASH, requirements: requirements(String(copied.origin)),
        run_window: { started_at: '2026-09-20T00:00:00Z', finished_at: new Date().toISOString() },
        prepare: attachManifest(copied), finalization: finalizeRecord(copied), cleanup: cleanupRecord(copied),
        observations: [], authenticated_refs: [prepare.artifact_id, finalization.artifact_id, cleanup.artifact_id],
        authenticated_digests: {},
        prepare_ref: prepare.artifact_id, finalization_ref: finalization.artifact_id, cleanup_ref: cleanup.artifact_id,
      });
      expect(assessment.satisfied, JSON.stringify(assessment.reasons)).toBe(true);
      expect(assessment.provenance).toBe('OBSERVED');

      // Both real services are still running: nothing here stopped anything, and the two ports are distinct.
      expect(processAlive(a.pid), os.platform()).toBe(true);
      expect(processAlive(b.pid)).toBe(true);
    } finally {
      await stopInstance(a);
      await stopInstance(b);
    }
  });
});

// ---------------------------------------------------------------------------------------
// The attach adapter: does it keep "answers 200" apart from "is provably this instance"?
// ---------------------------------------------------------------------------------------

const OWNER = 'owner_sg056_attach';
const FRONTEND = 'http://127.0.0.1:4173';

function policy(origins: readonly string[], paths: readonly string[] = ['instances/**']): EffectivePolicy {
  return {
    schema_version: '0.1', policy_id: 'policy_sg056_attach', policy_hash: INPUT_HASH,
    required_set: ['attach-smoke'], allowed_origins: [...origins], allowed_paths: [...paths],
    protected_inputs: ['examples/contract-drift-demo/**'], minimum_provenance: 'OBSERVED',
    approved_change_records: [], flaky_policy: 'incomplete', source: 'local-review',
  };
}

type AttachOptions = {
  origins?: readonly string[]; paths?: readonly string[]; backend_origin?: string; health_path?: string;
  provenance_file?: string; input_hash?: string; data_revision?: string | null; health_operation?: string | null;
  environment_id?: string; slot?: string;
};

/** The relative provenance path a configuration would carry for one of these instances. */
const recordOf = (name: string, file = 'launcher.json'): string => `instances/${name}/state/${file}`;

function attachRequest(instance: Instance, options: AttachOptions & { name: string }): EnvironmentRequest {
  return {
    run_id: RUN, environment_id: options.environment_id ?? ENVIRONMENT, input_hash: options.input_hash ?? INPUT_HASH,
    configuration: {
      mode: 'attach', frontend_origin: FRONTEND,
      backend_origin: options.backend_origin ?? instance.origin,
      health_path: options.health_path ?? HEALTH_PATH,
      // The configuration names a relative path; what sits there now is the question this suite answers.
      provenance_file: options.provenance_file ?? recordOf(options.name),
    },
    policy: policy(options.origins ?? [instance.origin, FRONTEND], options.paths),
  };
}

/** A real run-scoped artifact writer, so every snapshot below is evidence the store itself accepted. */
function makeHarness(store: FileEvidenceStore, allowedOrigins: readonly string[]) {
  const writes: { name: string; bytes: Buffer; artifact: Artifact }[] = [];
  const commandCalls: string[] = [];
  const controller = new AbortController();
  const context: ExecutionContext = {
    run_id: RUN, check_id: CHECK, attempt_id: ATTEMPT,
    allowed_paths: ['instances/**'], allowed_origins: [...allowedOrigins],
    environment: {}, signal: controller.signal,
    // Any command through the authorised runner would be a start/stop attempt: attach must never do either.
    commands: { run: async (command_id: string) => { commandCalls.push(command_id); throw new Error(`AttachAdapter must not run a command, tried: ${command_id}`); } },
    log: { append: async () => undefined },
    artifacts: {
      store: async input => {
        const artifact = await store.store({ run_id: RUN, check_id: CHECK, attempt_id: ATTEMPT }, { kind: 'artifact', value: input });
        writes.push({ name: input.name, bytes: Buffer.from(input.bytes), artifact });
        return artifact;
      },
    },
    clock: { now: () => new Date().toISOString() },
    ids: { create: kind => `${kind}_${randomUUID().replace(/-/g, '').slice(0, 16)}` },
  };
  return { context, writes, commandCalls, controller };
}

function adapterFor(options: { data_revision?: string | null; health_operation?: string | null }, root: string): AttachAdapter {
  return new AttachAdapter({
    // The declared relative path resolves against this root, exactly as it would against a repository root.
    repo_root: root, source_roots: [apiRoot, path.resolve('.')],
    service_id: SERVICE, health_operation_key: options.health_operation === undefined ? HEALTH_OPERATION : options.health_operation,
    expected_data_revision: options.data_revision === undefined ? null : options.data_revision,
    owner_token: OWNER,
  });
}

/** Everything one attach case needs: a store, a harness, an adapter, the prepared manifest and its evidence. */
async function attachTo(instance: Instance, root: string, name: string, options: AttachOptions = {}) {
  // Each attach gets its own run store, so two attaches in one case can never share or overwrite evidence.
  const store = await createStoreRun(path.join(root, 'stores', options.slot ?? 'main'));
  const harness = makeHarness(store, options.origins ?? [instance.origin, FRONTEND]);
  const adapter = adapterFor({
    data_revision: options.data_revision === undefined ? instance.dataRevision : options.data_revision,
    ...(options.health_operation === undefined ? {} : { health_operation: options.health_operation }),
  }, root);
  const request = attachRequest(instance, { ...options, name });
  const manifest = await adapter.prepare(request, harness.context);
  const snapshots = harness.writes.map(write => ({ name: write.name, bytes: write.bytes, artifact: write.artifact, document: JSON.parse(write.bytes.toString('utf8')) as Record<string, unknown> }));
  return { store, harness, adapter, request, manifest, snapshots };
}

/** Read a manifest back the way the run would: prepare, then consistent finalize and cleanup documents. */
async function assessAttached(root: string, slot: string, prepare: EnvironmentManifest, minimum: ConfirmedEnvironmentRequirements['minimum_provenance'] = 'OBSERVED') {
  const store = await createStoreRun(path.join(root, 'stores', `assess-${slot}`));
  const prepareArtifact = await store.store({ run_id: RUN, check_id: null, attempt_id: null }, { kind: 'document', value: { kind: 'environment', value: prepare } });
  const finalization: EnvironmentFinalization = {
    schema_version: '0.1', run_id: RUN, phase: 'finalize', observed_at: new Date().toISOString(),
    provenance: prepare.provenance, instance_id: prepare.instance_id, input_hash: prepare.input_hash,
    data_revision: prepare.data_revision, frontend_origin: prepare.frontend_origin, backend_origin: prepare.backend_origin,
    requests_observed: 1, instance_changed: false, evidence_refs: [prepareArtifact.artifact_id], reasons: [],
  };
  const finalizationArtifact = await store.store({ run_id: RUN, check_id: null, attempt_id: null }, { kind: 'document', value: { kind: 'environment-finalization', value: finalization } });
  const cleanup: EnvironmentCleanup = {
    schema_version: '0.1', run_id: RUN, cleaned_at: new Date(Date.now() + 1000).toISOString(), status: 'PRESERVED', trigger: 'COMPLETED',
    resources: prepare.resources.map(resource => ({ ...resource, ownership_basis: 'attach ledger entry: this run did not create the process' })),
    evidence_refs: [finalizationArtifact.artifact_id], reasons: [],
  };
  const cleanupArtifact = await store.store({ run_id: RUN, check_id: null, attempt_id: null }, { kind: 'document', value: { kind: 'environment-cleanup', value: cleanup } });
  const assessment = assessEnvironment({
    run_id: RUN, expected_input_hash: prepare.input_hash,
    requirements: {
      required_by_profile: true, required_by_task: true, requires_backend_observation: false, minimum_provenance: minimum,
      // The revision the attached service reports, so provenance alone is what decides the verdict here.
      expected_data_revision: prepare.data_revision,
      expected_origins: { frontend: prepare.frontend_origin, backend: prepare.backend_origin }, required_operations: [],
    },
    run_window: { started_at: '2026-09-20T00:00:00Z', finished_at: new Date(Date.now() + 60000).toISOString() },
    prepare, finalization, cleanup, observations: [],
    authenticated_refs: [prepareArtifact.artifact_id, finalizationArtifact.artifact_id, cleanupArtifact.artifact_id],
    authenticated_digests: {},
    prepare_ref: prepareArtifact.artifact_id, finalization_ref: finalizationArtifact.artifact_id, cleanup_ref: cleanupArtifact.artifact_id,
  });
  return { assessment, artifacts: { prepareArtifact, finalizationArtifact, cleanupArtifact } };
}

const creationOf = (record: Record<string, unknown>): string => String((record.process_creation as Record<string, unknown>).creation_identity);

it('attests OBSERVED for the instance whose start record matches a live process, and the core accepts it', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    try {
      const attached = await attachTo(a, root, 'a');
      const { manifest } = attached;
      const shape = validateSchema('environment', manifest);
      expect(shape.ok, shape.ok ? 'accepted' : JSON.stringify(shape.diagnostics)).toBe(true);
      expect(manifest.mode).toBe('attach');
      expect(manifest.status).toBe('READY');
      expect(manifest.provenance, JSON.stringify({
        reasons: manifest.reasons,
        checks: (attached.snapshots[0]?.document.checks as { name: string; result: string; detail: string }[] | undefined)
          ?.filter(check => check.result !== 'MATCH'),
      })).toBe('OBSERVED');
      expect(manifest.instance_id).toBe(a.instanceId);
      expect(manifest.data_revision).toBe(a.dataRevision);
      expect(manifest.backend_origin).toBe(a.origin);
      expect(manifest.reasons).toEqual([]);
      // The ledger names the process as a foreign resource this run will not delete.
      expect(manifest.resources).toHaveLength(1);
      expect(manifest.resources[0]!.native_id).toBe(`pid-${String(a.pid)}`);
      expect(manifest.resources[0]!.created_by_stackgate).toBe(false);
      expect(manifest.resources[0]!.cleanup_status).toBe('PRESERVED');
      expect(manifest.resources[0]!.creation_identity).toBe(creationOf(a.record));

      // The retained evidence names the facts it compared, and the identity came from the operating system.
      expect(attached.snapshots.map(snapshot => snapshot.name)).toEqual([`attach-prepare-${ENVIRONMENT}.json`]);
      const snapshot = attached.snapshots[0]!.document;
      expect(snapshot.kind).toBe('stackgate-attach-provenance');
      expect(snapshot.provenance).toBe('OBSERVED');
      expect(snapshot.bound_origin).toBe(a.origin);
      expect(snapshot.probes_performed).toBe(1);
      const live = snapshot.live as Record<string, Record<string, unknown>>;
      expect(live.identity!.status).toBe('OBSERVED');
      expect(String(live.identity!.mechanism)).toContain('GetProcessById');
      expect(live.identity!.creation_identity).toBe(creationOf(a.record));
      expect(live.listener!.status).toBe('OBSERVED');
      expect(live.listener!.pid).toBe(a.pid);
      const checks = snapshot.checks as { name: string; result: string; detail: string }[];
      expect(checks.map(check => check.name)).toContain(PROVENANCE_CHECKS.CREATION_IDENTITY_LIVE);
      const unmatched = checks.filter(check => check.result !== 'MATCH').map(check => check.name);
      expect(unmatched, JSON.stringify(unmatched)).toEqual([]);

      // Nothing was started or stopped: not one command went through the authorised runner.
      expect(attached.harness.commandCalls).toEqual([]);
      expect(processAlive(a.pid)).toBe(true);

      const { assessment } = await assessAttached(root, 'observed', manifest);
      expect(assessment.satisfied, JSON.stringify(assessment.reasons)).toBe(true);
      expect(assessment.provenance).toBe('OBSERVED');
    } finally {
      await stopInstance(a);
    }
  });
});

it('records DECLARED for a service that answers healthily but has no start record, and the core refuses it', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    try {
      // The same live, healthy service; the only difference is that the provenance file is not there.
      const attached = await attachTo(a, root, 'a', { provenance_file: recordOf('a', 'absent.json') });
      const healthyWithoutProvenance = attached.manifest;
      expect(healthyWithoutProvenance.status).toBe('READY');
      expect(healthyWithoutProvenance.provenance).toBe('DECLARED');
      expect(healthyWithoutProvenance.instance_id).toBeNull();
      expect(healthyWithoutProvenance.data_revision).toBe('UNATTESTED');
      expect(healthyWithoutProvenance.reasons).toContain(ATTACH_REFUSAL_CODES.RECORD_UNREADABLE);

      // The health answer really happened, which is the whole point: a 200 is not a provenance.
      const health = attached.snapshots[0]!.document.health as Record<string, unknown>;
      expect(health.requested).toBe(true);
      expect(health.status_code).toBe(200);
      expect(attached.snapshots[0]!.document.provenance).toBe('DECLARED');

      const { assessment } = await assessAttached(root, 'declared', healthyWithoutProvenance);
      expect(assessment.satisfied).toBe(false);
      expect(assessment.provenance).toBe('DECLARED');
      // Everything else in the documents is consistent, so provenance alone is what refuses the run.
      expect(assessment.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');
      expect(processAlive(a.pid), 'the refused attach left the service running').toBe(true);
    } finally {
      await stopInstance(a);
    }
  });
});

it('refuses a start record copied into another directory although every other fact still matches', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    try {
      // Reproduce the attack the card names: a stale or copied provenance file with the right hashes in it.
      const relocated = path.join(root, 'instances', 'relocated', 'state');
      await fs.mkdir(relocated, { recursive: true });
      const copiedPath = path.join(relocated, 'launcher.json');
      await fs.copyFile(a.recordPath, copiedPath, fs.constants.COPYFILE_EXCL);
      expect(createHash('sha256').update(await fs.readFile(copiedPath)).digest('hex')).toBe(a.recordDigest);

      const attached = await attachTo(a, root, 'relocated', {
        provenance_file: recordOf('relocated'), slot: 'copied',
      });
      expect(attached.manifest.status, 'the service really is healthy').toBe('READY');
      expect(attached.manifest.provenance).toBe('DECLARED');
      expect(attached.manifest.instance_id).toBeNull();
      expect(attached.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.RECORD_MOVED);

      // The refusal is specifically the copy: with the same bytes in their own directory it becomes OBSERVED.
      const checks = attached.snapshots[0]!.document.checks as { name: string; result: string; detail: string }[];
      const moved = checks.find(check => check.name === PROVENANCE_CHECKS.RECORD_DIRECTORY_CONSISTENCY);
      expect(moved?.result).toBe('MISMATCH');
      expect(moved?.detail).toContain('read from');
      const matched = checks.filter(check => check.result === 'MATCH').map(check => check.name);
      // Live process, live listener, confirmed input hash, confirmed origin, health: all still agree with A.
      expect(matched).toContain(PROVENANCE_CHECKS.PROCESS_RUNNING);
      expect(matched).toContain(PROVENANCE_CHECKS.CREATION_IDENTITY_LIVE);
      expect(matched).toContain(PROVENANCE_CHECKS.LISTENER_OWNERSHIP);
      expect(matched).toContain(PROVENANCE_CHECKS.INPUT_HASH_CONFIRMED);
      expect(matched).toContain(PROVENANCE_CHECKS.CONFIRMED_ORIGIN);
      expect(matched).toContain(PROVENANCE_CHECKS.HEALTH_ANSWERED);

      const honest = await attachTo(a, root, 'a', { slot: 'honest' });
      expect(honest.manifest.provenance).toBe('OBSERVED');
      expect(processAlive(a.pid)).toBe(true);
    } finally {
      await stopInstance(a);
    }
  });
});

it('refuses a forged pid: a live process is evidence only when it is the process the record names', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    try {
      // Rewrite only the pid: the forged record still points at a real, live process (this test worker).
      const forged = { ...a.record, pid: process.pid } as Record<string, unknown>;
      const forgedPath = path.join(a.stateDirectory, 'forged.json');
      await fs.writeFile(forgedPath, `${JSON.stringify(forged, null, 2)}\n`, 'utf8');

      const attached = await attachTo(a, root, 'a', { provenance_file: recordOf('a', 'forged.json'), slot: 'forged' });
      expect(attached.manifest.provenance).toBe('DECLARED');
      expect(attached.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.CREATION_IDENTITY_MISMATCH);
      expect(attached.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.LISTENER_OWNERSHIP_MISMATCH);
      const live = attached.snapshots[0]!.document.live as Record<string, Record<string, unknown>>;
      expect(live.identity!.status).toBe('OBSERVED');
      expect(live.identity!.pid).toBe(process.pid);
      expect(live.identity!.creation_identity).not.toBe(creationOf(a.record));
      // The port really is owned by somebody live; it simply is not the process the forged record claims.
      expect(live.listener!.status).toBe('OBSERVED');
      expect(live.listener!.pid).toBe(a.pid);

      // Nothing about the forgery disturbed the service, and the honest record still attests it.
      const health = await getHealth(a.origin);
      expect(health.status).toBe(200);
      expect(attached.harness.commandCalls).toEqual([]);
      expect(processAlive(a.pid)).toBe(true);
    } finally {
      await stopInstance(a);
    }
  });
});

it('refuses a record whose process is gone, a different candidate input and a different data revision', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    const staleDigest = a.recordDigest;
    // A run that started and stopped the service: the record it left behind stays perfectly valid on disk.
    await stopInstance(a);
    expect(processAlive(a.pid)).toBe(false);
    const gone = await attachTo(a, root, 'a', { slot: 'gone', origins: [a.origin, FRONTEND] });
    expect(gone.manifest.status).toBe('BLOCKED');
    expect(gone.manifest.provenance).toBe('DECLARED');
    expect(gone.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.PROCESS_NOT_RUNNING);
    expect(gone.snapshots[0]!.document.provenance_file).toMatchObject({ digest: staleDigest, readable: true });
    const goneChecks = gone.snapshots[0]!.document.checks as { name: string; result: string }[];
    expect(goneChecks.find(check => check.name === PROVENANCE_CHECKS.PROCESS_RUNNING)?.result).toBe('MISMATCH');

    const b = await startInstance(root, 'b', INPUT_HASH);
    try {
      // The right record, but the run was created for a different candidate input.
      const wrongInput = await attachTo(b, root, 'b', { input_hash: OTHER_INPUT_HASH, slot: 'input' });
      expect(wrongInput.manifest.provenance).toBe('DECLARED');
      expect(wrongInput.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.INPUT_HASH_MISMATCH);

      // The right record and input, but a data revision this run never confirmed.
      const wrongRevision = await attachTo(b, root, 'b', { data_revision: 'revision_somebody_elses_dataset', slot: 'revision' });
      expect(wrongRevision.manifest.provenance).toBe('DECLARED');
      expect(wrongRevision.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.DATA_REVISION_MISMATCH);

      // And a run that never confirmed a data revision at all: an attach may not invent one (ADR-012 §4).
      const unconfirmed = await attachTo(b, root, 'b', { data_revision: null, slot: 'unconfirmed' });
      expect(unconfirmed.manifest.provenance).toBe('DECLARED');
      expect(unconfirmed.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.DATA_REVISION_UNCONFIRMED);

      // Both services from this file are long gone or untouched; nothing here was started by the adapter.
      expect(wrongInput.harness.commandCalls).toEqual([]);
      expect(processAlive(b.pid)).toBe(true);
    } finally {
      await stopInstance(b);
    }
  });
});

it('keeps two live services with identical health bodies from being interchangeable', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    const b = await startInstance(root, 'b', INPUT_HASH);
    try {
      const healthA = await getHealth(a.origin);
      const healthB = await getHealth(b.origin);
      expect(healthA.status).toBe(200);
      expect(healthB.status).toBe(200);
      // The responses a health check can see are the same bytes, so they cannot be the discriminator.
      expect(healthA.digest).toBe(healthB.digest);

      const attachedA = await attachTo(a, root, 'a', { slot: 'pair-a' });
      const attachedB = await attachTo(b, root, 'b', { slot: 'pair-b' });
      expect(attachedA.manifest.provenance).toBe('OBSERVED');
      expect(attachedB.manifest.provenance).toBe('OBSERVED');
      expect(attachedA.manifest.instance_id).toBe(a.instanceId);
      expect(attachedB.manifest.instance_id).toBe(b.instanceId);
      expect(attachedA.manifest.instance_id).not.toBe(attachedB.manifest.instance_id);
      expect(attachedA.manifest.resources[0]!.native_id).toBe(`pid-${String(a.pid)}`);
      expect(attachedB.manifest.resources[0]!.native_id).toBe(`pid-${String(b.pid)}`);
      // The origin recorded for each attach is the one its own evidence bound it to, not a shared guess.
      expect(attachedA.snapshots[0]!.document.bound_origin).toBe(a.origin);
      expect(attachedB.snapshots[0]!.document.bound_origin).toBe(b.origin);
      expect(attachedA.snapshots[0]!.document.start_record).toMatchObject({ pid: a.pid, instance_id: a.instanceId });
      expect(attachedB.snapshots[0]!.document.start_record).toMatchObject({ pid: b.pid, instance_id: b.instanceId });

      // Hand B's own record to the attach that is bound to A's origin: refused, and it stays refused.
      const swapped = await attachTo(a, root, 'a', { slot: 'swap', provenance_file: recordOf('b') });
      expect(swapped.manifest.provenance).toBe('DECLARED');
      expect(swapped.manifest.instance_id).toBeNull();
      expect(swapped.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.ORIGIN_NOT_CONFIRMED);
      const swappedChecks = swapped.snapshots[0]!.document.checks as { name: string; result: string }[];
      expect(swappedChecks.find(check => check.name === PROVENANCE_CHECKS.CONFIRMED_ORIGIN)?.result).toBe('MISMATCH');

      // The opposite direction, where the file also sits in a directory it does not belong to.
      const otherWay = await attachTo(b, root, 'b', { slot: 'other-way', provenance_file: recordOf('a') });
      expect(otherWay.manifest.provenance).toBe('DECLARED');
      expect(otherWay.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.ORIGIN_NOT_CONFIRMED);

      // Both services the test started are still running and still answer identically.
      expect(processAlive(a.pid)).toBe(true);
      expect(processAlive(b.pid)).toBe(true);
      expect((await getHealth(a.origin)).digest).toBe(healthA.digest);
      expect((await getHealth(b.origin)).digest).toBe(healthB.digest);
    } finally {
      await stopInstance(a);
      await stopInstance(b);
    }
  });
});

it('issues no request at all when the target was never confirmed, and no command ever starts a service', async () => {
  await withTestDirectory(async root => {
    // A canary loopback listener counts sockets: if the adapter opens none, the count stays at zero.
    const sockets: string[] = [];
    const canary = net.createServer(socket => { sockets.push(socket.remoteAddress ?? ''); socket.destroy(); });
    await new Promise<void>((resolve, reject) => {
      canary.once('error', reject);
      canary.listen(0, '127.0.0.1', resolve);
    });
    const canaryAddress = canary.address();
    if (canaryAddress === null || typeof canaryAddress === 'string') throw new Error('canary listener did not report a port');
    const canaryOrigin = `http://127.0.0.1:${String(canaryAddress.port)}`;
    try {
      const a = await startInstance(root, 'a', INPUT_HASH);
      try {
        // The bound origin is not on the confirmed allowlist: refuse first, and never widen the list.
        const unauthorized = await attachTo(a, root, 'a', { slot: 'unauthorized', origins: [FRONTEND] });
        expect(unauthorized.manifest.provenance).toBe('DECLARED');
        expect(unauthorized.manifest.status).toBe('BLOCKED');
        expect(unauthorized.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.ORIGIN_NOT_AUTHORIZED);
        expect(unauthorized.adapter.probes_performed).toBe(0);
        expect(unauthorized.snapshots[0]!.document.health).toMatchObject({ requested: false });
        expect(unauthorized.snapshots[0]!.document.authorization).toMatchObject({ allowed: false, reason: 'ORIGIN_NOT_AUTHORIZED' });
        // The policy the caller handed over is not mutated into a wider one on the way through.
        expect(unauthorized.request.policy.allowed_origins).toEqual([FRONTEND]);

        // A live loopback service the run never confirmed: the socket count proves nothing reached it.
        const store = await createStoreRun(path.join(root, 'stores', 'canary'));
        const harness = makeHarness(store, []);
        const adapter = adapterFor({ data_revision: 'revision_of_the_attached_service' }, root);
        const request: EnvironmentRequest = {
          run_id: RUN, environment_id: ENVIRONMENT, input_hash: INPUT_HASH,
          configuration: { mode: 'attach', frontend_origin: FRONTEND, backend_origin: canaryOrigin, health_path: HEALTH_PATH, provenance_file: recordOf('canary') },
          policy: policy([], ['instances/**']),
        };
        const refused = await adapter.prepare(request, harness.context);
        expect(refused.provenance).toBe('DECLARED');
        expect(refused.reasons).toContain(ATTACH_REFUSAL_CODES.ORIGIN_NOT_AUTHORIZED);
        expect(adapter.probes_performed).toBe(0);
        expect(sockets, 'a refused authorisation must not open a socket').toEqual([]);

        // Same target, now confirmed: exactly one socket, so the gate above is what was holding it shut.
        const allowed = makeHarness(await createStoreRun(path.join(root, 'stores', 'canary-allowed')), [canaryOrigin]);
        const probing = adapterFor({ data_revision: 'revision_of_the_attached_service' }, root);
        const allowedManifest = await probing.prepare({
          ...request, policy: policy([canaryOrigin], ['instances/**']),
        }, allowed.context);
        expect(allowedManifest.status).toBe('BLOCKED');
        expect(probing.probes_performed).toBe(1);
        expect(sockets).toHaveLength(1);
        expect(allowedManifest.provenance).toBe('DECLARED');

        // A declared health operation is also required: without one, no request is authorised at all.
        const undeclared = await attachTo(a, root, 'a', { slot: 'undeclared', health_operation: null });
        expect(undeclared.manifest.provenance).toBe('DECLARED');
        expect(undeclared.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.REQUEST_NOT_AUTHORIZED);
        expect(undeclared.adapter.probes_performed).toBe(0);

        // And a path that is not an exact literal is refused before the socket, whatever the origin says.
        const queryPath = await attachTo(a, root, 'a', { slot: 'query-path', health_path: '/health?token=1' });
        expect(queryPath.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.REQUEST_NOT_AUTHORIZED);
        expect(queryPath.adapter.probes_performed).toBe(0);
        expect(queryPath.snapshots[0]!.document.authorization).toMatchObject({ allowed: false, reason: 'PATH_QUERY_FORBIDDEN' });

        // A provenance path the policy does not cover is never opened, so this is not an arbitrary file read.
        const outsidePath = await attachTo(a, root, 'a', { slot: 'outside-path', paths: ['elsewhere/**'] });
        expect(outsidePath.manifest.provenance).toBe('DECLARED');
        expect(outsidePath.manifest.reasons).toContain(ATTACH_REFUSAL_CODES.PROVENANCE_PATH_NOT_AUTHORIZED);
        expect(outsidePath.snapshots[0]!.document.provenance_file).toMatchObject({ readable: false, reason: 'PROVENANCE_PATH_NOT_AUTHORIZED_BY_POLICY' });

        expect(undeclared.harness.commandCalls).toEqual([]);
        expect(queryPath.harness.commandCalls).toEqual([]);
        expect(outsidePath.harness.commandCalls).toEqual([]);
        expect(processAlive(a.pid), 'every refusal above left the user service alone').toBe(true);
      } finally {
        await stopInstance(a);
      }
    } finally {
      await new Promise<void>(resolve => canary.close(() => resolve()));
    }
  });
});

it('cleanup preserves the service it attached to, keeps its own evidence, and the service still answers', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    try {
      const attached = await attachTo(a, root, 'a', { slot: 'cleanup' });
      expect(attached.manifest.provenance).toBe('OBSERVED');
      const prepareBefore = attached.harness.writes[0]!;
      const prepareDigest = createHash('sha256').update(prepareBefore.bytes).digest('hex');

      const result = await attached.adapter.cleanup({
        run_id: RUN, owner_token: OWNER, resources: attached.manifest.resources, signal: new AbortController().signal,
      });
      // Nothing is cleaned, nothing fails, and the ledger item comes back as preserved.
      expect(result.cleaned).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.diagnostics, JSON.stringify(result.diagnostics)).toEqual([]);
      expect(result.preserved).toHaveLength(1);
      expect(result.preserved[0]).toMatchObject({
        native_id: `pid-${String(a.pid)}`, created_by_stackgate: false, cleanup_status: 'PRESERVED', owner_token: OWNER,
      });

      // Proof of life, not a status field: a real request still succeeds with the very same bytes, and the
      // operating system still reports the same process behind the same port.
      const alive = await getHealth(a.origin);
      expect(alive.status).toBe(200);
      expect(alive.digest).toBe((attached.snapshots[0]!.document.health as Record<string, unknown>).body_digest);
      expect(processAlive(a.pid)).toBe(true);
      const identity = await observeLiveProcessIdentity(a.pid);
      expect(identity.status).toBe('OBSERVED');
      expect(identity.creation_identity).toBe(attached.manifest.resources[0]!.creation_identity);
      const listener = await observeListeningProcess(a.port);
      expect(listener.pid).toBe(a.pid);

      // The cleanup check is its own artifact; the prepare snapshot keeps the bytes it was first written with.
      const names = attached.harness.writes.map(write => write.name);
      expect(names).toEqual([`attach-prepare-${ENVIRONMENT}.json`, `attach-cleanup-${ENVIRONMENT}-0002.json`]);
      // Read it back from the run tree by the path the store indexed, not by a path this file guessed.
      const stored = await fs.readFile(path.join(root, 'stores', 'cleanup', 'runs', RUN, prepareBefore.artifact.relative_path));
      expect(createHash('sha256').update(stored).digest('hex')).toBe(prepareDigest);
      expect(JSON.parse(stored.toString('utf8'))).toMatchObject({ phase: 'prepare', provenance: 'OBSERVED' });
      const cleanupSnapshot = JSON.parse(attached.harness.writes[1]!.bytes.toString('utf8')) as Record<string, unknown>;
      expect(cleanupSnapshot.phase).toBe('cleanup');
      // And the prepare manifest itself was never rewritten with a cleanup state.
      expect(attached.manifest.status).toBe('READY');

      // A resource claimed as StackGate-created is refused rather than terminated: attach creates nothing.
      const forgedOwnership = await attached.adapter.cleanup({
        run_id: RUN, owner_token: OWNER,
        resources: [{ ...attached.manifest.resources[0]!, created_by_stackgate: true }], signal: new AbortController().signal,
      });
      expect(forgedOwnership.cleaned).toEqual([]);
      expect(forgedOwnership.preserved).toEqual([]);
      expect(forgedOwnership.failed).toHaveLength(1);
      expect(forgedOwnership.diagnostics.map(diagnostic => diagnostic.rule_id)).toContain(ATTACH_REFUSAL_CODES.OWNERSHIP_REFUSED);

      // Somebody else container is not ours to touch either, and a wrong owner token stops everything.
      const foreign = await attached.adapter.cleanup({
        run_id: RUN, owner_token: OWNER,
        resources: [{ ...attached.manifest.resources[0]!, resource_type: 'container', native_id: 'a-container-nobody-asked-about' }],
        signal: new AbortController().signal,
      });
      expect(foreign.failed).toHaveLength(1);
      expect(foreign.diagnostics.map(diagnostic => diagnostic.rule_id)).toContain(ATTACH_REFUSAL_CODES.FOREIGN_RESOURCE_UNSUPPORTED);
      const wrongOwner = await attached.adapter.cleanup({
        run_id: RUN, owner_token: 'owner_somebody_elses_run', resources: attached.manifest.resources, signal: new AbortController().signal,
      });
      expect(wrongOwner.preserved).toEqual([]);
      expect(wrongOwner.failed).toHaveLength(1);
      expect(wrongOwner.diagnostics.map(diagnostic => diagnostic.rule_id)).toContain(ATTACH_REFUSAL_CODES.OWNER_TOKEN_MISMATCH);

      // After every one of those cleanup calls the user service is still up and still the same process.
      expect((await getHealth(a.origin)).status).toBe(200);
      expect(processAlive(a.pid)).toBe(true);
      expect(attached.harness.commandCalls).toEqual([]);

      // The run can still be assessed from the retained evidence: cleanup left the prepare history intact.
      const { assessment } = await assessAttached(root, 'cleanup', attached.manifest);
      expect(assessment.satisfied, JSON.stringify(assessment.reasons)).toBe(true);
    } finally {
      await stopInstance(a);
    }
  });
});

it('observe keeps its own artifact, and reports a service that changed underneath the run', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    const b = await startInstance(root, 'b', INPUT_HASH);
    try {
      const attached = await attachTo(a, root, 'a', { slot: 'continuity' });
      expect(attached.manifest.provenance).toBe('OBSERVED');

      // A different candidate input than the one the run was created with is a refusal, not a re-binding.
      const drifted = await attached.adapter.observe({
        manifest: attached.manifest, expected_input_hash: OTHER_INPUT_HASH, signal: new AbortController().signal,
      });
      expect(drifted.provenance).toBe('OBSERVED');
      expect(drifted.reasons).toContain(ATTACH_REFUSAL_CODES.INPUT_HASH_MISMATCH);

      // The same service, observed again: still OBSERVED, with its own retained artifact.
      const second = await attached.adapter.observe({
        manifest: drifted, expected_input_hash: INPUT_HASH, signal: new AbortController().signal,
      });
      expect(second.provenance).toBe('OBSERVED');
      expect(second.instance_id).toBe(a.instanceId);
      // prepare + two observations, each a separate artifact the store accepted under its own name.
      expect(second.observations).toHaveLength(3);
      expect(new Set(second.observations).size).toBe(3);
      expect(attached.adapter.probes_performed).toBe(3);
      const names = attached.harness.writes.map(write => write.name);
      expect(names).toEqual([
        `attach-prepare-${ENVIRONMENT}.json`, `attach-observe-${ENVIRONMENT}-0002.json`, `attach-observe-${ENVIRONMENT}-0003.json`,
      ]);
      // Observations are append-only: the first snapshot still says it is the prepare evidence.
      expect(JSON.parse(attached.harness.writes[0]!.bytes.toString('utf8'))).toMatchObject({ phase: 'prepare', provenance: 'OBSERVED' });

      // Now the service underneath the attach is replaced: B's record is what the declared path holds.
      await fs.writeFile(a.recordPath, b.recordBytes);
      const swapped = await attached.adapter.observe({
        manifest: second, expected_input_hash: INPUT_HASH, signal: new AbortController().signal,
      });
      expect(swapped.provenance).toBe('DECLARED');
      expect(swapped.instance_id).toBeNull();
      expect(swapped.reasons).toContain(ATTACH_REFUSAL_CODES.INSTANCE_CHANGED);
      expect(swapped.reasons).toContain(ATTACH_REFUSAL_CODES.ORIGIN_NOT_CONFIRMED);
      const swappedChecks = attached.harness.writes[3]!.bytes.toString('utf8');
      expect(swappedChecks).toContain(PROVENANCE_CHECKS.RECORD_DIRECTORY_CONSISTENCY);

      // Neither service was restarted or stopped by any of this: both pids are still the originals.
      expect(processAlive(a.pid)).toBe(true);
      expect(processAlive(b.pid)).toBe(true);
      expect((await observeLiveProcessIdentity(a.pid)).creation_identity).toBe(creationOf(a.record));
      expect((await observeLiveProcessIdentity(b.pid)).creation_identity).toBe(creationOf(b.record));
      expect(attached.harness.commandCalls).toEqual([]);
    } finally {
      await stopInstance(a);
      await stopInstance(b);
    }
  });
});

it('stays DECLARED when the platform cannot supply a live process identity, and never guesses one', async () => {
  await withTestDirectory(async root => {
    const a = await startInstance(root, 'a', INPUT_HASH);
    try {
      const evidence = await collectAttachRecordEvidence({
        repo_root: root, provenance_relative_path: recordOf('a'), health_path: HEALTH_PATH,
        candidate_source_roots: [apiRoot, path.resolve('.')], authorized_patterns: ['instances/**'],
      });
      expect(evidence.record).not.toBeNull();
      const probe = await getHealth(a.origin);
      const expectations = {
        run_id: RUN, environment_id: ENVIRONMENT, expected_input_hash: INPUT_HASH, expected_origin: a.origin,
        health_path: HEALTH_PATH, expected_data_revision: a.dataRevision, expected_instance_id: null,
      };
      const health = {
        requested: true, refusal: null, status_code: probe.status, media_type: probe.mediaType,
        response_bytes: probe.bytes.length, body_digest: probe.digest, observed_at: new Date().toISOString(),
      };

      // What another platform would hand back: no creation identity, no socket owner.
      const blind = verifyAttachProvenance({
        evidence, expectations,
        identity: { status: 'UNSUPPORTED', pid: null, creation_identity: null, created_at: null, mechanism: 'none', detail: 'no implemented observation on this platform' },
        listener: { status: 'UNSUPPORTED', pid: null, addresses: [], mechanism: 'none', detail: 'no implemented observation on this platform' },
        health,
      });
      expect(blind.level).toBe('DECLARED');
      expect(blind.instance_id).toBeNull();
      expect(blind.diagnostics.map(diagnostic => diagnostic.rule_id)).toContain(ATTACH_REFUSAL_CODES.PROCESS_IDENTITY_UNSUPPORTED);
      expect(blind.diagnostics.map(diagnostic => diagnostic.rule_id)).toContain(ATTACH_REFUSAL_CODES.LISTENER_UNSUPPORTED);
      expect(blind.diagnostics.every(diagnostic => diagnostic.code !== 'ENV_PROVENANCE_INSUFFICIENT'
        || diagnostic.rule_id !== ATTACH_REFUSAL_CODES.CREATION_IDENTITY_MISMATCH)).toBe(true);

      // The identical record and health answer, with this host's live facts, is what becomes OBSERVED.
      const identity = await observeLiveProcessIdentity(a.pid);
      const listener = await observeListeningProcess(a.port);
      expect(identity.status).toBe('OBSERVED');
      expect(listener.status).toBe('OBSERVED');
      const sighted = verifyAttachProvenance({ evidence, expectations, identity, listener, health });
      expect(sighted.level).toBe('OBSERVED');
      expect(sighted.checks.filter(check => check.result !== 'MATCH')).toEqual([]);
    } finally {
      await stopInstance(a);
    }
  });
});
