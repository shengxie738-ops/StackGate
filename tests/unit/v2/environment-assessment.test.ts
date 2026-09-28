import {expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import type {
  BackendObservation, EnvironmentAssessment, EnvironmentCleanup, EnvironmentFinalization, EnvironmentManifest,
} from '../../../packages/contracts/src/index.js';
import {validateSchema} from '../../../packages/contracts/src/index.js';
import {
  assessEnvironment, assessmentReferencesAuthentic,
  type ConfirmedEnvironmentRequirements, type EnvironmentAssessmentInput,
} from '../../../packages/core/src/services/environment-assessment.js';

/**
 * V2-R05 regressions for `assessEnvironment`. Every document here is built by this file: the fixtures below
 * are the same shape the environment adapters write, so a refusal always names a concrete field difference.
 */
const RUN = 'run_v2_environment_unit';
const INPUT_HASH = 'b'.repeat(64);
const RESPONSE_DIGEST = 'd'.repeat(64);
const FRONTEND = 'http://127.0.0.1:5173';
const BACKEND = 'http://127.0.0.1:8000';
const INSTANCE = 'instance_v2_unit';
const REVISION = 'seed-v2-unit-1';
const OPERATION = 'api:GET /api/performance';
const REQUEST_ID = 'request_v2_unit_1';
const PREPARE_REF = 'art_v2_prepare';
const FINALIZE_REF = 'art_v2_finalize';
const CLEANUP_REF = 'art_v2_cleanup';
const WINDOW = { started_at: '2026-09-22T09:00:00.000Z', finished_at: '2026-09-22T10:00:00.000Z' };

type ResourceType = EnvironmentManifest['resources'][number]['resource_type'];
type CleanupState = EnvironmentCleanup['resources'][number]['cleanup_status'];

interface ResourceFixture {
  resource_type: ResourceType;
  native_id: string;
  owner_token: string;
  created_at: string;
  creation_identity: string;
  created_by_stackgate: boolean;
  cleanup_status: CleanupState;
  ownership_basis: string;
}

/** The container this run created and the process it merely attached to. */
const RESOURCES: ResourceFixture[] = [
  {
    resource_type: 'container', native_id: 'ownedcafe01', owner_token: 'owner_v2_unit',
    created_at: '2026-09-22T09:01:00.000Z', creation_identity: 'stackgate-v2-unit-worker',
    created_by_stackgate: true, cleanup_status: 'CLEANED', ownership_basis: 'label stackgate.run_id plus owner token',
  },
  {
    resource_type: 'process', native_id: 'pid-9911', owner_token: 'owner_user_service',
    created_at: '2026-09-22T09:00:30.000Z', creation_identity: 'user-attached-service',
    created_by_stackgate: false, cleanup_status: 'PRESERVED', ownership_basis: 'attach ledger entry created_by_stackgate false',
  },
];

const ledgerEntry = (resource: ResourceFixture): EnvironmentManifest['resources'][number] => ({
  run_id: RUN, owner_token: resource.owner_token, resource_type: resource.resource_type, native_id: resource.native_id,
  created_at: resource.created_at, creation_identity: resource.creation_identity,
  created_by_stackgate: resource.created_by_stackgate, cleanup_status: resource.cleanup_status,
});

const cleanupEntry = (resource: ResourceFixture): EnvironmentCleanup['resources'][number] => ({
  resource_type: resource.resource_type, native_id: resource.native_id, owner_token: resource.owner_token, run_id: RUN,
  created_by_stackgate: resource.created_by_stackgate, cleanup_status: resource.cleanup_status,
  creation_identity: resource.creation_identity, created_at: resource.created_at, ownership_basis: resource.ownership_basis,
});

function prepareDoc(patch: Partial<EnvironmentManifest> = {}): EnvironmentManifest {
  return {
    schema_version: '0.1', run_id: RUN, mode: 'compose', status: 'READY',
    frontend_origin: FRONTEND, backend_origin: BACKEND, instance_id: INSTANCE, provenance: 'OBSERVED',
    input_hash: INPUT_HASH, image_ids: ['sha256:eeee0001'], data_revision: REVISION,
    resources: RESOURCES.map(ledgerEntry), observations: ['ev_startup'], reasons: [], ...patch,
  };
}

function finalizationDoc(patch: Partial<EnvironmentFinalization> = {}): EnvironmentFinalization {
  return {
    schema_version: '0.1', run_id: RUN, phase: 'finalize', observed_at: '2026-09-22T09:50:00.000Z', provenance: 'OBSERVED',
    instance_id: INSTANCE, input_hash: INPUT_HASH, data_revision: REVISION, frontend_origin: FRONTEND, backend_origin: BACKEND,
    requests_observed: 1, instance_changed: false, evidence_refs: [PREPARE_REF], reasons: [], ...patch,
  };
}

function cleanupDoc(patch: Partial<EnvironmentCleanup> = {}): EnvironmentCleanup {
  return {
    schema_version: '0.1', run_id: RUN, cleaned_at: '2026-09-22T09:55:00.000Z', status: 'CLEANED', trigger: 'COMPLETED',
    resources: RESOURCES.map(cleanupEntry), evidence_refs: [PREPARE_REF], reasons: [], ...patch,
  };
}

function observationDoc(patch: Partial<BackendObservation> = {}): BackendObservation {
  return {
    schema_version: '0.1', run_id: RUN, check_id: 'runtime_probe', attempt_id: 'attempt_v2_unit', request_id: REQUEST_ID,
    instance_id: INSTANCE, operation_key: OPERATION, status_code: 200, media_type: 'application/json',
    started_at: '2026-09-22T09:40:00.000Z', finished_at: '2026-09-22T09:40:00.250Z', response_bytes: 132,
    response_digest: RESPONSE_DIGEST, digest_input_form: 'UNCOMPRESSED_UTF8_BODY_BYTES',
    observation_path: `observations/backend/${REQUEST_ID}.json`, excluded_fields: ['Authorization', 'Cookie', 'Set-Cookie'], ...patch,
  };
}

function requirements(patch: Partial<ConfirmedEnvironmentRequirements> = {}): ConfirmedEnvironmentRequirements {
  return {
    required_by_profile: true, required_by_task: true, requires_backend_observation: true,
    minimum_provenance: 'OBSERVED', expected_data_revision: REVISION,
    expected_origins: { frontend: FRONTEND, backend: BACKEND }, required_operations: [OPERATION], ...patch,
  };
}

/** Requirements for a profile that genuinely needs no environment and asks for no backend observation. */
function noEnvironmentRequirements(): ConfirmedEnvironmentRequirements {
  return {
    required_by_profile: false, required_by_task: false, requires_backend_observation: false,
    minimum_provenance: 'DECLARED', expected_data_revision: null,
    expected_origins: { frontend: null, backend: null }, required_operations: [],
  };
}

function baseInput(overrides: Partial<EnvironmentAssessmentInput> = {}): EnvironmentAssessmentInput {
  return {
    run_id: RUN, expected_input_hash: INPUT_HASH, requirements: requirements(), run_window: WINDOW,
    prepare: prepareDoc(), finalization: finalizationDoc(), cleanup: cleanupDoc(), observations: [observationDoc()],
    authenticated_refs: [PREPARE_REF, FINALIZE_REF, CLEANUP_REF, REQUEST_ID],
    authenticated_digests: { [REQUEST_ID]: RESPONSE_DIGEST },
    prepare_ref: PREPARE_REF, finalization_ref: FINALIZE_REF, cleanup_ref: CLEANUP_REF, ...overrides,
  };
}

/** The card's snippet: each non-READY prepare status must refuse, with this file's own fixtures. */
function statusRefusals(): Record<string, EnvironmentAssessment> {
  const recorded: Record<string, EnvironmentAssessment> = {};
  for (const status of ['BLOCKED', 'ERROR', 'UNKNOWN', 'CLEANED'] as const) {
    const input = baseInput();
    input.prepare = { ...input.prepare!, status };
    recorded[status] = assessEnvironment(input);
  }
  return recorded;
}

/** Replaces the cleanup report's owned entry with one carrying a different state. */
function withOwnedCleanupState(state: CleanupState): Partial<EnvironmentAssessmentInput> {
  const input = baseInput();
  return {
    cleanup: {
      ...input.cleanup!,
      resources: input.cleanup!.resources.map(resource => resource.created_by_stackgate ? { ...resource, cleanup_status: state } : resource),
    },
  };
}

/** Captures the thrown value so a precondition error can be inspected without loosening the assertion. */
function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

it('accepts the happy path and writes schema-valid documents on both sides', () => {
  const input = baseInput();
  expect(validateSchema('environment', input.prepare!).ok).toBe(true);
  expect(validateSchema('environment-finalization', input.finalization!).ok).toBe(true);
  expect(validateSchema('environment-cleanup', input.cleanup!).ok).toBe(true);
  expect(validateSchema('backend-observation', input.observations[0]!).ok).toBe(true);
  const assessment = assessEnvironment(input);
  expect(assessment.satisfied).toBe(true);
  expect(assessment.reasons).toEqual([]);
  expect(assessment.provenance).toBe('OBSERVED');
  expect(assessment.environment_required).toBe(true);
  expect(assessment.observation_refs).toContain(PREPARE_REF);
  expect(validateSchema('environment-assessment', assessment).ok).toBe(true);
  expect(assessmentReferencesAuthentic(assessment, input.authenticated_refs)).toBe(true);
});

it('refuses every non-READY prepare status', () => {
  const refused = statusRefusals();
  expect(Object.keys(refused)).toEqual(['BLOCKED', 'ERROR', 'UNKNOWN', 'CLEANED']);
  for (const status of ['BLOCKED', 'ERROR', 'UNKNOWN'] as const) {
    expect(refused[status]!.satisfied, status).toBe(false);
    expect(refused[status]!.reasons, status).toContain('ENV_PREPARE_NOT_READY');
  }
  // A CLEANED prepare snapshot overwrote the historical READY fact instead of appending to it.
  expect(refused.CLEANED!.satisfied).toBe(false);
  expect(refused.CLEANED!.reasons).toContain('ENV_PREPARE_HISTORY_OVERWRITTEN');
});

it('keeps a CLEANED cleanup report from erasing the earlier READY observation', () => {
  const input = baseInput();
  expect(input.prepare!.status).toBe('READY');
  expect(input.cleanup!.status).toBe('CLEANED');
  expect(assessEnvironment(input).satisfied).toBe(true);
});

it('refuses unresolved reasons recorded on the prepare snapshot', () => {
  const assessment = assessEnvironment(baseInput({ prepare: prepareDoc({ reasons: ['READINESS_TIMEOUT'] }) }));
  expect(assessment.satisfied).toBe(false);
  expect(assessment.reasons).toContain('ENV_PREPARE_REASONS_UNRESOLVED');
});

it('takes the weakest provenance level before comparing with the confirmed minimum', () => {
  const mixed = baseInput({
    prepare: prepareDoc({ provenance: 'OBSERVED' }),
    finalization: finalizationDoc({ provenance: 'CONTROLLED' }),
  });
  const atObserved = assessEnvironment(mixed);
  expect(atObserved.provenance).toBe('OBSERVED');
  expect(atObserved.satisfied).toBe(true);
  const atControlled = assessEnvironment({ ...mixed, requirements: requirements({ minimum_provenance: 'CONTROLLED' }) });
  expect(atControlled.provenance).toBe('OBSERVED');
  expect(atControlled.satisfied).toBe(false);
  expect(atControlled.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');

  const declaredOnly = assessEnvironment(baseInput({
    prepare: prepareDoc({ provenance: 'DECLARED' }), finalization: finalizationDoc({ provenance: 'OBSERVED' }),
  }));
  expect(declaredOnly.provenance).toBe('DECLARED');
  expect(declaredOnly.satisfied).toBe(false);
  expect(declaredOnly.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');
});

it('never certifies CONTROLLED from documents that only self-report it', () => {
  const selfClaimed = baseInput({
    prepare: prepareDoc({ provenance: 'CONTROLLED' }), finalization: finalizationDoc({ provenance: 'CONTROLLED' }),
  });
  const assessment = assessEnvironment({ ...selfClaimed, requirements: requirements({ minimum_provenance: 'CONTROLLED' }) });
  expect(assessment.satisfied).toBe(false);
  expect(assessment.provenance).toBe('OBSERVED');
  expect(assessment.reasons).toContain('ENV_PROVENANCE_NOT_CERTIFIED');
  expect(assessment.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');
});

it('refuses a no-environment profile that still demands backend observation', () => {
  const contradictions: Record<string, ConfirmedEnvironmentRequirements> = {
    requires_backend_observation: { ...noEnvironmentRequirements(), requires_backend_observation: true },
    minimum_provenance: { ...noEnvironmentRequirements(), minimum_provenance: 'OBSERVED' },
    expected_data_revision: { ...noEnvironmentRequirements(), expected_data_revision: REVISION },
    expected_origins: { ...noEnvironmentRequirements(), expected_origins: { frontend: FRONTEND, backend: null } },
    required_operations: { ...noEnvironmentRequirements(), required_operations: [OPERATION] },
  };
  for (const [field, patched] of Object.entries(contradictions)) {
    const input = baseInput({
      requirements: patched, prepare: null, finalization: null, cleanup: null, observations: [],
      prepare_ref: null, finalization_ref: null, cleanup_ref: null, run_window: null, authenticated_refs: [], authenticated_digests: {},
    });
    const thrown = captureError(() => assessEnvironment(input)) as { message?: string; exit_code?: number } | undefined;
    expect(thrown, field).toBeDefined();
    expect(String(thrown?.message), field).toContain('contradictory');
    expect(thrown?.exit_code, field).toBe(64);
  }
});

it('reports a genuinely environment-free profile without fabricating refs', () => {
  const input = baseInput({
    requirements: noEnvironmentRequirements(), prepare: null, finalization: null, cleanup: null, observations: [],
    prepare_ref: null, finalization_ref: null, cleanup_ref: null, run_window: null, authenticated_refs: [], authenticated_digests: {},
  });
  const assessment = assessEnvironment(input);
  expect(assessment.satisfied).toBe(true);
  expect(assessment.reasons).toEqual(['NO_ENVIRONMENT_REQUIRED']);
  expect(assessment.environment_required).toBe(false);
  expect(assessment.prepare_ref).toBeNull();
  expect(assessment.finalization_ref).toBeNull();
  expect(assessment.cleanup_ref).toBeNull();
  expect(assessment.observation_refs).toEqual([]);
  expect(assessment.data_revision).toBe('NO_ENVIRONMENT');
  expect(validateSchema('environment-assessment', assessment).ok).toBe(true);
  expect(assessmentReferencesAuthentic(assessment, [])).toBe(true);
});

it('refuses an environment-free profile whose evidence is still in use', () => {
  // Requirements say nothing is confirmed, yet documents report origins: nothing is confirmed, so nothing passes.
  const assessment = assessEnvironment(baseInput({ requirements: noEnvironmentRequirements() }));
  expect(assessment.satisfied).toBe(false);
  expect(assessment.reasons).toContain('ENV_FRONTEND_ORIGIN_MISMATCH');
  expect(assessment.reasons).toContain('ENV_BACKEND_ORIGIN_MISMATCH');
  expect(assessment.reasons).toContain('ENV_DATA_REVISION_UNCONFIRMED');
});

it('refuses missing environment evidence instead of writing placeholder citations', () => {
  const assessment = assessEnvironment(baseInput({
    prepare: null, finalization: null, cleanup: null, observations: [],
    prepare_ref: null, finalization_ref: null, cleanup_ref: null, authenticated_refs: [],
  }));
  expect(assessment.satisfied).toBe(false);
  expect(assessment.reasons).toContain('ENV_PREPARE_OBSERVATION_MISSING');
  expect(assessment.reasons).toContain('ENV_FINALIZE_OBSERVATION_MISSING');
  expect(assessment.reasons).toContain('ENV_CLEANUP_OBSERVATION_MISSING');
  expect(assessment.reasons).toContain('ENV_BACKEND_OBSERVATION_MISSING');
  expect(assessment.prepare_ref).toBeNull();
  expect(assessment.observation_refs).toEqual([]);
  expect(JSON.stringify(assessment)).not.toContain('"missing"');
  expect(JSON.stringify(assessment)).not.toContain('"none"');
  expect(validateSchema('environment-assessment', assessment).ok).toBe(true);
  expect(assessmentReferencesAuthentic(assessment, [])).toBe(false);
});

it('checks the finalization phase, identities, origins and the run time range', () => {
  const refusal = (patch: Partial<EnvironmentAssessmentInput>, reason: string) => {
    const assessment = assessEnvironment(baseInput(patch));
    expect(assessment.satisfied, reason).toBe(false);
    expect(assessment.reasons, reason).toContain(reason);
  };
  refusal({ finalization: finalizationDoc({ phase: 'prepare' as unknown as 'finalize' }) }, 'ENV_FINALIZE_PHASE_INVALID');
  refusal({ finalization: finalizationDoc({ run_id: 'run_other_project' }) }, 'ENV_RUN_IDENTITY_MISMATCH');
  refusal({ finalization: finalizationDoc({ input_hash: 'f'.repeat(64) }) }, 'ENV_INPUT_MISMATCH');
  refusal({ finalization: finalizationDoc({ instance_id: 'instance_other_service' }) }, 'ENV_INSTANCE_MISMATCH');
  refusal({ finalization: finalizationDoc({ instance_changed: true }) }, 'ENV_INSTANCE_CHANGED_DURING_RUN');
  refusal({ finalization: finalizationDoc({ backend_origin: 'http://127.0.0.1:9999' }) }, 'ENV_BACKEND_ORIGIN_MISMATCH');
  refusal({ finalization: finalizationDoc({ frontend_origin: 'http://127.0.0.1:4000' }) }, 'ENV_FRONTEND_ORIGIN_MISMATCH');
  refusal({ finalization: finalizationDoc({ data_revision: 'seed-yesterday' }) }, 'ENV_DATA_REVISION_MISMATCH');
  refusal({ finalization: finalizationDoc({ observed_at: '2026-09-22T11:00:00.000Z' }) }, 'ENV_FINALIZE_OUT_OF_RUN_WINDOW');
  refusal({ finalization: finalizationDoc({ observed_at: '2026-09-22T08:00:00.000Z' }) }, 'ENV_FINALIZE_OUT_OF_RUN_WINDOW');
  refusal({ finalization: finalizationDoc({ observed_at: 'not-a-time' }) }, 'ENV_FINALIZE_TIMESTAMP_INVALID');
  refusal({ run_window: null }, 'ENV_RUN_WINDOW_UNAVAILABLE');
  refusal({ cleanup: cleanupDoc({ cleaned_at: '2026-09-22T11:00:00.000Z' }) }, 'ENV_CLEANUP_OUT_OF_RUN_WINDOW');
  refusal({ cleanup: cleanupDoc({ cleaned_at: '2026-09-22T09:40:00.000Z' }) }, 'ENV_CLEANUP_BEFORE_FINALIZE');
  refusal({ requirements: requirements({ expected_data_revision: null }) }, 'ENV_DATA_REVISION_UNCONFIRMED');
});

it('cross-checks the resource ledger against the cleanup report in both directions', () => {
  const refusal = (patch: Partial<EnvironmentAssessmentInput>, reason: string) => {
    const assessment = assessEnvironment(baseInput(patch));
    expect(assessment.satisfied, reason).toBe(false);
    expect(assessment.reasons, reason).toContain(reason);
  };
  const owned = RESOURCES.find(resource => resource.created_by_stackgate)!;
  const foreign = RESOURCES.find(resource => !resource.created_by_stackgate)!;
  const cleanup = (resources: EnvironmentCleanup['resources']): Partial<EnvironmentAssessmentInput> => ({ cleanup: { ...cleanupDoc(), resources } });

  // Direction 1: an owned resource the prepare ledger recorded but cleanup never mentions.
  refusal(cleanup([cleanupEntry(foreign)]), 'ENV_CLEANUP_RESOURCE_UNREPORTED');
  // Direction 2: a resource cleanup reports that the ledger never recorded.
  refusal({ prepare: prepareDoc({ resources: [] }) }, 'ENV_CLEANUP_RESOURCE_UNMATCHED');
  refusal(cleanup([...RESOURCES.map(cleanupEntry), { ...cleanupEntry(owned), native_id: 'hiddenextra01' }]), 'ENV_CLEANUP_RESOURCE_UNMATCHED');

  for (const state of ['PENDING', 'FAILED', 'UNKNOWN'] as const) {
    refusal(withOwnedCleanupState(state), state === 'PENDING' ? 'ENV_CLEANUP_INCOMPLETE' : state === 'FAILED' ? 'ENV_CLEANUP_FAILED' : 'ENV_CLEANUP_UNVERIFIED');
  }
  // An owned resource left PRESERVED is not proof of cleanup, whatever the aggregate label claims.
  refusal(withOwnedCleanupState('PRESERVED'), 'ENV_CLEANUP_INCOMPLETE');
  refusal({ cleanup: cleanupDoc({ status: 'PARTIAL' }) }, 'ENV_CLEANUP_INCOMPLETE');
  refusal({ cleanup: cleanupDoc({ status: 'UNKNOWN' }) }, 'ENV_CLEANUP_UNVERIFIED');
  refusal({ cleanup: cleanupDoc({ status: 'FAILED' }) }, 'ENV_CLEANUP_FAILED');
  // Deleting a resource this run never owned crosses the preservation boundary.
  refusal(cleanup(RESOURCES.map(resource => resource.created_by_stackgate ? cleanupEntry(resource) : ({ ...cleanupEntry(resource), cleanup_status: 'CLEANED' }))), 'ENV_CLEANUP_PRESERVED_BOUNDARY');

  // native id, owner token, creation identity and scope must all match item by item.
  refusal(cleanup([{ ...cleanupEntry(owned), owner_token: 'owner_somewhere_else' }, cleanupEntry(foreign)]), 'ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
  refusal(cleanup([{ ...cleanupEntry(owned), creation_identity: 'someone-else-created-it' }, cleanupEntry(foreign)]), 'ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
  refusal(cleanup([{ ...cleanupEntry(owned), created_by_stackgate: false }, cleanupEntry(foreign)]), 'ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
  refusal(cleanup([{ ...cleanupEntry(owned), resource_type: 'volume' }, cleanupEntry(foreign)]), 'ENV_CLEANUP_RESOURCE_UNMATCHED');
  refusal({ cleanup: cleanupDoc({ resources: RESOURCES.map(resource => ({ ...cleanupEntry(resource), run_id: 'run_other_project' })) }) }, 'ENV_CLEANUP_RESOURCE_SCOPE');
  refusal({ prepare: prepareDoc({ resources: RESOURCES.map(resource => ({ ...ledgerEntry(resource), run_id: 'run_other_project' })) }) }, 'ENV_RESOURCE_SCOPE_MISMATCH');

  // Without the creation identity on the report the core cannot match the item at all.
  const { creation_identity: _omitted, ...ownedWithoutIdentity } = cleanupEntry(owned);
  void _omitted;
  refusal(cleanup([ownedWithoutIdentity, cleanupEntry(foreign)]), 'ENV_CLEANUP_IDENTITY_UNREPORTED');

  // A report that cleans a resource before that resource was created contradicts its own ledger.
  const lateCreated = RESOURCES.map(resource => ({ ...resource, created_at: '2026-09-22T09:59:00.000Z' }));
  refusal({ prepare: prepareDoc({ resources: lateCreated.map(ledgerEntry) }), cleanup: { ...cleanupDoc(), resources: lateCreated.map(cleanupEntry) } }, 'ENV_CLEANUP_BEFORE_CREATION');
});

it('keeps backend observation demands, digests and operation coverage decisive', () => {
  const refusal = (patch: Partial<EnvironmentAssessmentInput>, reason: string) => {
    const assessment = assessEnvironment(baseInput(patch));
    expect(assessment.satisfied, reason).toBe(false);
    expect(assessment.reasons, reason).toContain(reason);
  };
  refusal({ observations: [] }, 'ENV_BACKEND_OBSERVATION_MISSING');
  refusal({ observations: [observationDoc({ run_id: 'run_other_project' })] }, 'ENV_BACKEND_OBSERVATION_SCOPE');
  refusal({ observations: [observationDoc({ instance_id: 'instance_other_service' })] }, 'ENV_INSTANCE_MISMATCH');
  refusal({ authenticated_digests: {} }, 'ENV_BACKEND_OBSERVATION_BYTES_MISSING');
  refusal({ authenticated_digests: { [REQUEST_ID]: '3'.repeat(64) } }, 'ENV_BACKEND_OBSERVATION_DIGEST');
  refusal({ requirements: requirements({ required_operations: [OPERATION, 'api:GET /api/never-called'] }) }, 'ENV_REQUIRED_OPERATION_UNOBSERVED');
  const unauthenticated = assessEnvironment(baseInput({ authenticated_refs: [PREPARE_REF] }));
  expect(unauthenticated.satisfied).toBe(false);
  expect(unauthenticated.reasons).toContain('ENV_REFERENCE_UNAUTHENTICATED');
});

it('is deterministic and never mutates the input it was given', () => {
  const input = baseInput();
  const before = structuredClone(input);
  const first = assessEnvironment(input);
  const second = assessEnvironment(input);
  expect(first).toEqual(second);
  expect(first.reasons).toEqual([...first.reasons].sort());
  expect(first.observation_refs).toEqual([...first.observation_refs].sort());
  expect(input).toEqual(before);
});

it('grants no new trust to 0.1 assessments that carried placeholder refs', () => {
  const legacy = JSON.parse(readFileSync('tests/fixtures/protocols/environment-assessment.json', 'utf8')) as EnvironmentAssessment;
  expect(validateSchema('environment-assessment', legacy).ok).toBe(true);
  expect(legacy.environment_required).toBeUndefined();
  expect(assessmentReferencesAuthentic(legacy, [legacy.prepare_ref!, legacy.finalization_ref!, legacy.cleanup_ref!, ...legacy.observation_refs])).toBe(true);
  const placeholders: EnvironmentAssessment = { ...legacy, prepare_ref: 'missing', finalization_ref: 'missing', cleanup_ref: 'missing', observation_refs: ['none'] };
  // Placeholder ids resolve to no real artifact, so they can no longer be counted as citations.
  expect(assessmentReferencesAuthentic(placeholders, [])).toBe(false);
  const partial: EnvironmentAssessment = { ...legacy, prepare_ref: null };
  expect(assessmentReferencesAuthentic(partial, ['none'])).toBe(false);
});
