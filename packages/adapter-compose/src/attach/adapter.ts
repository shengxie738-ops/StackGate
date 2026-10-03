import { createHash } from 'node:crypto';
import type { Artifact, Diagnostic, EnvironmentManifest } from '../../../contracts/src/index.js';
import { validateSchema } from '../../../contracts/src/index.js';
import type { CleanupResult, EnvironmentPort, EnvironmentRequest, OwnedResource } from '../../../core/src/ports/environment.js';
import type { ExecutionContext } from '../../../core/src/ports/adapter.js';
import type { RestrictedArtifactWriter } from '../../../core/src/ports/evidence.js';
import { DEFAULT_HTTP_REQUEST_POLICY, authorizeRequest, normalizeOrigin, type HttpRequestPolicy } from '../../../core/src/services/http-policy.js';
import { configurationError } from '../../../core/src/services/service-error.js';
import { observeLiveProcessIdentity, observeListeningProcess, processObservationCapability, type LiveListenerOwnership, type LiveProcessIdentity } from './process-observation.js';
import {
  ATTACH_REFUSAL_CODES, collectAttachRecordEvidence, refusal, verifyAttachProvenance,
  type AttachExpectations, type AttachRecordEvidence, type AttachVerdict, type HealthProbeFacts, type ProvenanceCheck,
} from './provenance.js';

/**
 * Attach environment port (SG-056): use a service the user already started, without ever taking it over.
 *
 * `prepare` and `observe` start nothing and stop nothing, and `cleanup` never terminates the attached service:
 * every resource it reports is `PRESERVED`, and a resource claimed to have been created by StackGate is refused
 * instead of removed, because this adapter creates none at all. What it does instead is decide how much of the
 * environment's origin it can attest: a health answer alone is `DECLARED`, and only a start record that survives
 * cross-checking against live process facts becomes `OBSERVED`. `CONTROLLED` is out of reach here by rule
 * (ADR-013 §3: the core caps certification at `OBSERVED` and application self-report never upgrades).
 *
 * The single request this adapter may make is the confirmed health operation, authorised by the shared V2-R02/R03
 * policy: exact literal path, a normalised origin that must already be confirmed, GET only, absolute deadline,
 * redirects never followed, no inherited proxy or credentials, and a byte cap enforced while reading. An origin
 * that is not already on the allowlist is refused before a socket is opened — the allowlist is never widened
 * here, and no second HTTP path exists.
 */

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const ABSOLUTE = /^([/]|[A-Za-z]:[\\/])/u;

export interface AttachAdapterOptions {
  /** Absolute repository root; the configuration's `provenance_file` is relative to it and cannot escape. */
  repo_root: string;
  /** Roots the start record's source digests may be re-hashed against, in declaration order. */
  source_roots: readonly string[];
  /** Confirmed service id the health operation belongs to, so the service-to-origin binding is checked. */
  service_id: string;
  /** Confirmed health operation key (`api:GET /health`). Null means no request may be issued at all. */
  health_operation_key: string | null;
  /** Data revision confirmed before this run was created (ADR-012 §4); null keeps attach at DECLARED. */
  expected_data_revision: string | null;
  /** This run's owner token; the ledger entry and the cleanup request must name the same owner. */
  owner_token: string;
  /** Only ever a tightening of the shared budget: a value wider than the default is refused. */
  deadline_ms?: number;
  max_response_bytes?: number;
}

/** The retained evidence for one operation: what was read, asked of the OS, probed, and what it proved. */
export interface AttachEvidenceSnapshot {
  schema_version: '0.1';
  kind: 'stackgate-attach-provenance';
  phase: 'prepare' | 'observe' | 'cleanup';
  sequence: number;
  run_id: string;
  environment_id: string;
  expected_input_hash: string;
  observed_at: string;
  /** The origin the confirmed configuration binds this environment to, and the one actually requested. */
  bound_origin: string;
  probe_origin: string | null;
  health_operation_key: string | null;
  health_path: string;
  authorization: { allowed: boolean; reason: string | null; policy_origins: string[] };
  /** Requests this adapter has issued in total: a refused probe provably cost no socket. */
  probes_performed: number;
  health: HealthProbeFacts | null;
  provenance_file: { relative_path: string; readable: boolean; size: number | null; digest: string | null; reason: string | null };
  start_record: {
    pid: number | null; instance_id: string | null; data_revision: string | null; origin: string | null;
    input_hash: string | null; state_directory: string | null; observation_directory: string | null;
    process_creation: NonNullable<AttachRecordEvidence['record']>['process_creation'];
    served_routes: string[]; evidence_routes: string[]; record_digest: string | null;
  } | null;
  source_digests: { key: string; expected_digest: string; resolved_path: string | null; actual_digest: string | null; result: 'MATCH' | 'MISMATCH' | 'UNRESOLVED' }[];
  live: {
    identity: LiveProcessIdentity;
    listener: LiveListenerOwnership;
    capability: ReturnType<typeof processObservationCapability>;
  };
  expectations: { expected_input_hash: string; expected_data_revision: string | null; expected_instance_id: string | null };
  checks: ProvenanceCheck[];
  provenance: 'DECLARED' | 'OBSERVED';
  diagnostics: Diagnostic[];
  ownership: { created_by_stackgate: false; this_adapter_starts_services: false; this_adapter_terminates_services: false };
  instance_id: string | null;
  data_revision: string | null;
}

/** Everything one attach session must keep, so `observe` and `cleanup` act on the same bound facts. */
interface AttachSession {
  run_id: string;
  environment_id: string;
  input_hash: string;
  owner_token: string;
  bound_origin: string;
  frontend_origin: string | null;
  health_path: string;
  provenance_relative_path: string;
  /** The policy path patterns the provenance file was authorised under, kept for every later observation. */
  provenance_patterns: string[];
  policy_origins: string[];
  level: 'DECLARED' | 'OBSERVED';
  instance_id: string | null;
  data_revision: string;
  pid: number | null;
  ledger: OwnedResource[];
  observations: string[];
  sequence: number;
  writer: RestrictedArtifactWriter;
  clock: () => string;
  diagnostics: Diagnostic[];
  manifest: EnvironmentManifest;
}

export class AttachAdapter implements EnvironmentPort {
  readonly #options: AttachAdapterOptions;
  readonly #budget: Pick<HttpRequestPolicy, 'deadline_ms' | 'max_response_bytes'>;
  readonly #sessions = new Map<string, AttachSession>();
  #probes = 0;

  constructor(options: AttachAdapterOptions) {
    if (!ABSOLUTE.test(options.repo_root)) {
      throw configurationError('AttachAdapter requires an absolute repository root to resolve the declared provenance file within.', 'repo_root', 'attach-adapter');
    }
    if (!SAFE_ID.test(options.service_id)) throw configurationError('AttachAdapter requires the confirmed service identifier of the health operation.', 'service_id', 'attach-adapter');
    if (!SAFE_ID.test(options.owner_token)) throw configurationError('AttachAdapter requires this run owner token as a safe identifier.', 'owner_token', 'attach-adapter');
    for (const [field, ceiling] of [['deadline_ms', DEFAULT_HTTP_REQUEST_POLICY.deadline_ms], ['max_response_bytes', DEFAULT_HTTP_REQUEST_POLICY.max_response_bytes]] as const) {
      const value = options[field];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > ceiling)) {
        throw configurationError(`AttachAdapter ${field} must be a positive safe integer no larger than the shared HTTP budget of ${String(ceiling)}.`, field, 'attach-adapter');
      }
    }
    this.#options = options;
    // The budget is the shared one, tightened at most; origins are only ever what was already confirmed.
    this.#budget = Object.freeze({
      deadline_ms: options.deadline_ms ?? DEFAULT_HTTP_REQUEST_POLICY.deadline_ms,
      max_response_bytes: options.max_response_bytes ?? DEFAULT_HTTP_REQUEST_POLICY.max_response_bytes,
    });
  }

  /** Refusals and open facts from the latest operation of a run, so a caller can report them verbatim. */
  diagnostics(run_id: string): Diagnostic[] {
    return [...(this.#sessions.get(run_id)?.diagnostics ?? [])];
  }

  /** Requests actually issued by this adapter, so "refused before the socket" is checkable from outside. */
  get probes_performed(): number {
    return this.#probes;
  }

  async prepare(request: EnvironmentRequest, context: ExecutionContext): Promise<EnvironmentManifest> {
    const configuration = request.configuration;
    if (configuration.mode !== 'attach') {
      const diagnostics = [refusal(ATTACH_REFUSAL_CODES.CONFIGURATION_INVALID, 'This adapter only attaches to an existing service; the confirmed environment is not an attach environment.', '/mode', { mode: configuration.mode }, 'UNSUPPORTED_CAPABILITY')];
      return this.#blocked(request, null, null, diagnostics);
    }
    if (!SHA256.test(request.input_hash)) {
      const diagnostics = [refusal(ATTACH_REFUSAL_CODES.CONFIGURATION_INVALID, 'The run candidate input hash is not a bare SHA-256, so nothing can be bound to the current input.', '/input_hash', { length: request.input_hash.length })];
      return this.#blocked(request, null, null, diagnostics);
    }
    const backend = normalizeOrigin(configuration.backend_origin);
    if (!backend.ok) {
      const diagnostics = [refusal(ATTACH_REFUSAL_CODES.CONFIGURATION_INVALID, `The declared backend origin is not confirmable: ${backend.reason}.`, '/backend_origin', { declared: configuration.backend_origin })];
      return this.#blocked(request, null, null, diagnostics);
    }
    const frontend = normalizeOrigin(configuration.frontend_origin);
    if (!frontend.ok) {
      const diagnostics = [refusal(ATTACH_REFUSAL_CODES.CONFIGURATION_INVALID, `The declared frontend origin is not confirmable: ${frontend.reason}.`, '/frontend_origin', { declared: configuration.frontend_origin })];
      return this.#blocked(request, null, backend.value.origin, diagnostics);
    }
    const boundOrigin = backend.value.origin;
    const boundFrontend = frontend.value.origin;

    // Only origins the effective policy *and* the run context already confirmed may be reached; nothing is added.
    const confirmed = intersectOrigins(request.policy.allowed_origins, context.allowed_origins);
    const policy: HttpRequestPolicy = { ...this.#budget, allow_redirects: false, allowed_origins: confirmed, allowed_methods: Object.freeze(['GET'] as readonly string[]) };
    const decision = authorizeRequest({
      policy, origin: boundOrigin, method: 'GET', path: configuration.health_path,
      declared_operation_key: this.#options.health_operation_key,
      service_origins: { [this.#options.service_id]: boundOrigin },
    });

    const expectations: AttachExpectations = {
      run_id: request.run_id, environment_id: request.environment_id, expected_input_hash: request.input_hash,
      expected_origin: boundOrigin, health_path: configuration.health_path,
      expected_data_revision: this.#options.expected_data_revision, expected_instance_id: null,
    };
    const clock = () => context.clock.now();
    const health = decision.allowed ? await this.#probeHealth(boundOrigin, configuration.health_path, policy, context.signal, clock)
      : refusedProbe(decision.reason, clock());
    const diagnostics: Diagnostic[] = [];
    if (!decision.allowed) {
      diagnostics.push(refusal(
        decision.reason === 'ORIGIN_NOT_AUTHORIZED' ? ATTACH_REFUSAL_CODES.ORIGIN_NOT_AUTHORIZED : ATTACH_REFUSAL_CODES.REQUEST_NOT_AUTHORIZED,
        `The confirmed health operation was not authorised against the existing HTTP policy (${decision.reason}), so no request was issued and no answer was observed.`,
        '/allowed_origins', { reason: decision.reason, bound_origin: boundOrigin, policy_origins: [...confirmed] },
        decision.reason === 'ORIGIN_NOT_AUTHORIZED' ? 'POLICY_WEAKEN_ATTEMPT' : 'ENV_PROVENANCE_INSUFFICIENT'));
    }

    const evidence = await this.#readRecord(configuration, request.policy.allowed_paths, diagnostics);
    const live = await observe(evidence);
    const verdict = verifyAttachProvenance({ evidence, expectations, identity: live.identity, listener: live.listener, health });
    diagnostics.push(...verdict.diagnostics);

    const manifest = this.#manifest({ request, verdict, boundOrigin, boundFrontend, health, diagnostics });
    const sequence = 1;
    const snapshot = this.#snapshot({
      phase: 'prepare', sequence, run_id: request.run_id, environment_id: request.environment_id, manifest,
      boundOrigin, healthPath: configuration.health_path, policy_origins: confirmed, decision, health, evidence,
      identity: live.identity, listener: live.listener, verdict, diagnostics, observed_at: clock(), expected_instance_id: null,
    });
    const written = await this.#store(context.artifacts, `attach-prepare-${request.environment_id}.json`, snapshot);
    if (written !== null) manifest.observations = [written.artifact_id];
    else {
      diagnostics.push(refusal(ATTACH_REFUSAL_CODES.EVIDENCE_UNWRITABLE, 'The prepare snapshot could not be written, so this attach retains no evidence of its own verdict.', '/observations', {}));
      manifest.reasons = [...new Set([...manifest.reasons, ATTACH_REFUSAL_CODES.EVIDENCE_UNWRITABLE])].sort();
    }

    this.#sessions.set(request.run_id, {
      run_id: request.run_id, environment_id: request.environment_id, input_hash: request.input_hash,
      owner_token: this.#options.owner_token, bound_origin: boundOrigin, frontend_origin: boundFrontend,
      health_path: configuration.health_path, provenance_relative_path: configuration.provenance_file,
      provenance_patterns: [...request.policy.allowed_paths], policy_origins: confirmed,
      level: verdict.level, instance_id: verdict.instance_id, data_revision: manifest.data_revision, pid: verdict.pid,
      ledger: manifest.resources, observations: [...manifest.observations], sequence, writer: context.artifacts,
      clock, diagnostics, manifest,
    });
    return manifest;
  }

  /**
   * A fresh, independent look at the same bound origin. It never starts or stops anything, never rewrites the
   * prepare snapshot, and reports the level the *current* evidence supports — including a downgrade when the
   * process behind the attach changed or disappeared mid-run.
   */
  async observe(request: { manifest: EnvironmentManifest; expected_input_hash: string; signal: AbortSignal }): Promise<EnvironmentManifest> {
    const session = this.#sessions.get(request.manifest.run_id);
    if (session === undefined) {
      // No session means no writer and no bound facts: say so instead of dressing the old manifest up again.
      return { ...structuredClone(request.manifest), reasons: [...new Set([...request.manifest.reasons, ATTACH_REFUSAL_CODES.SESSION_UNKNOWN])].sort() };
    }
    const policy: HttpRequestPolicy = { ...this.#budget, allow_redirects: false, allowed_origins: session.policy_origins, allowed_methods: Object.freeze(['GET'] as readonly string[]) };
    const decision = authorizeRequest({
      policy, origin: session.bound_origin, method: 'GET', path: session.health_path,
      declared_operation_key: this.#options.health_operation_key, service_origins: { [this.#options.service_id]: session.bound_origin },
    });
    const refusals: Diagnostic[] = [];
    const health = decision.allowed ? await this.#probeHealth(session.bound_origin, session.health_path, policy, request.signal, session.clock)
      : refusedProbe(decision.reason, session.clock());
    if (!decision.allowed) {
      refusals.push(refusal(
        decision.reason === 'ORIGIN_NOT_AUTHORIZED' ? ATTACH_REFUSAL_CODES.ORIGIN_NOT_AUTHORIZED : ATTACH_REFUSAL_CODES.REQUEST_NOT_AUTHORIZED,
        `The confirmed health operation was not authorised against the existing HTTP policy (${decision.reason}), so this observation issued no request.`,
        '/allowed_origins', { reason: decision.reason, bound_origin: session.bound_origin, policy_origins: [...session.policy_origins] },
        decision.reason === 'ORIGIN_NOT_AUTHORIZED' ? 'POLICY_WEAKEN_ATTEMPT' : 'ENV_PROVENANCE_INSUFFICIENT'));
    }
    const evidence = await this.#readRecord({ provenance_file: session.provenance_relative_path, health_path: session.health_path }, session.provenance_patterns, refusals);
    const live = await observe(evidence);
    const expectations: AttachExpectations = {
      run_id: session.run_id, environment_id: session.environment_id, expected_input_hash: session.input_hash,
      expected_origin: session.bound_origin, health_path: session.health_path,
      expected_data_revision: this.#options.expected_data_revision, expected_instance_id: session.instance_id,
    };
    const verdict = verifyAttachProvenance({ evidence, expectations, identity: live.identity, listener: live.listener, health });
    const diagnostics = [...session.diagnostics, ...refusals, ...verdict.diagnostics];
    const inputDrift = request.expected_input_hash !== session.input_hash;
    if (inputDrift) {
      diagnostics.push(refusal(ATTACH_REFUSAL_CODES.INPUT_HASH_MISMATCH, 'The caller asked this attach about a different candidate input than the one the run was created with.', '/expected_input_hash', {
        session_input_hash: session.input_hash, requested_input_hash: request.expected_input_hash,
      }, 'INPUT_STALE'));
    }

    session.sequence += 1;
    session.diagnostics = diagnostics;
    const healthy = health.requested && health.status_code !== null && health.status_code >= 200 && health.status_code < 300;
    const reasons = [...new Set([
      ...(verdict.level === 'OBSERVED' ? [] : diagnostics.map(entry => String(entry.rule_id ?? entry.code))),
      ...(inputDrift ? [ATTACH_REFUSAL_CODES.INPUT_HASH_MISMATCH] : []),
    ])].sort();
    const manifest: EnvironmentManifest = {
      ...structuredClone(request.manifest),
      status: healthy ? 'READY' : 'BLOCKED',
      provenance: verdict.level,
      instance_id: verdict.instance_id,
      data_revision: verdict.data_revision ?? 'UNATTESTED',
      frontend_origin: session.frontend_origin,
      backend_origin: session.bound_origin,
      input_hash: session.input_hash,
      // The ledger keeps the identity that was bound at prepare; a changed live identity is reported as a
      // refusal below, never silently rewritten into the history of what this run attached to.
      resources: structuredClone(session.ledger),
      reasons,
      observations: [...session.observations],
    };
    if (live.identity.status === 'OBSERVED' && session.pid !== null && live.identity.creation_identity !== null
      && (session.ledger.find(entry => entry.native_id === `pid-${String(session.pid)}`)?.creation_identity ?? '') !== live.identity.creation_identity) {
      reasons.push(ATTACH_REFUSAL_CODES.CREATION_IDENTITY_MISMATCH);
      manifest.reasons = [...new Set(reasons)].sort();
    }
    const snapshot = this.#snapshot({
      phase: 'observe', sequence: session.sequence, run_id: session.run_id, environment_id: session.environment_id, manifest,
      boundOrigin: session.bound_origin, healthPath: session.health_path, policy_origins: session.policy_origins, decision, health, evidence,
      identity: live.identity, listener: live.listener, verdict, diagnostics, observed_at: session.clock(), expected_instance_id: session.instance_id,
    });
    const written = await this.#store(session.writer, `attach-observe-${session.environment_id}-${String(session.sequence).padStart(4, '0')}.json`, snapshot);
    if (written !== null) {
      manifest.observations = [...session.observations, written.artifact_id];
      session.observations = manifest.observations;
    } else diagnostics.push(refusal(ATTACH_REFUSAL_CODES.EVIDENCE_UNWRITABLE, 'This observation could not be retained, so it adds no evidence to the run.', '/observations', {}));
    session.level = verdict.level;
    session.instance_id = verdict.instance_id;
    session.data_revision = manifest.data_revision;
    session.manifest = manifest;
    return manifest;
  }

  /**
   * Report the attached service as preserved. There is no path through this method that signals a process the
   * run did not create, and a resource claimed to be StackGate-created is refused rather than removed.
   */
  async cleanup(request: { run_id: string; owner_token: string; resources: readonly OwnedResource[]; signal: AbortSignal }): Promise<CleanupResult> {
    const session = this.#sessions.get(request.run_id);
    const cleaned: OwnedResource[] = [];
    const preserved: OwnedResource[] = [];
    const failed: OwnedResource[] = [];
    const diagnostics: Diagnostic[] = [];
    if (session === undefined) {
      for (const resource of request.resources) {
        failed.push({ ...structuredClone(resource), cleanup_status: 'UNKNOWN' });
        diagnostics.push(refusal(ATTACH_REFUSAL_CODES.SESSION_UNKNOWN, 'This adapter has no attach session for that run, so it can neither attribute nor touch the resource.', '/run_id', { run_id: request.run_id, native_id: resource.native_id }));
      }
      return { cleaned, preserved, failed, diagnostics };
    }
    if (request.owner_token !== session.owner_token) {
      for (const resource of request.resources) {
        failed.push({ ...structuredClone(resource), cleanup_status: 'FAILED' });
        diagnostics.push(refusal(ATTACH_REFUSAL_CODES.OWNER_TOKEN_MISMATCH, 'The owner token in the cleanup request is not the one this run attached with, so nothing in that request is ours to act on.', '/owner_token', { native_id: resource.native_id }));
      }
      session.diagnostics = [...session.diagnostics, ...diagnostics];
      return { cleaned, preserved, failed, diagnostics };
    }

    for (const resource of request.resources) {
      if (request.signal.aborted) {
        // Canceled: the rest is reported as unverified instead of handled, because nothing here may force its way
        // through a shutdown, and an unattested preservation is not a pass.
        failed.push({ ...structuredClone(resource), cleanup_status: 'UNKNOWN' });
        diagnostics.push(refusal(ATTACH_REFUSAL_CODES.CLEANUP_CANCELED, 'The cleanup was canceled before this resource could be re-identified. Nothing was terminated, and the preservation is unverified.', '/resources', {
          native_id: resource.native_id,
        }, 'RUN_CANCELED'));
        continue;
      }
      if (resource.created_by_stackgate) {
        failed.push({ ...structuredClone(resource), cleanup_status: 'FAILED' });
        diagnostics.push(refusal(ATTACH_REFUSAL_CODES.OWNERSHIP_REFUSED, 'An attach session creates no resource, so an item claiming StackGate ownership is a ledger contradiction and is refused instead of terminated.', '/created_by_stackgate', { native_id: resource.native_id, owner_token: resource.owner_token }));
        continue;
      }
      if (resource.resource_type !== 'process') {
        failed.push({ ...structuredClone(resource), cleanup_status: 'FAILED' });
        diagnostics.push(refusal(ATTACH_REFUSAL_CODES.FOREIGN_RESOURCE_UNSUPPORTED, 'An attach session owns no container, network or volume; those belong to a compose run.', '/resource_type', { native_id: resource.native_id, resource_type: resource.resource_type }));
        continue;
      }
      const attached = session.pid === null ? null : `pid-${String(session.pid)}`;
      if (attached === null || resource.native_id !== attached) {
        failed.push({ ...structuredClone(resource), cleanup_status: 'FAILED' });
        diagnostics.push(refusal(ATTACH_REFUSAL_CODES.OWNERSHIP_REFUSED, 'The resource is not the process this run attached to, so acting on it would mean touching somebody else service.', '/native_id', { native_id: resource.native_id, attached_pid: session.pid }));
        continue;
      }
      // The last act is an observation, never a signal: is the service we attached to still the same process?
      const identity = await observeLiveProcessIdentity(session.pid ?? 0);
      const ledgerEntry = session.ledger.find(entry => entry.native_id === resource.native_id);
      const unchanged = identity.status === 'OBSERVED' && identity.creation_identity !== null && identity.creation_identity === ledgerEntry?.creation_identity;
      const entry: OwnedResource = { ...structuredClone(resource), cleanup_status: unchanged ? 'PRESERVED' : 'UNKNOWN' };
      if (unchanged) preserved.push(entry);
      else {
        failed.push(entry);
        diagnostics.push(refusal(ATTACH_REFUSAL_CODES.SERVICE_NOT_FOUND_AT_FINAL_CHECK, 'The attached service could not be re-identified at the final check. This run never terminated it, and an unverifiable preservation is not a pass.', '/resources', {
          native_id: resource.native_id, status: identity.status, detail: identity.detail,
        }));
      }
      session.sequence += 1;
      const snapshot = this.#snapshot({
        phase: 'cleanup', sequence: session.sequence, run_id: session.run_id, environment_id: session.environment_id, manifest: session.manifest,
        boundOrigin: session.bound_origin, healthPath: session.health_path, policy_origins: session.policy_origins,
        decision: { allowed: false, reason: 'CLEANED_BY_REQUEST_NOT_ISSUED' }, health: null,
        evidence: unreadableEvidence(session.provenance_relative_path), identity,
        listener: { status: 'UNSUPPORTED', pid: null, addresses: [], mechanism: 'cleanup performs no socket-owner query', detail: identity.detail },
        verdict: {
          level: session.level, checks: [], diagnostics, instance_id: session.instance_id, data_revision: session.data_revision,
          bound_origin: session.bound_origin, pid: session.pid, creation_identity: identity.creation_identity, created_at: identity.created_at, listener: null,
        },
        diagnostics, observed_at: session.clock(), expected_instance_id: session.instance_id,
      });
      const written = await this.#store(session.writer, `attach-cleanup-${session.environment_id}-${String(session.sequence).padStart(4, '0')}.json`, snapshot);
      if (written === null) diagnostics.push(refusal(ATTACH_REFUSAL_CODES.EVIDENCE_UNWRITABLE, 'The final liveness check could not be retained as an artifact, so the preservation is unverified.', '/observations', {}));
    }
    session.diagnostics = [...session.diagnostics, ...diagnostics];
    return { cleaned, preserved, failed, diagnostics };
  }

  /** Read the declared provenance file, but only along a path the effective policy already authorised. */
  async #readRecord(configuration: { provenance_file: string; health_path: string }, patterns: readonly string[], diagnostics: Diagnostic[]): Promise<AttachRecordEvidence> {
    const evidence = await collectAttachRecordEvidence({
      repo_root: this.#options.repo_root,
      provenance_relative_path: configuration.provenance_file,
      health_path: configuration.health_path,
      candidate_source_roots: this.#options.source_roots,
      authorized_patterns: patterns,
    });
    if (evidence.read_reason === 'PROVENANCE_PATH_NOT_AUTHORIZED_BY_POLICY') {
      diagnostics.push(refusal(ATTACH_REFUSAL_CODES.PROVENANCE_PATH_NOT_AUTHORIZED, 'The declared provenance path is not inside a path this policy authorises, so it was refused before it was opened.', '/provenance_file', {
        provenance_file: configuration.provenance_file, authorized_patterns: [...patterns],
      }));
    }
    return evidence;
  }

  #manifest(input: {
    request: EnvironmentRequest; verdict: AttachVerdict; boundOrigin: string; boundFrontend: string; health: HealthProbeFacts;
    diagnostics: Diagnostic[];
  }): EnvironmentManifest {
    const { request, verdict, boundOrigin, boundFrontend } = input;
    const healthy = input.health.requested && input.health.status_code !== null && input.health.status_code >= 200 && input.health.status_code < 300;
    const resources: OwnedResource[] = [];
    if (verdict.pid !== null) {
      resources.push({
        run_id: request.run_id, owner_token: this.#options.owner_token, resource_type: 'process', native_id: `pid-${String(verdict.pid)}`,
        // Creation time and identity come from the live observation; without one the ledger says so plainly
        // instead of copying the record's own claim, so a forged record cannot launder itself into the ledger.
        created_at: verdict.created_at ?? input.health.observed_at, creation_identity: verdict.creation_identity ?? 'UNOBSERVED',
        created_by_stackgate: false, cleanup_status: 'PRESERVED',
      });
    }
    const reasons = [...new Set(input.diagnostics.map(entry => String(entry.rule_id ?? entry.code)))].sort();
    const manifest: EnvironmentManifest = {
      schema_version: '0.1', run_id: request.run_id, mode: 'attach', status: healthy ? 'READY' : 'BLOCKED',
      frontend_origin: boundFrontend, backend_origin: boundOrigin, instance_id: verdict.instance_id,
      provenance: verdict.level, input_hash: request.input_hash, image_ids: [], resources,
      // A level the evidence does not support is never guessed at: an unattested revision says so by name.
      data_revision: verdict.data_revision ?? 'UNATTESTED', observations: [],
      // An OBSERVED attach has nothing unresolved to report; the reasons of a DECLARED one name the shortfalls.
      reasons: verdict.level === 'OBSERVED' ? [] : reasons,
    };
    const checked = validateSchema('environment', manifest);
    if (!checked.ok) throw configurationError(`The attach prepare manifest is not schema-valid: ${JSON.stringify(checked.diagnostics).slice(0, 400)}`, 'prepare', 'attach-adapter');
    return manifest;
  }

  #blocked(request: EnvironmentRequest, boundFrontend: string | null, boundOrigin: string | null, diagnostics: Diagnostic[]): EnvironmentManifest {
    const manifest: EnvironmentManifest = {
      schema_version: '0.1', run_id: request.run_id, mode: 'attach', status: 'BLOCKED',
      frontend_origin: boundFrontend, backend_origin: boundOrigin, instance_id: null, provenance: 'DECLARED',
      input_hash: SHA256.test(request.input_hash) ? request.input_hash : '0'.repeat(64), image_ids: [], resources: [],
      data_revision: 'UNATTESTED', observations: [], reasons: [...new Set(diagnostics.map(entry => String(entry.rule_id ?? entry.code)))].sort(),
    };
    const checked = validateSchema('environment', manifest);
    if (!checked.ok) throw configurationError('The attach refusal manifest is not schema-valid.', 'prepare', 'attach-adapter');
    return manifest;
  }

  #snapshot(input: {
    phase: AttachEvidenceSnapshot['phase']; sequence: number; run_id: string; environment_id: string; manifest: EnvironmentManifest;
    boundOrigin: string; healthPath: string; policy_origins: string[]; decision: { allowed: boolean; reason?: string };
    health: HealthProbeFacts | null; evidence: AttachRecordEvidence; identity: LiveProcessIdentity;
    listener: LiveListenerOwnership; verdict: AttachVerdict; diagnostics: Diagnostic[]; observed_at: string;
    expected_instance_id: string | null;
  }): AttachEvidenceSnapshot {
    const record = input.evidence.record;
    return {
      schema_version: '0.1', kind: 'stackgate-attach-provenance', phase: input.phase, sequence: input.sequence,
      run_id: input.manifest.run_id, environment_id: input.environment_id, expected_input_hash: input.manifest.input_hash,
      observed_at: input.observed_at, bound_origin: input.boundOrigin,
      probe_origin: input.health?.requested === true ? input.boundOrigin : null,
      health_operation_key: this.#options.health_operation_key, health_path: input.healthPath,
      authorization: { allowed: input.decision.allowed, reason: input.decision.allowed ? null : (input.decision.reason ?? input.health?.refusal ?? 'NOT_ATTEMPTED'), policy_origins: [...input.policy_origins] },
      probes_performed: this.#probes,
      health: input.health,
      provenance_file: {
        relative_path: input.evidence.relative_path, readable: input.evidence.readable, size: input.evidence.size,
        digest: input.evidence.digest, reason: input.evidence.read_reason ?? input.evidence.invalid_reason,
      },
      start_record: record === null ? null : {
        pid: record.pid, instance_id: record.instance_id, data_revision: record.data_revision, origin: record.origin,
        input_hash: record.input_hash, state_directory: record.state_directory, observation_directory: record.observation_directory,
        process_creation: record.process_creation, served_routes: [...record.served_routes], evidence_routes: [...record.evidence_routes],
        record_digest: input.evidence.digest,
      },
      source_digests: input.evidence.sources.map(source => ({
        key: source.key, expected_digest: source.expected_digest, resolved_path: source.resolved_path, actual_digest: source.actual_digest,
        result: source.actual_digest === null ? 'UNRESOLVED' : (source.actual_digest === source.expected_digest ? 'MATCH' : 'MISMATCH'),
      })),
      live: { identity: input.identity, listener: input.listener, capability: processObservationCapability() },
      expectations: { expected_input_hash: input.manifest.input_hash, expected_data_revision: this.#options.expected_data_revision, expected_instance_id: input.expected_instance_id },
      checks: input.verdict.checks, provenance: input.verdict.level, diagnostics: input.diagnostics,
      ownership: { created_by_stackgate: false, this_adapter_starts_services: false, this_adapter_terminates_services: false },
      instance_id: input.verdict.instance_id, data_revision: input.verdict.data_revision,
    };
  }

  async #store(writer: RestrictedArtifactWriter, name: string, value: AttachEvidenceSnapshot): Promise<Artifact | null> {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
      return await writer.store({ name, media_type: 'application/json', bytes, artifact_kind: 'report', sensitivity: 'regular', redaction_state: 'NOT_REQUIRED' });
    } catch {
      // A snapshot that cannot be retained is a refusal, never a silently dropped fact.
      return null;
    }
  }

  /**
   * The one request this adapter makes. Authorisation already decided the target: the URL that goes on the wire
   * is re-checked against the bound origin, redirects are refused rather than followed, `identity` encoding is
   * demanded, and the byte cap is enforced while reading so an over-long body is cancelled, not buffered.
   */
  async #probeHealth(origin: string, requestPath: string, policy: HttpRequestPolicy, signal: AbortSignal, clock: () => string): Promise<HealthProbeFacts> {
    const observed_at = clock();
    const normalised = normalizeOrigin(origin);
    if (!normalised.ok) return { requested: false, refusal: normalised.reason, status_code: null, media_type: null, response_bytes: null, body_digest: null, observed_at };
    let url: URL;
    try {
      url = new URL(`${normalised.value.origin}${requestPath}`);
    } catch {
      return { requested: false, refusal: 'URL_NOT_BUILDABLE', status_code: null, media_type: null, response_bytes: null, body_digest: null, observed_at };
    }
    // The request that leaves this function must be the confirmed origin and the confirmed literal path itself.
    if (url.origin !== normalised.value.origin || url.pathname !== requestPath || url.search !== '' || url.hash !== '') {
      return { requested: false, refusal: 'URL_ESCAPES_BOUND_ORIGIN', status_code: null, media_type: null, response_bytes: null, body_digest: null, observed_at };
    }
    const deadline = AbortSignal.timeout(policy.deadline_ms);
    const combined = AbortSignal.any([signal, deadline]);
    this.#probes += 1;
    try {
      const response = await fetch(url, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: combined,
        headers: { accept: 'application/json', 'accept-encoding': 'identity' },
      });
      const encoding = response.headers.get('content-encoding');
      if (encoding !== null && encoding !== 'identity') {
        await response.body?.cancel().catch(() => undefined);
        return { requested: true, refusal: 'CONTENT_ENCODING_UNSUPPORTED', status_code: response.status, media_type: response.headers.get('content-type'), response_bytes: 0, body_digest: null, observed_at };
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader !== undefined) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > policy.max_response_bytes) {
            await reader.cancel().catch(() => undefined);
            return { requested: true, refusal: 'RESPONSE_OVER_BUDGET', status_code: response.status, media_type: response.headers.get('content-type'), response_bytes: total, body_digest: null, observed_at };
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        requested: true, refusal: null, status_code: response.status, media_type: response.headers.get('content-type'),
        response_bytes: total, body_digest: createHash('sha256').update(bytes).digest('hex'), observed_at,
      };
    } catch (error) {
      const reason = deadline.aborted ? 'DEADLINE_EXCEEDED' : (signal.aborted ? 'RUN_CANCELED' : classifyFetchFailure(error));
      return { requested: true, refusal: reason, status_code: null, media_type: null, response_bytes: null, body_digest: null, observed_at };
    }
  }
}

function refusedProbe(reason: string, observed_at: string): HealthProbeFacts {
  return { requested: false, refusal: reason, status_code: null, media_type: null, response_bytes: null, body_digest: null, observed_at };
}

/** Ask the operating system the two questions a record cannot answer about itself. */
async function observe(evidence: AttachRecordEvidence): Promise<{ identity: LiveProcessIdentity; listener: LiveListenerOwnership }> {
  const record = evidence.record;
  if (record === null) {
    const detail = 'no start record could be read, so there is no pid or port to ask the operating system about';
    return {
      identity: { status: 'UNSUPPORTED', pid: null, creation_identity: null, created_at: null, mechanism: 'none', detail },
      listener: { status: 'UNSUPPORTED', pid: null, addresses: [], mechanism: 'none', detail },
    };
  }
  const identity = await observeLiveProcessIdentity(record.pid);
  const listener = await observeListeningProcess(record.port);
  return { identity, listener };
}

function unreadableEvidence(relative_path: string): AttachRecordEvidence {
  return {
    relative_path, resolved_path: null, readable: false, digest: null, size: null, read_reason: 'CLEANUP_PERFORMS_NO_RECORD_READ',
    containing_directory: null, observation_root_exists: false, sources: [], record: null, invalid_reason: null,
  };
}

function classifyFetchFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'AbortError') return 'ABORTED';
  if (/redirect/u.test(message)) return 'REDIRECT_NOT_FOLLOWED';
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|UND_ERR_/iu.test(message)) return 'SERVICE_UNREACHABLE';
  return `REQUEST_FAILED:${name}`.slice(0, 80);
}

/** Origins both the effective policy and the run context confirmed, in normalised form. Nothing is added here. */
function intersectOrigins(policy: readonly string[], context: readonly string[]): string[] {
  const normalise = (values: readonly string[]): Set<string> => new Set((values ?? []).map(value => {
    const parsed = normalizeOrigin(value);
    return parsed.ok ? parsed.value.origin : value;
  }));
  const inContext = normalise(context);
  return [...normalise(policy)].filter(value => inContext.has(value));
}
