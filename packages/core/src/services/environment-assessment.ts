import type {
  BackendObservation, EnvironmentAssessment, EnvironmentCleanup, EnvironmentFinalization, EnvironmentManifest,
} from '../../../contracts/src/index.js';

export interface EnvironmentAssessmentInput {
  run_id: string;
  expected_input_hash: string;
  required_by_task: boolean;
  requires_backend_observation: boolean;
  /** The data revision the user confirmed for this profile; self-reported revisions never qualify. */
  expected_data_revision: string | null;
  required_operations: readonly string[];
  prepare: EnvironmentManifest | null;
  finalization: EnvironmentFinalization | null;
  cleanup: EnvironmentCleanup | null;
  observations: readonly BackendObservation[];
  /** Artifact ids whose bytes the core authenticated in this run. Unlisted references cannot count. */
  authenticated_refs: readonly string[];
  /** Digests the core recomputed from authenticated response bytes, keyed by request_id. */
  authenticated_digests: Readonly<Record<string, string>>;
  prepare_ref: string | null;
  finalization_ref: string | null;
  cleanup_ref: string | null;
}

/**
 * Derives the environment verdict from authenticated observations. A verdict is never an input: an
 * externally written `satisfied` field is absent from this signature by construction.
 */
export function assessEnvironment(input: EnvironmentAssessmentInput): EnvironmentAssessment {
  const reasons = new Set<string>();
  const refs = new Set<string>();
  const authenticated = new Set(input.authenticated_refs);
  const requireRef = (ref: string | null, missingCode: string, documentPresent: boolean) => {
    if (ref === null || !documentPresent) { reasons.add(missingCode); return; }
    if (!authenticated.has(ref)) reasons.add('ENV_REFERENCE_UNAUTHENTICATED');
    else refs.add(ref);
  };

  const noEnvironmentInUse = !input.prepare && !input.finalization && !input.cleanup && !input.observations.length;
  if (!input.required_by_task && noEnvironmentInUse) {
    reasons.add('NO_ENVIRONMENT_REQUIRED');
    return build({ satisfied: true, provenance: 'DECLARED', data_revision: 'NO_ENVIRONMENT' });
  }

  requireRef(input.prepare_ref, 'ENV_PREPARE_OBSERVATION_MISSING', Boolean(input.prepare));
  requireRef(input.finalization_ref, 'ENV_FINALIZE_OBSERVATION_MISSING', Boolean(input.finalization));
  requireRef(input.cleanup_ref, 'ENV_CLEANUP_OBSERVATION_MISSING', Boolean(input.cleanup));

  const { prepare, finalization, cleanup } = input;
  if (!prepare || !finalization || !cleanup) {
    reasons.add('ENV_OBSERVATION_DOCUMENTS_INCOMPLETE');
  } else {
    if (prepare.run_id !== input.run_id || finalization.run_id !== input.run_id || cleanup.run_id !== input.run_id) {
      reasons.add('ENV_RUN_IDENTITY_MISMATCH');
    }
    if (prepare.input_hash !== input.expected_input_hash || finalization.input_hash !== input.expected_input_hash) {
      reasons.add('ENV_INPUT_MISMATCH');
    }
    if (prepare.provenance === 'DECLARED' || finalization.provenance === 'DECLARED') reasons.add('ENV_PROVENANCE_INSUFFICIENT');
    if (finalization.phase !== 'finalize') reasons.add('ENV_FINALIZE_PHASE_INVALID');
    if (finalization.instance_changed) reasons.add('ENV_INSTANCE_CHANGED_DURING_RUN');
    else if (prepare.instance_id !== finalization.instance_id) reasons.add('ENV_INSTANCE_MISMATCH');
    if (input.expected_data_revision === null) reasons.add('ENV_DATA_REVISION_UNCONFIRMED');
    else if (prepare.data_revision !== input.expected_data_revision || finalization.data_revision !== input.expected_data_revision) {
      reasons.add('ENV_DATA_REVISION_MISMATCH');
    }
    observeRequests();
    if (cleanup.status === 'FAILED') reasons.add('ENV_CLEANUP_FAILED');
    if (cleanup.status === 'UNKNOWN') reasons.add('ENV_CLEANUP_UNVERIFIED');
    for (const resource of cleanup.resources) {
      if (resource.run_id !== input.run_id) reasons.add('ENV_CLEANUP_RESOURCE_SCOPE');
      if (resource.created_by_stackgate && resource.cleanup_status === 'PENDING') reasons.add('ENV_CLEANUP_INCOMPLETE');
      if (!resource.created_by_stackgate && resource.cleanup_status === 'CLEANED') reasons.add('ENV_CLEANUP_PRESERVED_BOUNDARY');
    }
  }

  const satisfied = reasons.size === 0;
  return build({
    satisfied,
    provenance: prepare && finalization ? observedLevel(prepare, finalization) : 'DECLARED',
    data_revision: prepare?.data_revision ?? 'UNCONFIRMED',
  });

  function observeRequests(): void {
    if (input.requires_backend_observation && input.observations.length === 0) reasons.add('ENV_BACKEND_OBSERVATION_MISSING');
    const seen = new Set<string>();
    for (const observation of input.observations) {
      if (observation.run_id !== input.run_id) reasons.add('ENV_BACKEND_OBSERVATION_SCOPE');
      if (observation.instance_id !== prepare?.instance_id) reasons.add('ENV_INSTANCE_MISMATCH');
      const recomputed = input.authenticated_digests[observation.request_id];
      if (recomputed === undefined) reasons.add('ENV_BACKEND_OBSERVATION_BYTES_MISSING');
      else if (recomputed !== observation.response_digest) reasons.add('ENV_BACKEND_OBSERVATION_DIGEST');
      else {
        seen.add(observation.operation_key);
        refs.add(observation.request_id);
      }
    }
    for (const operation of input.required_operations) if (!seen.has(operation)) reasons.add('ENV_REQUIRED_OPERATION_UNOBSERVED');
  }

  function build(value: { satisfied: boolean; provenance: EnvironmentAssessment['provenance']; data_revision: string }): EnvironmentAssessment {
    return {
      schema_version: '0.1',
      run_id: input.run_id,
      input_hash: input.expected_input_hash,
      required_by_task: input.required_by_task,
      data_revision: value.data_revision,
      provenance: value.provenance,
      satisfied: value.satisfied,
      prepare_ref: input.prepare_ref ?? 'missing',
      finalization_ref: input.finalization_ref ?? 'missing',
      cleanup_ref: input.cleanup_ref ?? 'missing',
      observation_refs: (refs.size ? [...refs].sort() : ['none']) as [string, ...string[]],
      reasons: [...reasons].sort(),
    };
  }
}

function observedLevel(prepare: EnvironmentManifest, finalization: EnvironmentFinalization): EnvironmentAssessment['provenance'] {
  if (prepare.provenance === 'CONTROLLED' && finalization.provenance === 'CONTROLLED') return 'CONTROLLED';
  if (prepare.provenance === 'OBSERVED' && finalization.provenance === 'OBSERVED') return 'OBSERVED';
  return 'DECLARED';
}

/** True only when every cited reference resolves to core-authenticated bytes for this run. */
export function assessmentReferencesAuthentic(assessment: EnvironmentAssessment, authenticated_refs: readonly string[]): boolean {
  const authenticated = new Set(authenticated_refs);
  return [assessment.prepare_ref, assessment.finalization_ref, assessment.cleanup_ref, ...assessment.observation_refs]
    .every(ref => ref === 'none' || authenticated.has(ref));
}
