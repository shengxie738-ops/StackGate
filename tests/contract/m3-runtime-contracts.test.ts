import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {
  BackendObservation, EnvironmentAssessment, EnvironmentCleanup, EnvironmentFinalization, EnvironmentManifest, PlanContext,
} from '../../packages/contracts/src/index.js';
import {validateSchema} from '../../packages/contracts/src/index.js';
import {assessEnvironment, assessmentReferencesAuthentic, type EnvironmentAssessmentInput} from '../../packages/core/src/services/environment-assessment.js';
import {builtinAdapterFactories, createRuntimeAdapterRegistry} from '../../packages/core/src/services/adapter-registry.js';

const read = (name: string) => JSON.parse(readFileSync(`tests/fixtures/protocols/${name}.json`, 'utf8'));
const context = { config: { commands: { smoke: { exec: 'node', args: [] } } } } as unknown as PlanContext;

function baseInput(overrides: Partial<EnvironmentAssessmentInput> = {}): EnvironmentAssessmentInput {
  const prepare = { ...read('environment'), run_id: 'run_m3_contract_demo' } as EnvironmentManifest;
  const finalization = { ...read('environment-finalization'), run_id: prepare.run_id, instance_id: prepare.instance_id, input_hash: prepare.input_hash, data_revision: prepare.data_revision, provenance: prepare.provenance } as EnvironmentFinalization;
  const cleanup = { ...read('environment-cleanup'), run_id: prepare.run_id, resources: (read('environment-cleanup').resources ?? []).map((resource: { run_id: string }) => ({ ...resource, run_id: prepare.run_id })) } as EnvironmentCleanup;
  const observation = { ...read('backend-observation'), run_id: prepare.run_id, instance_id: prepare.instance_id ?? 'instance_backend_1' } as BackendObservation;
  return {
    run_id: 'run_m3_contract_demo',
    expected_input_hash: prepare.input_hash,
    required_by_task: true,
    requires_backend_observation: true,
    expected_data_revision: prepare.data_revision,
    required_operations: [observation.operation_key],
    prepare: { ...prepare, provenance: finalization.provenance },
    finalization,
    cleanup,
    observations: [observation],
    authenticated_refs: ['art_environment_prepare', 'art_environment_finalize', 'art_environment_cleanup', observation.request_id],
    authenticated_digests: { [observation.request_id]: observation.response_digest },
    prepare_ref: 'art_environment_prepare',
    finalization_ref: 'art_environment_finalize',
    cleanup_ref: 'art_environment_cleanup',
    ...overrides,
  };
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
  expect(assessmentReferencesAuthentic(assessment, baseInput().authenticated_refs)).toBe(true);
  expect(validateSchema('environment-assessment', assessment).ok).toBe(true);
});

it('refuses an assessment that cites references the core never authenticated', () => {
  const assessment = assessEnvironment(baseInput({ authenticated_refs: ['art_environment_prepare'] }));
  expect(assessment.satisfied).toBe(false);
  expect(assessment.reasons).toContain('ENV_REFERENCE_UNAUTHENTICATED');
  expect(assessmentReferencesAuthentic(assessment, ['art_environment_prepare'])).toBe(false);
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
  const revisionless = assessEnvironment(baseInput({ expected_data_revision: null }));
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
    authenticated_digests: { [(input.observations[0] as BackendObservation).request_id]: '3'.repeat(64) },
  });
  expect(forgedDigest.satisfied).toBe(false);
  expect(forgedDigest.reasons).toContain('ENV_BACKEND_OBSERVATION_DIGEST');

  const unobserved = assessEnvironment({ ...input, required_operations: ['api:GET /api/never-called'] });
  expect(unobserved.satisfied).toBe(false);
  expect(unobserved.reasons).toContain('ENV_REQUIRED_OPERATION_UNOBSERVED');
});

it('keeps a purely local profile without environment requirements satisfied, but records the scope', () => {
  const local = assessEnvironment({
    ...baseInput(), required_by_task: false, prepare: null, finalization: null, cleanup: null,
    observations: [], prepare_ref: null, finalization_ref: null, cleanup_ref: null, authenticated_refs: [],
  });
  expect(local.satisfied).toBe(true);
  expect(local.reasons).toEqual(['NO_ENVIRONMENT_REQUIRED']);
  const requiredButEmpty = assessEnvironment({
    ...baseInput(), required_by_task: true, prepare: null, finalization: null, cleanup: null,
    observations: [], prepare_ref: null, finalization_ref: null, cleanup_ref: null,
  });
  expect(requiredButEmpty.satisfied).toBe(false);
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
