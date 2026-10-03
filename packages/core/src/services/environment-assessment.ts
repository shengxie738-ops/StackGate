import type {
  BackendObservation, EnvironmentAssessment, EnvironmentCleanup, EnvironmentFinalization, EnvironmentManifest,
} from '../../../contracts/src/index.js';
import { configurationError } from './service-error.js';

/** Provenance ordering fixed by the plan: DECLARED < OBSERVED < CONTROLLED. */
type ProvenanceLevel = EnvironmentAssessment['provenance'];

const LEVEL_RANK: Readonly<Record<ProvenanceLevel, number>> = { DECLARED: 0, OBSERVED: 1, CONTROLLED: 2 };

/**
 * The strongest level this pure function can certify from the environment documents alone. A document that
 * self-reports `CONTROLLED` only states a claim: CONTROLLED needs an execution-context attestation from an
 * independently started and observed environment (SG-056/058/060), which re-reading stored bytes does not
 * provide. Self-reported CONTROLLED is therefore capped, never upgraded.
 */
const CORE_CERTIFIABLE_CEILING: ProvenanceLevel = 'OBSERVED';

/** Written as `data_revision` when the core determined that no environment is required at all. */
export const NO_ENVIRONMENT_REVISION = 'NO_ENVIRONMENT';

/**
 * The environment requirements the core has already confirmed for this profile and task. Everything that can
 * refuse a run lives here, so `assessEnvironment` never has to guess from loose per-field booleans.
 */
export interface ConfirmedEnvironmentRequirements {
  required_by_profile: boolean;
  required_by_task: boolean;
  requires_backend_observation: boolean;
  minimum_provenance: ProvenanceLevel;
  expected_data_revision: string | null;
  expected_origins: { frontend: string | null; backend: string | null };
  required_operations: readonly string[];
}

/** The run's own time range; the environment lifecycle documents must fall inside it. */
export interface RunTimeRange {
  started_at: string;
  finished_at: string;
}

/**
 * One backend observation together with the artifact ids this run's index holds for it. An HTTP request id is
 * not an artifact id (V2-F03), so a citation can only ever come from the stored evidence, never from the
 * identity the request carried. `authenticateEnvironmentEvidence` produces these; a caller that cannot name
 * stored ids gets `ENV_OBSERVATION_REFERENCE_UNBOUND` instead of a self-made reference.
 */
export interface AuthenticatedObservation {
  observation: BackendObservation;
  /** Artifact ids the core re-fetched and hashed in this run: observation document plus raw response body. */
  artifact_ids: readonly string[];
}

export interface EnvironmentAssessmentInput {
  run_id: string;
  expected_input_hash: string;
  requirements: ConfirmedEnvironmentRequirements;
  /** Null when the caller cannot yet bind the run window; an environment-required verdict then stays unverified. */
  run_window: RunTimeRange | null;
  prepare: EnvironmentManifest | null;
  finalization: EnvironmentFinalization | null;
  cleanup: EnvironmentCleanup | null;
  observations: readonly AuthenticatedObservation[];
  /** Artifact ids whose bytes the core authenticated in this run. Unlisted references cannot count. */
  authenticated_refs: readonly string[];
  /** Digests the core recomputed from authenticated response bytes, keyed by request_id. */
  authenticated_digests: Readonly<Record<string, string>>;
  prepare_ref: string | null;
  finalization_ref: string | null;
  cleanup_ref: string | null;
}

type PreparedResource = EnvironmentManifest['resources'][number];
type ReportedResource = EnvironmentCleanup['resources'][number];

/**
 * Derives the environment verdict from the confirmed requirements and the evidence documents. A verdict is
 * never an input: an externally written `satisfied` field is absent from this signature by construction.
 * Pure: no file system, network, process or clock access.
 */
export function assessEnvironment(input: EnvironmentAssessmentInput): EnvironmentAssessment {
  const { requirements } = input;
  const demanded = requirements.required_by_profile || requirements.required_by_task;
  if (!demanded) {
    const contradicted = contradictoryRequirements(requirements);
    if (contradicted.length) {
      throw configurationError(
        `Environment requirements are contradictory: ${contradicted.join(', ')} is demanded while required_by_profile and required_by_task are both false`,
        'requirements', 'confirmed-environment-requirements');
    }
  }

  const reasons = new Set<string>();
  const refs = new Set<string>();
  const authenticated = new Set(input.authenticated_refs);
  const documentsInUse = Boolean(input.prepare || input.finalization || input.cleanup || input.observations.length);

  // Separate branch: a genuinely environment-free profile cites nothing and fabricates no placeholder refs.
  if (!demanded && !documentsInUse) {
    reasons.add('NO_ENVIRONMENT_REQUIRED');
    return build({ satisfied: true, provenance: 'DECLARED', data_revision: NO_ENVIRONMENT_REVISION, environment_required: false, cited: [] });
  }

  const { prepare, finalization, cleanup } = input;
  requireRef(input.prepare_ref, 'ENV_PREPARE_OBSERVATION_MISSING', Boolean(prepare));
  requireRef(input.finalization_ref, 'ENV_FINALIZE_OBSERVATION_MISSING', Boolean(finalization));
  requireRef(input.cleanup_ref, 'ENV_CLEANUP_OBSERVATION_MISSING', Boolean(cleanup));

  if (!prepare || !finalization || !cleanup) {
    reasons.add('ENV_OBSERVATION_DOCUMENTS_INCOMPLETE');
  } else {
    if (prepare.run_id !== input.run_id || finalization.run_id !== input.run_id || cleanup.run_id !== input.run_id) {
      reasons.add('ENV_RUN_IDENTITY_MISMATCH');
    }
    if (prepare.input_hash !== input.expected_input_hash || finalization.input_hash !== input.expected_input_hash) {
      reasons.add('ENV_INPUT_MISMATCH');
    }
    checkPreparation(prepare);
    checkFinalization(prepare, finalization);
    checkProvenance(prepare, finalization);
    checkDataRevision(prepare, finalization);
    checkRunWindow(finalization, cleanup);
    checkCleanup(prepare, cleanup);
  }

  // Observation demands are independent of the three documents: an absent environment never satisfies them.
  observeRequests(input.prepare);

  const satisfied = reasons.size === 0;
  return build({
    satisfied,
    provenance: prepare && finalization ? certifiedLevel(prepare, finalization) : 'DECLARED',
    data_revision: prepare?.data_revision ?? 'UNCONFIRMED',
    environment_required: true,
    cited: refs,
  });

  function requireRef(ref: string | null, missingCode: string, documentPresent: boolean): void {
    if (ref === null || !documentPresent) { reasons.add(missingCode); return; }
    if (!authenticated.has(ref)) reasons.add('ENV_REFERENCE_UNAUTHENTICATED');
    else refs.add(ref);
  }

  /** Only `READY` may enter business preparation; a `CLEANED` prepare snapshot overwrote its own history. */
  function checkPreparation(prepare: EnvironmentManifest): void {
    if (prepare.status === 'READY') {
      if (prepare.reasons.length) reasons.add('ENV_PREPARE_REASONS_UNRESOLVED');
      return;
    }
    if (prepare.status === 'CLEANED') reasons.add('ENV_PREPARE_HISTORY_OVERWRITTEN');
    else reasons.add('ENV_PREPARE_NOT_READY');
  }

  function checkFinalization(prepare: EnvironmentManifest, finalization: EnvironmentFinalization): void {
    if (finalization.phase !== 'finalize') reasons.add('ENV_FINALIZE_PHASE_INVALID');
    if (finalization.instance_changed) reasons.add('ENV_INSTANCE_CHANGED_DURING_RUN');
    else if (prepare.instance_id !== finalization.instance_id) reasons.add('ENV_INSTANCE_MISMATCH');
    for (const side of ['frontend', 'backend'] as const) {
      const code = side === 'frontend' ? 'ENV_FRONTEND_ORIGIN_MISMATCH' : 'ENV_BACKEND_ORIGIN_MISMATCH';
      const document = side === 'frontend' ? finalization.frontend_origin : finalization.backend_origin;
      const prepared = side === 'frontend' ? prepare.frontend_origin : prepare.backend_origin;
      const expected = input.requirements.expected_origins[side];
      // An origin counts as confirmed only when it equals the confirmed expectation, null included.
      if (prepared !== expected || document !== expected) reasons.add(code);
      if (!finalization.instance_changed && document !== prepared) reasons.add(code);
    }
  }

  /** Weakest claim first, then the level the core can actually certify, then the confirmed minimum. */
  function checkProvenance(prepare: EnvironmentManifest, finalization: EnvironmentFinalization): void {
    const claimed = weaker(prepare.provenance, finalization.provenance);
    const certified = weaker(claimed, CORE_CERTIFIABLE_CEILING);
    if (LEVEL_RANK[certified] >= LEVEL_RANK[input.requirements.minimum_provenance]) return;
    reasons.add('ENV_PROVENANCE_INSUFFICIENT');
    // Self-reported CONTROLLED is a claim, not certification; say so when that is what stopped the run.
    if (prepare.provenance === 'CONTROLLED' || finalization.provenance === 'CONTROLLED') reasons.add('ENV_PROVENANCE_NOT_CERTIFIED');
  }

  function checkDataRevision(prepare: EnvironmentManifest, finalization: EnvironmentFinalization): void {
    if (input.requirements.expected_data_revision === null) reasons.add('ENV_DATA_REVISION_UNCONFIRMED');
    else if (prepare.data_revision !== input.requirements.expected_data_revision
      || finalization.data_revision !== input.requirements.expected_data_revision) {
      reasons.add('ENV_DATA_REVISION_MISMATCH');
    }
  }

  function checkRunWindow(finalization: EnvironmentFinalization, cleanup: EnvironmentCleanup): void {
    if (!input.run_window) { reasons.add('ENV_RUN_WINDOW_UNAVAILABLE'); return; }
    const opened = timestamp(input.run_window.started_at);
    const closed = timestamp(input.run_window.finished_at);
    if (opened === null || closed === null) { reasons.add('ENV_RUN_WINDOW_UNAVAILABLE'); return; }
    const finalized = timestamp(finalization.observed_at);
    if (finalized === null) reasons.add('ENV_FINALIZE_TIMESTAMP_INVALID');
    else if (finalized < opened || finalized > closed) reasons.add('ENV_FINALIZE_OUT_OF_RUN_WINDOW');
    const cleaned = timestamp(cleanup.cleaned_at);
    if (cleaned === null) reasons.add('ENV_CLEANUP_TIMESTAMP_INVALID');
    else {
      if (cleaned < opened || cleaned > closed) reasons.add('ENV_CLEANUP_OUT_OF_RUN_WINDOW');
      if (finalized !== null && cleaned < finalized) reasons.add('ENV_CLEANUP_BEFORE_FINALIZE');
    }
  }

  function observeRequests(prepare: EnvironmentManifest | null): void {
    if (input.requirements.requires_backend_observation && input.observations.length === 0) reasons.add('ENV_BACKEND_OBSERVATION_MISSING');
    const seen = new Set<string>();
    for (const { observation, artifact_ids } of input.observations) {
      if (observation.run_id !== input.run_id) reasons.add('ENV_BACKEND_OBSERVATION_SCOPE');
      if (observation.instance_id !== prepare?.instance_id) reasons.add('ENV_INSTANCE_MISMATCH');
      const recomputed = input.authenticated_digests[observation.request_id];
      if (recomputed === undefined) reasons.add('ENV_BACKEND_OBSERVATION_BYTES_MISSING');
      else if (recomputed !== observation.response_digest) reasons.add('ENV_BACKEND_OBSERVATION_DIGEST');
      else {
        // Operation coverage stays gated on authenticated bytes, exactly as V2-R05 had it; the binding below
        // only decides which references the verdict may cite.
        seen.add(observation.operation_key);
        if (artifact_ids.length === 0) reasons.add('ENV_OBSERVATION_REFERENCE_UNBOUND');
        else for (const artifact_id of artifact_ids) {
          if (!authenticated.has(artifact_id)) reasons.add('ENV_REFERENCE_UNAUTHENTICATED');
          else refs.add(artifact_id);
        }
      }
    }
    for (const operation of input.requirements.required_operations) if (!seen.has(operation)) reasons.add('ENV_REQUIRED_OPERATION_UNOBSERVED');
  }

  /**
   * The prepare ledger and the cleanup report must correspond item by item in both directions, with matching
   * native id, owner token, creation identity and scope. No per-resource state is ignorable, and a foreign
   * resource is never ours to delete.
   */
  function checkCleanup(prepare: EnvironmentManifest, cleanup: EnvironmentCleanup): void {
    if (cleanup.status === 'FAILED') reasons.add('ENV_CLEANUP_FAILED');
    if (cleanup.status === 'UNKNOWN') reasons.add('ENV_CLEANUP_UNVERIFIED');
    if (cleanup.status === 'PARTIAL') reasons.add('ENV_CLEANUP_INCOMPLETE');
    if (cleanup.resources.some(resource => resource.created_by_stackgate) && cleanup.status === 'PRESERVED') reasons.add('ENV_CLEANUP_INCOMPLETE');

    const ledger = new Map<string, PreparedResource>();
    for (const resource of prepare.resources) {
      const key = identity(resource);
      if (ledger.has(key)) reasons.add('ENV_RESOURCE_LEDGER_DUPLICATE');
      ledger.set(key, resource);
      if (resource.run_id !== input.run_id) reasons.add('ENV_RESOURCE_SCOPE_MISMATCH');
      if (resource.created_by_stackgate && !resource.creation_identity) reasons.add('ENV_RESOURCE_IDENTITY_MISSING');
    }

    const reported = new Map<string, ReportedResource>();
    for (const resource of cleanup.resources) {
      const key = identity(resource);
      if (reported.has(key)) reasons.add('ENV_CLEANUP_RESOURCE_DUPLICATE');
      reported.set(key, resource);
      if (resource.run_id !== input.run_id) reasons.add('ENV_CLEANUP_RESOURCE_SCOPE');
      if (!resource.created_by_stackgate && resource.cleanup_status === 'CLEANED') reasons.add('ENV_CLEANUP_PRESERVED_BOUNDARY');
      if (resource.created_by_stackgate && resource.cleanup_status === 'PENDING') reasons.add('ENV_CLEANUP_INCOMPLETE');
      if (!resource.created_by_stackgate && (resource.cleanup_status === 'PENDING' || resource.cleanup_status === 'UNKNOWN')) reasons.add('ENV_CLEANUP_UNVERIFIED');
      if (resource.cleanup_status === 'FAILED') reasons.add('ENV_CLEANUP_FAILED');
      if (resource.cleanup_status === 'UNKNOWN') reasons.add('ENV_CLEANUP_UNVERIFIED');

      const created = ledger.get(key);
      if (!created) {
        // Neither direction may be skipped: an item the prepare ledger never recorded cannot be verified.
        reasons.add('ENV_CLEANUP_RESOURCE_UNMATCHED');
        continue;
      }
      if (resource.owner_token !== created.owner_token) reasons.add('ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
      if (resource.created_by_stackgate !== created.created_by_stackgate) reasons.add('ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
      if (resource.creation_identity !== undefined && resource.creation_identity !== created.creation_identity) reasons.add('ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
      if (resource.created_at !== undefined && resource.created_at !== created.created_at) reasons.add('ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH');
      if (created.created_by_stackgate) {
        if (resource.creation_identity === undefined) reasons.add('ENV_CLEANUP_IDENTITY_UNREPORTED');
        if (resource.cleanup_status === 'PRESERVED') reasons.add('ENV_CLEANUP_INCOMPLETE');
        const cleaned_at = timestamp(cleanup.cleaned_at);
        const created_at = timestamp(created.created_at);
        if (cleaned_at !== null && created_at !== null && cleaned_at < created_at) reasons.add('ENV_CLEANUP_BEFORE_CREATION');
      }
    }

    for (const [key, created] of ledger) {
      if (!reported.has(key) && created.created_by_stackgate) reasons.add('ENV_CLEANUP_RESOURCE_UNREPORTED');
    }
  }

  function build(value: {
    satisfied: boolean;
    provenance: ProvenanceLevel;
    data_revision: string;
    environment_required: boolean;
    cited: Iterable<string>;
  }): EnvironmentAssessment {
    return {
      schema_version: '0.1',
      run_id: input.run_id,
      input_hash: input.expected_input_hash,
      required_by_task: input.requirements.required_by_task,
      data_revision: value.data_revision,
      provenance: value.provenance,
      satisfied: value.satisfied,
      environment_required: value.environment_required,
      prepare_ref: input.prepare_ref,
      finalization_ref: input.finalization_ref,
      cleanup_ref: input.cleanup_ref,
      observation_refs: [...value.cited].sort(),
      reasons: [...reasons].sort(),
    };
  }
}

/** The weakest claim of the two documents, capped by what the core can certify without an execution context. */
function certifiedLevel(prepare: EnvironmentManifest, finalization: EnvironmentFinalization): ProvenanceLevel {
  return weaker(weaker(prepare.provenance, finalization.provenance), CORE_CERTIFIABLE_CEILING);
}

function weaker(left: ProvenanceLevel, right: ProvenanceLevel): ProvenanceLevel {
  return LEVEL_RANK[left] <= LEVEL_RANK[right] ? left : right;
}

function identity(resource: { resource_type: string; native_id: string }): string {
  return `${resource.resource_type}\u0000${resource.native_id}`;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Requirements that demand environment work while also claiming no environment is needed. */
function contradictoryRequirements(requirements: ConfirmedEnvironmentRequirements): string[] {
  const found: string[] = [];
  if (requirements.requires_backend_observation) found.push('requires_backend_observation');
  if (requirements.minimum_provenance !== 'DECLARED') found.push('minimum_provenance');
  if (requirements.expected_data_revision !== null) found.push('expected_data_revision');
  if (requirements.expected_origins.frontend !== null) found.push('expected_origins.frontend');
  if (requirements.expected_origins.backend !== null) found.push('expected_origins.backend');
  if (requirements.required_operations.length) found.push('required_operations');
  return found;
}

/**
 * True only when every cited reference resolves to core-authenticated bytes for this run. An assessment that
 * cites nothing is authentic only when the core itself recorded it as needing no environment. The old
 * unconditional `none` exemption is gone: a placeholder now has to appear in `authenticated_refs`, and since
 * V2-R06 that list is filled by `authenticateEnvironmentEvidence` with real artifact ids it re-fetched and
 * re-hashed from this run's index. Supplementary only: this check never grants success, it just confirms that
 * what `assessEnvironment` cited is stored evidence, so a refusal from the pure function still stands.
 */
export function assessmentReferencesAuthentic(assessment: EnvironmentAssessment, authenticated_refs: readonly string[]): boolean {
  const authenticated = new Set(authenticated_refs);
  const cited = [assessment.prepare_ref, assessment.finalization_ref, assessment.cleanup_ref, ...assessment.observation_refs];
  if (cited.length === 0 || cited.every(ref => ref === null)) return assessment.environment_required === false;
  return cited.every(ref => ref !== null && authenticated.has(ref));
}
