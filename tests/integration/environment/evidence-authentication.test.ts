import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  Artifact, BackendObservation, Diagnostic, EnvironmentAssessment, EnvironmentCleanup, EnvironmentFinalization,
  EnvironmentManifest, RunManifest,
} from '../../../packages/contracts/src/index.js';
import { validateSchema } from '../../../packages/contracts/src/index.js';
import type { EvidenceReader } from '../../../packages/core/src/ports/evidence.js';
import { FileEvidenceStore } from '../../../packages/core/src/storage/file-evidence-store.js';
import { hashBytes } from '../../../packages/core/src/storage/hash.js';
import {
  assessEnvironment, assessmentReferencesAuthentic,
  type ConfirmedEnvironmentRequirements, type EnvironmentAssessmentInput,
} from '../../../packages/core/src/services/environment-assessment.js';
import {
  authenticateEnvironmentEvidence,
  type AuthenticateEnvironmentEvidenceInput, type AuthenticateEnvironmentEvidenceResult,
  type AuthenticatedEnvironmentFacts,
  type EvidenceDocumentRef, type ExpectedRequest,
} from '../../../packages/core/src/services/authenticate-environment-evidence.js';
import { withTestDirectory } from '../../support/test-paths.js';

/**
 * V2-R06 integration suite. Every artifact below is written by a real `FileEvidenceStore` into a run directory
 * under the OS temp root, and every reference the factory accepts has to be re-fetched from that run's own
 * `artifact-index.json` (read back from disk). No test here opens a socket, starts a process, or feeds the
 * factory a path the index does not already hold.
 */
const RUN = 'run_v2_evidence';
const OTHER_RUN = 'run_v2_evidence_other';
const CHECK = 'runtime_probe';
const ATTEMPT = 'attempt_v2_evidence_1';
const OTHER_ATTEMPT = 'attempt_v2_evidence_2';
const INPUT_HASH = createHash('sha256').update('stackgate-v2-r06-candidate-input').digest('hex');
const REVISION = 'seed-v2-r06-1';
const FRONTEND = 'http://127.0.0.1:5173';
const BACKEND = 'http://127.0.0.1:8000';
const INSTANCE = 'instance_v2_r06';
const OPERATION = 'api:GET /api/performance';
const WINDOW = { started_at: '2026-09-28T09:00:00.000Z', finished_at: '2026-09-28T10:00:00.000Z' };
const CREATION_IDENTITY = 'stackgate-v2-r06-worker';

/** The raw, uncompressed UTF-8 response body the observation claims to have seen. */
const RESPONSE_BODY = Buffer.from(JSON.stringify({
  service: 'fastapi-demo', data_revision: REVISION, items: [{ id: 1, name: 'performance' }, { id: 2, name: 'latency' }],
}), 'utf8');
/** Digested with Node's own hash, independently of the product helper, so the factory's comparison is a fact. */
const RESPONSE_DIGEST = createHash('sha256').update(RESPONSE_BODY).digest('hex');

interface Resource {
  resource_type: EnvironmentManifest['resources'][number]['resource_type'];
  native_id: string;
  owner_token: string;
  created_at: string;
  creation_identity: string;
  created_by_stackgate: boolean;
  cleanup_status: EnvironmentCleanup['resources'][number]['cleanup_status'];
  ownership_basis: string;
}

/** The container this run created and the process it merely attached to. */
const RESOURCES: Resource[] = [
  {
    resource_type: 'container', native_id: 'v2r06container01', owner_token: 'owner_v2_r06',
    created_at: '2026-09-28T09:01:00.000Z', creation_identity: CREATION_IDENTITY,
    created_by_stackgate: true, cleanup_status: 'CLEANED',
    ownership_basis: 'label stackgate.run_id plus owner token',
  },
  {
    resource_type: 'process', native_id: 'pid-9911', owner_token: 'owner_user_service',
    created_at: '2026-09-28T09:00:30.000Z', creation_identity: 'user-attached-service',
    created_by_stackgate: false, cleanup_status: 'PRESERVED',
    ownership_basis: 'attach ledger entry created_by_stackgate false',
  },
];

const ledgerEntry = (run_id: string, resource: Resource): EnvironmentManifest['resources'][number] => ({
  run_id, owner_token: resource.owner_token, resource_type: resource.resource_type, native_id: resource.native_id,
  created_at: resource.created_at, creation_identity: resource.creation_identity,
  created_by_stackgate: resource.created_by_stackgate, cleanup_status: resource.cleanup_status,
});

const cleanupEntry = (run_id: string, resource: Resource): EnvironmentCleanup['resources'][number] => ({
  resource_type: resource.resource_type, native_id: resource.native_id, owner_token: resource.owner_token, run_id,
  created_by_stackgate: resource.created_by_stackgate, cleanup_status: resource.cleanup_status,
  creation_identity: resource.creation_identity, created_at: resource.created_at, ownership_basis: resource.ownership_basis,
});

function prepareDocument(run_id: string, patch: Partial<EnvironmentManifest> = {}): EnvironmentManifest {
  return {
    schema_version: '0.1', run_id, mode: 'compose', status: 'READY',
    frontend_origin: FRONTEND, backend_origin: BACKEND, instance_id: INSTANCE, provenance: 'OBSERVED',
    input_hash: INPUT_HASH, image_ids: ['sha256:eeee0001'], data_revision: REVISION,
    resources: RESOURCES.map(resource => ledgerEntry(run_id, resource)), observations: ['ev_startup'], reasons: [], ...patch,
  };
}

function finalizationDocument(run_id: string, patch: Partial<EnvironmentFinalization> = {}): EnvironmentFinalization {
  return {
    schema_version: '0.1', run_id, phase: 'finalize', observed_at: '2026-09-28T09:50:00.000Z', provenance: 'OBSERVED',
    instance_id: INSTANCE, input_hash: INPUT_HASH, data_revision: REVISION, frontend_origin: FRONTEND, backend_origin: BACKEND,
    requests_observed: 1, instance_changed: false, evidence_refs: ['ev_finalize_source_snapshot'], reasons: [], ...patch,
  };
}

function cleanupDocument(run_id: string, patch: Partial<EnvironmentCleanup> = {}): EnvironmentCleanup {
  return {
    schema_version: '0.1', run_id, cleaned_at: '2026-09-28T09:55:00.000Z', status: 'CLEANED', trigger: 'COMPLETED',
    resources: RESOURCES.map(resource => cleanupEntry(run_id, resource)),
    evidence_refs: ['ev_cleanup_resource_check'], reasons: [], ...patch,
  };
}

const observationPath = (check_id: string, attempt_id: string): string =>
  `documents/checks/${check_id}/${attempt_id}/backend-observation.json`;

function observationDocument(fields: {
  run_id: string; check_id: string; attempt_id: string; request_id: string; observation_path: string;
  response_digest?: string; response_bytes?: number; instance_id?: string; operation_key?: string;
  status_code?: number; media_type?: string;
}, patch: Partial<BackendObservation> = {}): BackendObservation {
  return {
    schema_version: '0.1', run_id: fields.run_id, check_id: fields.check_id, attempt_id: fields.attempt_id,
    request_id: fields.request_id, instance_id: fields.instance_id ?? INSTANCE,
    operation_key: fields.operation_key ?? OPERATION, status_code: fields.status_code ?? 200,
    media_type: fields.media_type ?? 'application/json',
    started_at: '2026-09-28T09:40:00.000Z', finished_at: '2026-09-28T09:40:00.250Z',
    response_bytes: fields.response_bytes ?? RESPONSE_BODY.length,
    response_digest: fields.response_digest ?? RESPONSE_DIGEST,
    digest_input_form: 'UNCOMPRESSED_UTF8_BODY_BYTES', observation_path: fields.observation_path,
    excluded_fields: ['Authorization', 'Cookie', 'Set-Cookie'], ...patch,
  };
}

function requirements(patch: Partial<ConfirmedEnvironmentRequirements> = {}): ConfirmedEnvironmentRequirements {
  return {
    required_by_profile: true, required_by_task: true, requires_backend_observation: true,
    minimum_provenance: 'OBSERVED', expected_data_revision: REVISION,
    expected_origins: { frontend: FRONTEND, backend: BACKEND }, required_operations: [OPERATION], ...patch,
  };
}

/** The manifest the store accepts; every document and artifact below is written into this run. */
async function createRun(store: FileEvidenceStore, run_id: string): Promise<RunManifest> {
  const fixture = JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json', 'utf8')) as RunManifest;
  const manifest: RunManifest = {
    ...structuredClone(fixture), run_id, input_hash: INPUT_HASH, plan_hash: INPUT_HASH, policy_hash: INPUT_HASH,
    phase: 'CREATED', verdict: 'INCOMPLETE', started_at: null, finished_at: null,
    checks: [], artifact_refs: [], environment_ref: null, data_revision: REVISION,
  };
  await store.createRun(manifest);
  return manifest;
}

interface Stored {
  store: FileEvidenceStore;
  root: string;
  run_id: string;
  index: Artifact[];
  artifacts: Record<'prepare' | 'finalization' | 'cleanup' | 'observation' | 'response', Artifact>;
  documents: {
    prepare: EnvironmentManifest; finalization: EnvironmentFinalization;
    cleanup: EnvironmentCleanup; observation: BackendObservation;
  };
  request_id: string;
  /** Every read the factory actually asked for, recorded by the wrapper around the real store. */
  calls: { run_id: string; relative_path: string; expected_digest: string; max_bytes: number }[];
  reader: EvidenceReader;
}

/** Writes one authentic run: three lifecycle documents, one observation document, one raw response body. */
async function buildRun(root: string, options: {
  run_id?: string; attempt_id?: string; provenance?: EnvironmentManifest['provenance']; body?: Uint8Array;
} = {}): Promise<Stored> {
  const run_id = options.run_id ?? RUN;
  const attempt_id = options.attempt_id ?? ATTEMPT;
  const body = options.body ?? RESPONSE_BODY;
  const store = new FileEvidenceStore({ stateRoot: root, owner: { repo_id: 'repo_fixture', worktree_id: 'worktree_fixture' } });
  await createRun(store, run_id);
  const scope = { run_id, check_id: null, attempt_id: null };
  const request_scope = { run_id, check_id: CHECK, attempt_id };
  const provenance = options.provenance ?? 'OBSERVED';
  const prepare = prepareDocument(run_id, { provenance });
  const finalization = finalizationDocument(run_id, { provenance });
  const cleanup = cleanupDocument(run_id);
  const artifacts = {
    prepare: await store.store(scope, { kind: 'document', value: { kind: 'environment', value: prepare } }),
    finalization: await store.store(scope, { kind: 'document', value: { kind: 'environment-finalization', value: finalization } }),
    cleanup: await store.store(scope, { kind: 'document', value: { kind: 'environment-cleanup', value: cleanup } }),
    response: await store.store(request_scope, {
      kind: 'artifact', value: {
        name: 'response-body.json', bytes: body, media_type: 'application/json',
        artifact_kind: 'observation', sensitivity: 'regular', redaction_state: 'NOT_REQUIRED',
      },
    }),
  };
  // The observation cites the paths and digests the store actually handed out for those two artifacts.
  const request_id = `request_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const observation = observationDocument({
    run_id, check_id: CHECK, attempt_id, request_id, observation_path: observationPath(CHECK, attempt_id),
    response_digest: artifacts.response.digest, response_bytes: artifacts.response.size,
  });
  const observation_artifact = await store.store(request_scope, { kind: 'document', value: { kind: 'backend-observation', value: observation } });
  const index = JSON.parse(await fs.readFile(path.join(root, 'runs', run_id, 'artifact-index.json'), 'utf8')) as Artifact[];
  const calls: Stored['calls'] = [];
  const reader: EvidenceReader = {
    read: async request => {
      calls.push({ ...request });
      return store.read(request);
    },
  };
  return {
    store, root, run_id, index,
    artifacts: { ...artifacts, observation: observation_artifact },
    documents: { prepare, finalization, cleanup, observation }, request_id, calls, reader,
  };
}

const refOf = (artifact: Artifact): EvidenceDocumentRef => ({
  artifact_id: artifact.artifact_id, relative_path: artifact.relative_path, digest: artifact.digest,
});

function expectedRequest(run: Stored, patch: Partial<ExpectedRequest> = {}): ExpectedRequest {
  return {
    run_id: run.run_id, check_id: CHECK, attempt_id: ATTEMPT, request_id: run.request_id,
    operation_key: OPERATION, instance_id: INSTANCE, status_code: 200, media_type: 'application/json',
    response_ref: refOf(run.artifacts.response), observation_ref: refOf(run.artifacts.observation), ...patch,
  };
}

function authInput(run: Stored, patch: Partial<AuthenticateEnvironmentEvidenceInput> = {}): AuthenticateEnvironmentEvidenceInput {
  return {
    run_id: run.run_id, input_hash: INPUT_HASH, run_window: WINDOW, requirements: requirements(),
    prepare_ref: refOf(run.artifacts.prepare), finalization_ref: refOf(run.artifacts.finalization),
    cleanup_ref: refOf(run.artifacts.cleanup), requests: [expectedRequest(run)],
    reader: run.reader, artifact_index: run.index, ...patch,
  };
}

const reasonCodes = (diagnostics: Diagnostic[]): string[] => diagnostics.map(diagnostic => String(diagnostic.observed_facts.reason));

/** Asserts a refusal happened for the expected reason and that no facts were produced. */
async function expectRefusal(promise: Promise<AuthenticateEnvironmentEvidenceResult>, reasons: string[]): Promise<Diagnostic[]> {
  const result = await promise;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('authentication must not produce facts');
  expect(reasonCodes(result.diagnostics)).toEqual(expect.arrayContaining(reasons));
  expect(result.diagnostics.length).toBeGreaterThan(0);
  return result.diagnostics;
}

/**
 * A reader over bytes held in memory. The real store refuses to write the malformed or wrong-kind documents
 * used below, so this double exists only to prove the factory checks structure and kind on the bytes it reads
 * instead of trusting whatever a store accepted. Index entries are schema-checked here first.
 */
function memoryEvidence(entries: { relative_path: string; bytes: Uint8Array; check_id?: string | null; attempt_id?: string | null }[]): { reader: EvidenceReader; index: Artifact[] } {
  const index: Artifact[] = [];
  const held = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const artifact: Artifact = {
      schema_version: '0.1', artifact_id: `artifact_${hashBytes(Buffer.from(entry.relative_path)).slice(0, 32)}`,
      run_id: RUN, check_id: entry.check_id ?? null, attempt_id: entry.attempt_id ?? null,
      relative_path: entry.relative_path, media_type: 'application/json', size: entry.bytes.length,
      digest: hashBytes(entry.bytes), sensitivity: 'regular', redaction_state: 'NOT_REQUIRED',
      artifact_kind: entry.relative_path.startsWith('documents/') ? 'report' : 'observation',
    };
    expect(validateSchema('artifact', artifact).ok, entry.relative_path).toBe(true);
    index.push(artifact);
    held.set(entry.relative_path, entry.bytes);
  }
  const reader: EvidenceReader = {
    read: async request => {
      const artifact = index.find(item => item.relative_path === request.relative_path && item.run_id === request.run_id);
      const bytes = held.get(request.relative_path);
      if (!artifact || !bytes || bytes.length !== artifact.size || hashBytes(bytes) !== artifact.digest) {
        return { status: 'INVALID', diagnostics: [{ ...blank, message: 'memory evidence did not match its index entry' }] };
      }
      return { status: 'FOUND', artifact, bytes };
    },
  };
  return { reader, index };
}

const blank: Diagnostic = {
  code: 'REPORT_INVALID', message: 'unavailable', location: '', observed_facts: {},
  recommended_action: 'use the real store', source: 'memory-evidence',
};

it('authenticates a real run and cites stored artifact ids, not request ids', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  // Facts about the ids this file generated, not constants: the store derives artifact ids from scope+path.
  const observation = run.documents.observation;
  const observationArtifact = run.artifacts.observation;
  expect(observation.request_id).not.toBe(observationArtifact.artifact_id);
  expect(observationArtifact.artifact_id).toMatch(/^artifact_[a-f0-9]{32}$/);
  expect(observation.request_id).toMatch(/^request_[0-9a-f]{12}$/);
  expect(observationArtifact.relative_path).toBe(observation.observation_path);

  const authenticated = await authenticateEnvironmentEvidence(authInput(run));
  expect(authenticated.ok).toBe(true);
  if (!authenticated.ok) throw new Error('fixture authentication failed');
  const assessment = assessEnvironment(authenticated.facts);

  expect(assessment.satisfied).toBe(true);
  expect(assessment.reasons).toEqual([]);
  expect(assessment.observation_refs).toContain(observationArtifact.artifact_id);
  expect(assessment.observation_refs).toContain(run.artifacts.response.artifact_id);
  expect(assessment.observation_refs).not.toContain(observation.request_id);
  const indexed = new Set(run.index.map(artifact => artifact.artifact_id));
  for (const cited of assessment.observation_refs) expect(indexed.has(cited), `cited ${cited} is a stored artifact`).toBe(true);
  expect(assessmentReferencesAuthentic(assessment, authenticated.facts.authenticated_refs)).toBe(true);
  expect(validateSchema('environment-assessment', assessment).ok).toBe(true);
  // The raw bytes are handed over as they were stored, and digested independently by this file.
  expect(Buffer.from(authenticated.facts.responses[0]!.bytes).equals(RESPONSE_BODY)).toBe(true);
  expect(authenticated.facts.responses[0]!.digest).toBe(RESPONSE_DIGEST);
  expect(authenticated.facts.authenticated_digests[run.request_id]).toBe(RESPONSE_DIGEST);
  // Every read stayed inside this run's own indexed tree.
  expect(run.calls.length).toBe(5);
  for (const call of run.calls) {
    expect(call.run_id).toBe(RUN);
    expect(run.index.some(entry => entry.relative_path === call.relative_path)).toBe(true);
    expect(/^(documents|artifacts)\//.test(call.relative_path)).toBe(true);
  }
}));

it('accepts the probe layer\'s sha256-prefixed digest only at the boundary', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  const prefixed = authInput(run, {
    requests: [expectedRequest(run, { response_ref: { ...refOf(run.artifacts.response), digest: `sha256:${run.artifacts.response.digest}` } })],
    cleanup_ref: { ...refOf(run.artifacts.cleanup), digest: `sha256:${run.artifacts.cleanup.digest}` },
  });
  const authenticated = await authenticateEnvironmentEvidence(prefixed);
  expect(authenticated.ok).toBe(true);

  // A prefixed digest inside the stored index is not a storage-side digest at all.
  const drifted = run.index.map(entry => ({ ...entry }));
  const target = drifted.find(entry => entry.relative_path === run.artifacts.prepare.relative_path)!;
  target.digest = `sha256:${target.digest}`;
  expect(validateSchema('artifact', target).ok).toBe(false);
  const diagnostics = await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    artifact_index: drifted,
    prepare_ref: { ...refOf(run.artifacts.prepare), digest: `sha256:${run.artifacts.prepare.digest}` },
  })), ['EVIDENCE_INDEX_ENTRY_INVALID']);
  expect(diagnostics[0]!.code).toBe('REPORT_INVALID');

  // Anything else in that position is neither form and is refused rather than guessed at.
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    cleanup_ref: { ...refOf(run.artifacts.cleanup), digest: `SHA256:${run.artifacts.cleanup.digest.toUpperCase()}` },
  })), ['EVIDENCE_DIGEST_FORM_INVALID']);
}));

it('refuses a request id cited where a stored artifact id belongs', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  // The V2-F03 shape: the HTTP request id, presented as if it were the observation's artifact id.
  const diagnostics = await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    requests: [expectedRequest(run, { observation_ref: { ...refOf(run.artifacts.observation), artifact_id: run.documents.observation.request_id } })],
  })), ['EVIDENCE_INDEX_IDENTITY_MISMATCH']);
  expect(diagnostics.length).toBeGreaterThan(0);
  // Refusing means not reading: the observation path never reached the reader at all.
  expect(run.calls.map(call => call.relative_path)).not.toContain(run.artifacts.observation.relative_path);
}));

it('reads nothing for a path this run\'s index does not hold', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  const unindexed = run.index.filter(entry => entry.relative_path !== run.artifacts.prepare.relative_path);
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, { artifact_index: unindexed })),
    ['EVIDENCE_PATH_UNINDEXED', 'EVIDENCE_LIFECYCLE_DOCUMENT_INCOMPLETE']);
  expect(run.calls.map(call => call.relative_path)).not.toContain('documents/environment.json');
}));

it('refuses paths outside the run\'s own evidence tree instead of reading them', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  const escapes = [
    '../../secrets/environment.json', 'documents/../../outside/environment.json', 'manifest.json',
    'restricted/checks/runtime_probe/attempt_v2_evidence_1/body.json', '/etc/passwd', 'g:\\windows\\win.ini',
    'events.jsonl', 'seal.json', 'documents//environment.json', 'documents/./environment.json',
    'artifact-index.json', 'documents/environment.json/', 'documents/../documents/environment.json',
  ];
  for (const escape of escapes) {
    const diagnostics = await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
      prepare_ref: { artifact_id: run.artifacts.prepare.artifact_id, relative_path: escape, digest: run.artifacts.prepare.digest },
    })), ['EVIDENCE_PATH_UNOWNED']);
    expect(diagnostics.length, escape).toBeGreaterThan(0);
  }
  // Not one escape reached the reader: the only paths asked for are the run's own indexed evidence.
  const attempted = run.calls.map(call => call.relative_path);
  for (const escape of escapes) expect(attempted, escape).not.toContain(escape);
  expect(new Set(attempted)).toEqual(new Set([
    run.artifacts.finalization.relative_path, run.artifacts.cleanup.relative_path,
    run.artifacts.observation.relative_path, run.artifacts.response.relative_path,
  ]));
  for (const call of run.calls) expect(run.index.some(entry => entry.relative_path === call.relative_path)).toBe(true);
}));

it('refuses evidence that belongs to another run', () => withTestDirectory(async root => {
  const mine = await buildRun(root);
  const theirs = await buildRun(root, { run_id: OTHER_RUN });
  // Citing another run's index entries: not this run's evidence, so nothing of theirs is read from here.
  await expectRefusal(authenticateEnvironmentEvidence(authInput(mine, { artifact_index: theirs.index })),
    ['EVIDENCE_INDEX_FOREIGN_RUN', 'EVIDENCE_PATH_UNINDEXED']);
  expect(mine.calls).toEqual([]);
  // And the other run's artifact ids never authenticate this run's paths.
  await expectRefusal(authenticateEnvironmentEvidence(authInput(mine, {
    requests: [expectedRequest(mine, { run_id: OTHER_RUN, observation_ref: refOf(theirs.artifacts.observation), response_ref: refOf(theirs.artifacts.response) })],
  })), ['EVIDENCE_REQUEST_RUN_MISMATCH']);
}));

it('refuses evidence replayed from another attempt', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  const scope = { run_id: RUN, check_id: CHECK, attempt_id: OTHER_ATTEMPT };
  const request_id = `request_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const observation = observationDocument({
    run_id: RUN, check_id: CHECK, attempt_id: OTHER_ATTEMPT, request_id,
    observation_path: observationPath(CHECK, OTHER_ATTEMPT),
    response_digest: run.artifacts.response.digest, response_bytes: run.artifacts.response.size,
  });
  const other_observation = await run.store.store(scope, { kind: 'document', value: { kind: 'backend-observation', value: observation } });
  const other_body = await run.store.store(scope, {
    kind: 'artifact', value: {
      name: 'response-body.json', bytes: RESPONSE_BODY, media_type: 'application/json',
      artifact_kind: 'observation', sensitivity: 'regular', redaction_state: 'NOT_REQUIRED',
    },
  });
  const index = [...run.index, other_observation, other_body];
  // Identical bytes, honestly indexed — but stored under another attempt, which the expected request does not name.
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    artifact_index: index,
    requests: [expectedRequest(run, { observation_ref: refOf(other_observation), response_ref: refOf(other_body) })],
  })), ['EVIDENCE_PATH_MISMATCH', 'EVIDENCE_SCOPE_MISMATCH']);
  // One stored item cannot authenticate two expected requests either.
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    requests: [expectedRequest(run), expectedRequest(run, { request_id: `request_${randomUUID().replaceAll('-', '').slice(0, 12)}` })],
  })), ['EVIDENCE_REUSED_ACROSS_REQUESTS']);
  // And the same request id expected twice is a conflict, not a duplicate proof.
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    requests: [expectedRequest(run), expectedRequest(run)],
  })), ['EVIDENCE_REQUEST_IDENTITY_CONFLICT']);
}));

it('refuses tampered bytes whose index digest no longer matches the file', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  const flipped = Buffer.from(RESPONSE_BODY);
  flipped[0] = flipped[0]! ^ 1;
  expect(flipped.length).toBe(RESPONSE_BODY.length);
  // Same size, different bytes: the index entry still claims the original digest.
  await fs.writeFile(path.join(root, 'runs', RUN, run.artifacts.response.relative_path), flipped);
  const diagnostics = await expectRefusal(authenticateEnvironmentEvidence(authInput(run)), ['EVIDENCE_REREAD_FAILED']);
  expect(String(diagnostics[0]!.observed_facts.status)).toBe('INVALID');
}));

it('refuses a truncated response body and a truncated retention record', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  const short = RESPONSE_BODY.subarray(0, RESPONSE_BODY.length - 8);
  const scope = { run_id: RUN, check_id: CHECK, attempt_id: ATTEMPT };
  const body = await run.store.store(scope, {
    kind: 'artifact', value: {
      name: 'response-body-truncated.json', bytes: short, media_type: 'application/json',
      artifact_kind: 'observation', sensitivity: 'regular', redaction_state: 'NOT_REQUIRED',
    },
  });
  const diagnostics = await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    artifact_index: [...run.index, body],
    requests: [expectedRequest(run, { response_ref: refOf(body) })],
  })), ['EVIDENCE_REQUEST_NOT_CONNECTED']);
  const detail = JSON.stringify(diagnostics[0]!.observed_facts);
  expect(detail).toContain('response_digest');
  expect(detail).toContain('response_bytes');

  // A retention record that admits truncation cannot authenticate a request even when its bytes are honest.
  const marked = await run.store.store(scope, {
    kind: 'artifact', value: {
      name: 'response-body-budget.json', bytes: RESPONSE_BODY, media_type: 'application/json',
      artifact_kind: 'observation', sensitivity: 'regular', redaction_state: 'NOT_REQUIRED',
      retention: { original_bytes: RESPONSE_BODY.length + 8, retained_bytes: RESPONSE_BODY.length, truncated: true, reason: 'ARTIFACT_BUDGET_EXCEEDED', critical: false },
    },
  });
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    artifact_index: [...run.index, marked],
    requests: [expectedRequest(run, { response_ref: refOf(marked) })],
  })), ['EVIDENCE_RESPONSE_TRUNCATED']);

  // ADR-012 §6 caps a response body at 1 MiB: evidence above the cap is refused instead of being read in full.
  const oversized = await run.store.store(scope, {
    kind: 'artifact', value: {
      name: 'response-body-oversized.json', bytes: Buffer.alloc(1024 * 1024 + 8, 0x20), media_type: 'application/json',
      artifact_kind: 'observation', sensitivity: 'regular', redaction_state: 'NOT_REQUIRED',
    },
  });
  const before = run.calls.length;
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    artifact_index: [...run.index, oversized],
    requests: [expectedRequest(run, { response_ref: refOf(oversized) })],
  })), ['EVIDENCE_OVER_BUDGET']);
  expect(run.calls.slice(before).map(call => call.relative_path)).not.toContain(oversized.relative_path);
}));

it('refuses when any lifecycle document is missing', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    artifact_index: run.index.filter(entry => entry.relative_path !== run.artifacts.cleanup.relative_path),
  })), ['EVIDENCE_PATH_UNINDEXED', 'EVIDENCE_LIFECYCLE_DOCUMENT_INCOMPLETE']);

  const other = await buildRun(root, { run_id: OTHER_RUN });
  await fs.unlink(path.join(root, 'runs', OTHER_RUN, other.artifacts.finalization.relative_path));
  const diagnostics = await expectRefusal(authenticateEnvironmentEvidence(authInput(other)), ['EVIDENCE_REREAD_FAILED', 'EVIDENCE_LIFECYCLE_DOCUMENT_INCOMPLETE']);
  expect(String(diagnostics.find(diagnostic => String(diagnostic.observed_facts.status))?.observed_facts.status)).toBe('MISSING');
}));

it('checks the stored document kind and structure instead of trusting the writer', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  // The real store refuses these bytes at write time, so the memory double proves the factory's own checks.
  const wrongKind = Buffer.from(JSON.stringify(cleanupDocument(RUN)), 'utf8');
  const selfGranted = Buffer.from(JSON.stringify({ ...prepareDocument(RUN), satisfied: true }), 'utf8');
  for (const bytes of [wrongKind, selfGranted]) {
    const memory = memoryEvidence([{ relative_path: 'documents/environment.json', bytes }]);
    const claimed = memory.index.find(entry => entry.relative_path === 'documents/environment.json')!;
    const diagnostics = await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
      reader: memory.reader, artifact_index: memory.index, prepare_ref: refOf(claimed),
    })), ['EVIDENCE_DOCUMENT_KIND_INVALID']);
    expect(String(diagnostics[0]!.observed_facts.schema)).toBe('environment');
    expect(diagnostics[0]!.code).toBe('REPORT_INVALID');
  }
  // A document that names a different run is refused even when its bytes are perfectly formed.
  const foreign = memoryEvidence([{ relative_path: 'documents/environment.json', bytes: Buffer.from(JSON.stringify(prepareDocument(OTHER_RUN)), 'utf8') }]);
  const foreignClaim = foreign.index[0]!;
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    reader: foreign.reader, artifact_index: foreign.index, prepare_ref: refOf(foreignClaim),
  })), ['EVIDENCE_DOCUMENT_RUN_MISMATCH']);
}));

it('keeps expected operations in the requirements, never in what the observation reports', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  // A required operation nobody expected cannot be patched in from the observation, so the factory refuses.
  const missing = await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    requirements: requirements({ required_operations: [OPERATION, 'api:GET /api/never-expected'] }),
  })), ['EVIDENCE_REQUIRED_OPERATION_NOT_EXPECTED']);
  expect(String(missing[0]!.observed_facts.operation)).toBe('api:GET /api/never-expected');
  // An empty expectation set is refused too, instead of being filled from whatever evidence exists.
  await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    requirements: requirements({ required_operations: [] }), requests: [],
  })), ['EVIDENCE_REQUESTS_MISSING']);
  // Expecting a different operation than the stored observation describes is a mismatch, not a re-derivation.
  const drifted = await expectRefusal(authenticateEnvironmentEvidence(authInput(run, {
    requirements: requirements({ required_operations: ['api:GET /api/other'] }),
    requests: [expectedRequest(run, { operation_key: 'api:GET /api/other' })],
  })), ['EVIDENCE_REQUEST_NOT_CONNECTED']);
  expect(JSON.stringify(drifted[0]!.observed_facts)).toContain('operation_key');
}));

it('grants no success to self-reported CONTROLLED provenance or a satisfied flag', () => withTestDirectory(async root => {
  const run = await buildRun(root, { provenance: 'CONTROLLED' });
  const authenticated = await authenticateEnvironmentEvidence(authInput(run));
  // The stored bytes are authentic, so the factory returns facts; the verdict still cannot be CONTROLLED.
  expect(authenticated.ok).toBe(true);
  if (!authenticated.ok) throw new Error('stored evidence should authenticate');
  expect(authenticated.facts.prepare!.provenance).toBe('CONTROLLED');
  const strict = assessEnvironment({ ...authenticated.facts, requirements: requirements({ minimum_provenance: 'CONTROLLED' }) });
  expect(strict.satisfied).toBe(false);
  expect(strict.provenance).toBe('OBSERVED');
  expect(strict.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');
  expect(strict.reasons).toContain('ENV_PROVENANCE_NOT_CERTIFIED');
  // The supplementary reference check passes on this refused assessment, which is exactly why it is supplementary:
  // it can only confirm that citations resolve to stored artifacts, never grant success.
  expect(assessmentReferencesAuthentic(strict, authenticated.facts.authenticated_refs)).toBe(true);
  expect(strict.satisfied).toBe(false);
}));

it('keeps the pure core free of I/O and this path free of network and command execution', () => withTestDirectory(async root => {
  const assessment = readFileSync('packages/core/src/services/environment-assessment.ts', 'utf8');
  expect(assessment).not.toMatch(/from 'node:/);
  expect(assessment).not.toMatch(/\bfs\b|\breadFile|createReadStream|fetch\(|child_process|node:net|node:http/);
  expect(assessment).not.toMatch(/Date\.now|new Date\(\)|Math\.random/);

  const factory = readFileSync('packages/core/src/services/authenticate-environment-evidence.ts', 'utf8');
  for (const forbidden of ['node:fs', 'node:path', 'node:net', 'node:http', 'node:https', 'node:dns', 'node:dgram', 'node:child_process', 'node:worker_threads', 'node:process']) {
    expect(factory, forbidden).not.toContain(forbidden);
  }
  expect(factory).not.toMatch(/\bfetch\(|\bspawn\(|\bexecSync\(|\bexecFile\(|\bXMLHttpRequest|\bWebSocket|createConnection|net\.connect/);
  expect(factory).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random/);
  expect(factory).toMatch(/input\.reader\.read\(/);
  // The module's whole dependency list, so "no runner, adapter or execution capability reaches this path" is a
  // checked fact rather than a reading of the code.
  const specifiers = [...factory.matchAll(/from '([^']+)'/g)].map(match => match[1]!);
  expect(specifiers).toEqual([
    '../../../contracts/src/index.js', '../../../contracts/src/index.js', '../ports/evidence.js',
    '../storage/canonical-json.js', '../storage/hash.js', './environment-assessment.js', './strict-document.js',
  ]);
  expect(specifiers.some(specifier => /runner|run-service|adapter|execution|command|child|net|http/.test(specifier))).toBe(false);

  // The only capability the factory uses is the injected reader, and it never runs anything else.
  const run = await buildRun(root);
  const authenticated = await authenticateEnvironmentEvidence(authInput(run));
  expect(authenticated.ok).toBe(true);
  if (!authenticated.ok) throw new Error('fixture authentication failed');
  const verdict = assessEnvironment(authenticated.facts);
  expect(verdict.satisfied).toBe(true);
  // The verdict arrives synchronously: an awaitable result would mean I/O inside the pure core.
  expect('then' in verdict).toBe(false);
}));

it('refuses a legacy assessment whose placeholder references resolve to nothing', () => withTestDirectory(async root => {
  const legacy = JSON.parse(readFileSync('tests/fixtures/protocols/environment-assessment.json', 'utf8')) as EnvironmentAssessment;
  expect(validateSchema('environment-assessment', legacy).ok).toBe(true);
  // Old 0.1 evidence still reads, but placeholders are not this run's artifacts, so nothing is granted.
  expect(assessmentReferencesAuthentic(legacy, ['none', 'missing'])).toBe(false);
  expect(assessmentReferencesAuthentic(legacy, [])).toBe(false);
  const run = await buildRun(root);
  const authenticated = await authenticateEnvironmentEvidence(authInput(run));
  expect(authenticated.ok).toBe(true);
  if (!authenticated.ok) throw new Error('fixture authentication failed');
  expect(Object.values(authenticated.facts.authenticated_digests)).not.toContain('none');
  expect(assessmentReferencesAuthentic(assessEnvironment(authenticated.facts), authenticated.facts.authenticated_refs)).toBe(true);
}));

it('does not let a hand-made facts object reach the assessment', () => {
  // Compile-time evidence that the brand works: only the factory can produce facts. A developer-misuse guard,
  // not a security boundary — `@ts-expect-error` fails the suite if the refusal ever disappears.
  // @ts-expect-error a literal object cannot satisfy the factory brand
  const forged: AuthenticatedEnvironmentFacts = {
    run_id: RUN, expected_input_hash: INPUT_HASH, requirements: requirements(), run_window: WINDOW,
    prepare: prepareDocument(RUN), finalization: finalizationDocument(RUN), cleanup: cleanupDocument(RUN),
    observations: [], authenticated_refs: [], authenticated_digests: {},
    prepare_ref: null, finalization_ref: null, cleanup_ref: null, responses: [],
  };
  expect(forged.run_id).toBe(RUN);
});

/** The pre-fix loose-input shape, kept as a documented limit of the pure function, not a claim of success. */
it('documents that the pure function alone cannot tell a request id from an artifact id', () => withTestDirectory(async root => {
  const run = await buildRun(root);
  const loose: EnvironmentAssessmentInput = {
    run_id: run.run_id, expected_input_hash: INPUT_HASH, requirements: requirements(), run_window: WINDOW,
    prepare: run.documents.prepare, finalization: run.documents.finalization, cleanup: run.documents.cleanup,
    observations: [{ observation: run.documents.observation, artifact_ids: [run.documents.observation.request_id] }],
    authenticated_refs: [
      run.artifacts.prepare.artifact_id, run.artifacts.finalization.artifact_id, run.artifacts.cleanup.artifact_id,
      run.documents.observation.request_id,
    ],
    authenticated_digests: { [run.request_id]: RESPONSE_DIGEST },
    prepare_ref: run.artifacts.prepare.artifact_id, finalization_ref: run.artifacts.finalization.artifact_id,
    cleanup_ref: run.artifacts.cleanup.artifact_id,
  };
  const assessment = assessEnvironment(loose);
  // Nothing stored can be assumed: the id cited here is not in this run's index, so no production consumer
  // can treat this verdict as authenticated evidence. The factory path is the only one that resolves ids.
  expect(assessment.observation_refs).toContain(run.documents.observation.request_id);
  const indexed = new Set(run.index.map(artifact => artifact.artifact_id));
  expect([...assessment.observation_refs].some(cited => !indexed.has(cited))).toBe(true);
  expect(assessmentReferencesAuthentic(assessment, run.index.map(artifact => artifact.artifact_id))).toBe(false);
}));
