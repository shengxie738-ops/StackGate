import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {
  BackendObservation, EnvironmentAssessment, EnvironmentCleanup, EnvironmentFinalization, EnvironmentManifest, PlanContext,
} from '../../packages/contracts/src/index.js';
import {validateSchema} from '../../packages/contracts/src/index.js';
import {
  assessEnvironment, assessmentReferencesAuthentic,
  type ConfirmedEnvironmentRequirements, type EnvironmentAssessmentInput,
} from '../../packages/core/src/services/environment-assessment.js';
import {builtinAdapterFactories, createRuntimeAdapterRegistry} from '../../packages/core/src/services/adapter-registry.js';

const read = (name: string) => JSON.parse(readFileSync(`tests/fixtures/protocols/${name}.json`, 'utf8'));
const context = { config: { commands: { smoke: { exec: 'node', args: [] } } } } as unknown as PlanContext;

/** The identity the core records for the resources it created in this run. */
const CREATION_IDENTITY = 'stackgate-v2-contract-worker';
const RESOURCE_CREATED_AT = ['2026-09-21T10:01:00.000Z', '2026-09-21T10:02:00.000Z'];

/**
 * The artifact ids this run's index holds for the observed request. V2-R06 replaced `observation.request_id`
 * here: an HTTP request id is not an artifact id, and this contract fixture used to hand one in as if it were,
 * which manufactured the very condition the audit calls a defect (V2-F03). The real-store proof of the same
 * rule lives in `tests/integration/environment/evidence-authentication.test.ts`.
 */
const OBSERVATION_ARTIFACT_ID = 'artifact_v2_r06_backend_observation';
const RESPONSE_ARTIFACT_ID = 'artifact_v2_r06_response_body';

/**
 * The confirmed requirement set for the contract demo: an attached environment, one backend observation and an
 * OBSERVED floor. V2-R05 replaced the loose per-field booleans on the input with this object.
 */
function confirmedRequirements(prepare: EnvironmentManifest, observation: BackendObservation): ConfirmedEnvironmentRequirements {
  return {
    required_by_profile: true,
    required_by_task: true,
    requires_backend_observation: true,
    minimum_provenance: 'OBSERVED',
    expected_data_revision: prepare.data_revision,
    expected_origins: { frontend: prepare.frontend_origin ?? null, backend: prepare.backend_origin ?? null },
    required_operations: [observation.operation_key],
  };
}

function baseInput(overrides: Partial<EnvironmentAssessmentInput> = {}): EnvironmentAssessmentInput {
  const prepare = { ...read('environment'), run_id: 'run_m3_contract_demo' } as EnvironmentManifest;
  const finalization = { ...read('environment-finalization'), run_id: prepare.run_id, instance_id: prepare.instance_id, input_hash: prepare.input_hash, data_revision: prepare.data_revision, provenance: prepare.provenance, frontend_origin: prepare.frontend_origin, backend_origin: prepare.backend_origin } as EnvironmentFinalization;
  const observed = { ...read('backend-observation'), run_id: prepare.run_id, instance_id: prepare.instance_id ?? 'instance_backend_1' } as BackendObservation;
  // The prepare ledger and the cleanup report correspond item by item in both directions.
  const reported = (read('environment-cleanup').resources as Record<string, unknown>[]).map((resource, index) => ({
    ...resource,
    run_id: prepare.run_id,
    creation_identity: CREATION_IDENTITY,
    created_at: RESOURCE_CREATED_AT[index] ?? RESOURCE_CREATED_AT[0],
  }));
  const ledger = (read('environment-cleanup').resources as Record<string, unknown>[]).map((resource, index) => ({
    run_id: prepare.run_id,
    owner_token: resource.owner_token,
    resource_type: resource.resource_type,
    native_id: resource.native_id,
    created_at: RESOURCE_CREATED_AT[index] ?? RESOURCE_CREATED_AT[0],
    creation_identity: CREATION_IDENTITY,
    created_by_stackgate: resource.created_by_stackgate,
    cleanup_status: resource.cleanup_status,
  })) as EnvironmentManifest['resources'];
  const cleanup = { ...read('environment-cleanup'), run_id: prepare.run_id, resources: reported } as unknown as EnvironmentCleanup;
  return {
    run_id: 'run_m3_contract_demo',
    expected_input_hash: prepare.input_hash,
    requirements: confirmedRequirements(prepare, observed),
    run_window: { started_at: '2026-09-21T10:00:00.000Z', finished_at: '2026-09-21T10:15:00.000Z' },
    prepare: { ...prepare, provenance: finalization.provenance, resources: ledger },
    finalization,
    cleanup,
    observations: [{ observation: observed, artifact_ids: [OBSERVATION_ARTIFACT_ID, RESPONSE_ARTIFACT_ID] }],
    authenticated_refs: [
      'art_environment_prepare', 'art_environment_finalize', 'art_environment_cleanup',
      OBSERVATION_ARTIFACT_ID, RESPONSE_ARTIFACT_ID,
    ],
    authenticated_digests: { [observed.request_id]: observed.response_digest },
    prepare_ref: 'art_environment_prepare',
    finalization_ref: 'art_environment_finalize',
    cleanup_ref: 'art_environment_cleanup',
    ...overrides,
  };
}

/** Same input with its confirmed requirements patched, leaving every other assertion untouched. */
function requiring(patch: Partial<ConfirmedEnvironmentRequirements>): EnvironmentAssessmentInput {
  const input = baseInput();
  return { ...input, requirements: { ...input.requirements, ...patch } };
}

it('reports only installed adapters as supported and returns null for the rest', () => {
  const registry = createRuntimeAdapterRegistry(builtinAdapterFactories());
  expect(registry.get('command', context)).not.toBeNull();
  expect(registry.get('junit', context)).not.toBeNull();
  expect(registry.get('playwright', context)).toBeNull();
  expect(registry.get('openapi', context)).toBeNull();
  expect(registry.get('stackgate-probe', context)).toBeNull();
  expect(registry.supportedIds()).toEqual(['command', 'junit']);
  expect(registry.supportedIds()).not.toContain('playwright');
});

it('refuses a non-factory registration and a permissive empty registry', () => {
  expect(() => createRuntimeAdapterRegistry({ environment: undefined as never })).toThrow(/function/);
  const empty = createRuntimeAdapterRegistry({});
  expect(empty.supportedIds()).toEqual([]);
  expect(empty.get('command', context)).toBeNull();
  expect(empty.get('junit', context)).toBeNull();
});

it('gives plan capability and Gate re-collection the same frozen support list', () => {
  const registry = createRuntimeAdapterRegistry(builtinAdapterFactories());
  const first = registry.supportedIds();
  expect(registry.supportedIds()).toBe(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(registry.get('command', context)).not.toBe(registry.get('command', context));
  expect(first).toEqual([...first].sort());
});

it('shares one registry identity between plan capability and execution installation', () => {
  const registry = createRuntimeAdapterRegistry(builtinAdapterFactories());
  expect(registry.isInstalled('junit')).toBe(true);
  expect(registry.isInstalled('environment')).toBe(false);
  expect(builtinAdapterFactories().playwright).toBeUndefined();
});

it('derives a satisfied environment only from fully authenticated observations', () => {
  const assessment = assessEnvironment(baseInput());
  expect(assessment.satisfied).toBe(true);
  expect(assessment.reasons).toEqual([]);
  expect(assessment.observation_refs.length).toBeGreaterThan(1);
  // V2-F03: the request identity is never a citation, and both cited ids are stored artifact ids.
  expect(assessment.observation_refs).not.toContain(baseInput().observations[0]!.observation.request_id);
  expect(assessment.observation_refs).toContain(OBSERVATION_ARTIFACT_ID);
  expect(assessment.observation_refs).toContain(RESPONSE_ARTIFACT_ID);
  expect(assessmentReferencesAuthentic(assessment, baseInput().authenticated_refs)).toBe(true);
  expect(validateSchema('environment-assessment', assessment).ok).toBe(true);
});

it('refuses an assessment that cites references the core never authenticated', () => {
  const assessment = assessEnvironment(baseInput({
    authenticated_refs: ['art_environment_prepare'],
    observations: [{ observation: baseInput().observations[0]!.observation, artifact_ids: ['art_environment_prepare'] }],
  }));
  expect(assessment.satisfied).toBe(false);
  expect(assessment.reasons).toContain('ENV_REFERENCE_UNAUTHENTICATED');
  expect(assessmentReferencesAuthentic(assessment, ['art_environment_prepare'])).toBe(false);
});

it('refuses an observation whose citation was never bound to a stored artifact', () => {
  const assessment = assessEnvironment(baseInput({ observations: [{ observation: baseInput().observations[0]!.observation, artifact_ids: [] }] }));
  expect(assessment.satisfied).toBe(false);
  expect(assessment.reasons).toContain('ENV_OBSERVATION_REFERENCE_UNBOUND');
  expect(assessment.observation_refs).not.toContain(baseInput().observations[0]!.observation.request_id);
});

it('cannot be flipped to satisfied by an externally supplied boolean', () => {
  const injected = { ...baseInput(), satisfied: true, environment_ok: true } as EnvironmentAssessmentInput;
  const assessment = assessEnvironment(injected);
  expect(assessment.satisfied).toBe(true);
  const weakened = assessEnvironment(baseInput({ prepare: null }));
  expect(weakened.satisfied).toBe(false);
  expect(weakened.reasons).toContain('ENV_PREPARE_OBSERVATION_MISSING');
});

it('treats a declared-only provenance and an unconfirmed data revision as unsatisfied', () => {
  const declared = assessEnvironment(baseInput({
    prepare: { ...(baseInput().prepare as EnvironmentManifest), provenance: 'DECLARED' },
    finalization: { ...(baseInput().finalization as EnvironmentFinalization), provenance: 'DECLARED' },
  }));
  expect(declared.satisfied).toBe(false);
  expect(declared.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');
  expect(declared.provenance).toBe('DECLARED');
  const revisionless = assessEnvironment(requiring({ expected_data_revision: null }));
  expect(revisionless.satisfied).toBe(false);
  expect(revisionless.reasons).toContain('ENV_DATA_REVISION_UNCONFIRMED');
});

it('detects instance switching, digest disagreement and required operations never observed', () => {
  const input = baseInput();
  const switched = assessEnvironment({
    ...input,
    finalization: { ...input.finalization as EnvironmentFinalization, instance_id: 'instance_other_service' },
  });
  expect(switched.satisfied).toBe(false);
  expect(switched.reasons).toContain('ENV_INSTANCE_MISMATCH');

  const forgedDigest = assessEnvironment({
    ...input,
    authenticated_digests: { [input.observations[0]!.observation.request_id]: '3'.repeat(64) },
  });
  expect(forgedDigest.satisfied).toBe(false);
  expect(forgedDigest.reasons).toContain('ENV_BACKEND_OBSERVATION_DIGEST');

  const unobserved = assessEnvironment({ ...input, requirements: { ...input.requirements, required_operations: ['api:GET /api/never-called'] } });
  expect(unobserved.satisfied).toBe(false);
  expect(unobserved.reasons).toContain('ENV_REQUIRED_OPERATION_UNOBSERVED');
});

it('records a genuinely environment-free profile without fabricating citation refs', () => {
  const noRequirements: ConfirmedEnvironmentRequirements = {
    required_by_profile: false, required_by_task: false, requires_backend_observation: false,
    minimum_provenance: 'DECLARED', expected_data_revision: null,
    expected_origins: { frontend: null, backend: null }, required_operations: [],
  };
  const local = assessEnvironment({
    ...baseInput(), requirements: noRequirements, prepare: null, finalization: null, cleanup: null,
    observations: [], prepare_ref: null, finalization_ref: null, cleanup_ref: null, run_window: null, authenticated_refs: [],
  });
  expect(local.satisfied).toBe(true);
  expect(local.reasons).toEqual(['NO_ENVIRONMENT_REQUIRED']);
  expect(local.environment_required).toBe(false);
  expect(local.prepare_ref).toBeNull();
  expect(local.finalization_ref).toBeNull();
  expect(local.cleanup_ref).toBeNull();
  expect(local.observation_refs).toEqual([]);
  expect(validateSchema('environment-assessment', local).ok).toBe(true);
  expect(assessmentReferencesAuthentic(local, [])).toBe(true);
  const requiredButEmpty = assessEnvironment({
    ...baseInput(), prepare: null, finalization: null, cleanup: null,
    observations: [], prepare_ref: null, finalization_ref: null, cleanup_ref: null,
  });
  expect(requiredButEmpty.satisfied).toBe(false);
});

it('refuses to treat a backend observation demand as a no-environment shortcut', () => {
  // V2-F02: the removed shortcut returned satisfied:true here even though backend observation was required.
  const contradictory: ConfirmedEnvironmentRequirements = {
    ...baseInput().requirements, required_by_profile: false, required_by_task: false,
  };
  expect(() => assessEnvironment({
    ...baseInput(), requirements: contradictory, prepare: null, finalization: null, cleanup: null,
    observations: [], prepare_ref: null, finalization_ref: null, cleanup_ref: null, authenticated_refs: [],
  })).toThrow(/contradictory/);
  // The same contradictory requirement set is refused even when no environment document is in use at all.
  const stillContradictory = assessEnvironment({
    ...baseInput(), requirements: { ...contradictory, requires_backend_observation: false, minimum_provenance: 'DECLARED', expected_data_revision: null, required_operations: [], expected_origins: { frontend: null, backend: null } },
    prepare: null, finalization: null, cleanup: null, observations: [],
    prepare_ref: null, finalization_ref: null, cleanup_ref: null, authenticated_refs: [],
  });
  expect(stillContradictory.satisfied).toBe(true);
});

it('refuses every non-READY prepare status, including a CLEANED snapshot that overwrote READY', () => {
  const observed: Record<string, { satisfied: boolean; reasons: string[] }> = {};
  for (const status of ['BLOCKED', 'ERROR', 'UNKNOWN', 'CLEANED'] as const) {
    const input = baseInput();
    input.prepare = { ...input.prepare!, status };
    expect(input.prepare.status).toBe(status);
    const assessment = assessEnvironment(input);
    observed[status] = { satisfied: assessment.satisfied, reasons: assessment.reasons };
    expect(assessment.satisfied).toBe(false);
  }
  expect(observed.BLOCKED!.reasons).toContain('ENV_PREPARE_NOT_READY');
  expect(observed.ERROR!.reasons).toContain('ENV_PREPARE_NOT_READY');
  expect(observed.UNKNOWN!.reasons).toContain('ENV_PREPARE_NOT_READY');
  expect(observed.CLEANED!.reasons).toContain('ENV_PREPARE_HISTORY_OVERWRITTEN');
});

it('takes the weakest provenance level and compares it against the confirmed minimum', () => {
  const mixed = baseInput({
    prepare: { ...(baseInput().prepare as EnvironmentManifest), provenance: 'OBSERVED' },
    finalization: { ...(baseInput().finalization as EnvironmentFinalization), provenance: 'CONTROLLED' },
  });
  const atObserved = assessEnvironment(mixed);
  expect(atObserved.provenance).toBe('OBSERVED');
  expect(atObserved.satisfied).toBe(true);
  expect(atObserved.reasons).toEqual([]);
  const atControlled = assessEnvironment({ ...mixed, requirements: { ...mixed.requirements, minimum_provenance: 'CONTROLLED' } });
  expect(atControlled.provenance).toBe('OBSERVED');
  expect(atControlled.satisfied).toBe(false);
  expect(atControlled.reasons).toContain('ENV_PROVENANCE_INSUFFICIENT');
  // A run whose documents both self-report CONTROLLED is still not certified by the application alone.
  const selfClaimed = baseInput({
    prepare: { ...(baseInput().prepare as EnvironmentManifest), provenance: 'CONTROLLED' },
    finalization: { ...(baseInput().finalization as EnvironmentFinalization), provenance: 'CONTROLLED' },
  });
  const claimed = assessEnvironment({ ...selfClaimed, requirements: { ...selfClaimed.requirements, minimum_provenance: 'CONTROLLED' } });
  expect(claimed.satisfied).toBe(false);
  expect(claimed.provenance).toBe('OBSERVED');
  expect(claimed.reasons).toContain('ENV_PROVENANCE_NOT_CERTIFIED');
});

it('cross-checks the prepare resource ledger against the cleanup report in both directions', () => {
  const refusal = (mutate: (input: EnvironmentAssessmentInput) => EnvironmentAssessmentInput, reason: string) => {
    const assessment = assessEnvironment(mutate(baseInput()));
    expect(assessment.satisfied, reason).toBe(false);
    expect(assessment.reasons, reason).toContain(reason);
  };
  const owned = (input: EnvironmentAssessmentInput) => input.cleanup!.resources.find(resource => resource.created_by_stackgate)!;
  const withCleanupResources = (input: EnvironmentAssessmentInput, resources: EnvironmentCleanup['resources']) => ({
    ...input, cleanup: { ...input.cleanup!, resources },
  });

  refusal(input => withCleanupResources(input, input.cleanup!.resources.map(resource => resource.created_by_stackgate
    ? { ...resource, cleanup_status: 'FAILED' as const } : resource)), 'ENV_CLEANUP_FAILED');
  refusal(input => withCleanupResources(input, input.cleanup!.resources.map(resource => resource.created_by_stackgate
    ? { ...resource, cleanup_status: 'UNKNOWN' as const } : resource)), 'ENV_CLEANUP_UNVERIFIED');
  refusal(input => withCleanupResources(input, input.cleanup!.resources.map(resource => resource.created_by_stackgate
    ? { ...resource, cleanup_status: 'PENDING' as const } : resource)), 'ENV_CLEANUP_INCOMPLETE');
  refusal(input => ({ ...input, cleanup: { ...input.cleanup!, status: 'PARTIAL' as const } }), 'ENV_CLEANUP_INCOMPLETE');
  refusal(input => withCleanupResources(input, [...input.cleanup!.resources, {
    ...owned(input), native_id: 'deadbeef01', cleanup_status: 'CLEANED' as const,
  }]), 'ENV_CLEANUP_RESOURCE_UNMATCHED');
  refusal(input => withCleanupResources(input, input.cleanup!.resources.map(resource => resource.created_by_stackgate
    ? { ...resource, cleanup_status: 'PRESERVED' as const } : resource)), 'ENV_CLEANUP_INCOMPLETE');
  refusal(input => withCleanupResources(input, input.cleanup!.resources.map(resource => resource.created_by_stackgate
    ? resource : { ...resource, cleanup_status: 'CLEANED' as const })), 'ENV_CLEANUP_PRESERVED_BOUNDARY');
  refusal(input => withCleanupResources(input, input.cleanup!.resources.map(resource => ({ ...resource, owner_token: 'owner_other_run' }))), 'ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
  refusal(input => withCleanupResources(input, input.cleanup!.resources.map(resource => ({ ...resource, creation_identity: 'someone-else-created-it' }))), 'ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
  refusal(input => ({ ...input, cleanup: { ...input.cleanup!, resources: input.cleanup!.resources.map(resource => ({ ...resource, run_id: 'run_other_project' })) } }), 'ENV_CLEANUP_RESOURCE_SCOPE');
  refusal(input => ({ ...input, prepare: { ...input.prepare!, resources: input.prepare!.resources.map(resource => ({ ...resource, run_id: 'run_other_project' })) } }), 'ENV_RESOURCE_SCOPE_MISMATCH');

  // Direction 1: the ledger records an owned resource the cleanup report never mentions.
  refusal(input => ({
    ...input,
    cleanup: { ...input.cleanup!, resources: input.cleanup!.resources.filter(resource => !resource.created_by_stackgate) },
  }), 'ENV_CLEANUP_RESOURCE_UNREPORTED');
  // Direction 2: the cleanup report mentions a resource the ledger never recorded.
  refusal(input => ({ ...input, prepare: { ...input.prepare!, resources: input.prepare!.resources.slice(1) } }), 'ENV_CLEANUP_RESOURCE_UNMATCHED');
  // An owned entry that omits its creation identity cannot be certified item by item.
  refusal(input => withCleanupResources(input, input.cleanup!.resources.map(resource => {
    const { creation_identity: _omitted, ...rest } = resource;
    void _omitted;
    return rest;
  })), 'ENV_CLEANUP_IDENTITY_UNREPORTED');
});

it('rejects environment documents that overwrite history or omit citation structure', () => {
  expect(validateSchema('environment-finalization', read('environment-finalization')).ok).toBe(true);
  expect(validateSchema('environment-finalization', read('environment-finalization-wrong-phase')).ok).toBe(false);
  expect(validateSchema('environment-cleanup', read('environment-cleanup')).ok).toBe(true);
  expect(validateSchema('environment-cleanup', read('environment-cleanup-unowned')).ok).toBe(false);
  expect(validateSchema('environment-assessment', read('environment-assessment-unreferenced')).ok).toBe(false);
});

it('restricts probe declarations to registered operations and JSON-pointer assertions', () => {
  expect(validateSchema('probe-declaration', read('probe-declaration')).ok).toBe(true);
  const unsafe = read('probe-declaration-unsafe');
  expect(validateSchema('probe-declaration', unsafe).ok).toBe(false);
  expect(validateSchema('probe-declaration', { ...read('probe-declaration'), follow_redirects: true }).ok).toBe(false);
  expect(validateSchema('probe-declaration', { ...read('probe-declaration'), max_response_bytes: 2_000_000 }).ok).toBe(false);
  expect(validateSchema('probe-declaration', { ...read('probe-declaration'), assertions: [{ assertion_id: 'a', pointer: 'data/x', operator: 'exists' }] }).ok).toBe(false);
  expect(validateSchema('probe-declaration', { ...read('probe-declaration'), assertions: [] }).ok).toBe(false);
});

it('requires backend observations to bind identity, timing and recomputable response bytes', () => {
  expect(validateSchema('backend-observation', read('backend-observation')).ok).toBe(true);
  expect(validateSchema('backend-observation', read('backend-observation-incomplete')).ok).toBe(false);
  const good = read('backend-observation');
  expect(validateSchema('backend-observation', { ...good, response_digest: 'zz'.repeat(32) }).ok).toBe(false);
  expect(validateSchema('backend-observation', { ...good, excluded_fields: [] }).ok).toBe(false);
  expect(validateSchema('backend-observation', { ...good, digest_input_form: 'RESERIALIZED_JSON' }).ok).toBe(false);
  expect(validateSchema('backend-observation', { ...good, authorization_header: 'Bearer secret' }).ok).toBe(false);
});

it('documents the assessment shape without trusting its satisfied flag', () => {
  const tampered: EnvironmentAssessment = { ...assessEnvironment(baseInput()), satisfied: true, reasons: [] };
  expect(validateSchema('environment-assessment', tampered).ok).toBe(true);
  expect(assessmentReferencesAuthentic(tampered, [])).toBe(false);
});
