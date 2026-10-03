import type {
  Artifact, BackendObservation, Diagnostic, EnvironmentCleanup, EnvironmentFinalization, EnvironmentManifest, ReasonCode,
} from '../../../contracts/src/index.js';
import { validateSchema } from '../../../contracts/src/index.js';
import type { EvidenceReader } from '../ports/evidence.js';
import { canonicalJson } from '../storage/canonical-json.js';
import { hashBytes } from '../storage/hash.js';
import type {
  AuthenticatedObservation, ConfirmedEnvironmentRequirements, EnvironmentAssessmentInput, RunTimeRange,
} from './environment-assessment.js';import { parseStrictDocument } from './strict-document.js';

/**
 * V2-R06: turn evidence this run actually stored into facts the pure environment assessment can cite.
 *
 * Validation order implemented here. Containment is checked before I/O, because reading a path this run's
 * index never approved would be the arbitrary file read this task is supposed to rule out:
 * 1. rebuild this run's index and check every entry (artifact schema, this run only, no duplicate identity);
 * 2. run/check/attempt scope plus relative-path containment for each cited reference, before any read:
 *    digest form, own `documents/` or `artifacts/` tree, the fixed path for that document kind, presence in
 *    the index, artifact id and digest agreement with the entry, scope, and read budget;
 * 3. size and digest: re-fetch through `EvidenceReader.read` using the index entry's own path, digest and
 *    size, then re-hash the bytes here;
 * 4. integrity: the artifact the store returned must equal the indexed entry, field for field;
 * 5. document kind: strict JSON parse, then `validateSchema` for the kind the reference claims to be, with
 *    the input hash and run identity of the stored document;
 * 6. per request: run/check/attempt/request/instance/operation/status/media/timing, the digest recomputed
 *    from the raw response bytes, and the body length the observation reports;
 * 7. expectations: the confirmed requirements decide which operations must be present — an observation never
 *    adds one — and every failure is returned as a `Diagnostic`.
 *
 * This module owns the only evidence I/O on the environment path; `assessEnvironment` stays pure.
 */

/** ADR-012 §6 fixes the response body cap at 1 MiB; environment documents stay far below it. */
const MAX_EVIDENCE_BYTES = 1024 * 1024;

const BARE_SHA256 = /^[a-f0-9]{64}$/;
/** The probe helper's historical form (`sha256:` + 64 lowercase hex) is accepted only at this boundary. */
const PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/;

const DOCUMENTS_DIRECTORY = 'documents';
const ARTIFACTS_DIRECTORY = 'artifacts';

/** The lifecycle documents ADR-012 §2 pins to fixed, non-overwritable run-scoped paths. */
const ENVIRONMENT_DOCUMENT_PATHS: Record<'prepare' | 'finalization' | 'cleanup', string> = {
  prepare: `${DOCUMENTS_DIRECTORY}/environment.json`,
  finalization: `${DOCUMENTS_DIRECTORY}/environment-finalization.json`,
  cleanup: `${DOCUMENTS_DIRECTORY}/environment-cleanup.json`,
};

/** A scoped document lives under its check/attempt directory, exactly as `FileEvidenceStore` writes it. */
const scopedDocumentPath = (schema: string, check_id: string, attempt_id: string): string =>
  `${DOCUMENTS_DIRECTORY}/checks/${check_id}/${attempt_id}/${schema}.json`;

const scopedArtifactPrefix = (check_id: string, attempt_id: string): string =>
  `${ARTIFACTS_DIRECTORY}/checks/${check_id}/${attempt_id}/`;

/** A reference to one stored document or artifact, as the caller says it was written. */
export interface EvidenceDocumentRef {
  artifact_id: string;
  relative_path: string;
  /** Bare lowercase hex, or the probe layer's `sha256:` form; normalised once, here, at the boundary. */
  digest: string;
}

/** One request the task and plan already expect to have happened, with the evidence that must prove it. */
export interface ExpectedRequest {
  run_id: string;
  check_id: string;
  attempt_id: string;
  request_id: string;
  operation_key: string;
  instance_id: string;
  status_code: number;
  media_type: string;
  /** The raw, uncompressed response body artifact. */
  response_ref: EvidenceDocumentRef;
  /** The backend observation document that reports this request. */
  observation_ref: EvidenceDocumentRef;
}

/** The bytes this factory read, kept so assertion re-computation never re-reads by guesswork. */
export interface AuthenticatedResponseBytes {
  request_id: string;
  artifact_id: string;
  relative_path: string;
  media_type: string;
  /** Bare lowercase SHA-256 recomputed from `bytes` in this run. */
  digest: string;
  bytes: Uint8Array;
}

/**
 * Brand recording that `AuthenticatedEnvironmentFacts` went through this factory. It is a developer-misuse
 * guard only: the type stops a hand-assembled facts object, it is not a security boundary, and it certifies
 * nothing about where the environment bytes came from — that is SG-056/058/060.
 */
export class AuthenticatedFactsIssuer {
  /** Private member: no object literal can satisfy this type, so facts cannot be assembled by hand. */
  private readonly issued_by_factory = true as const;

  private constructor() {}

  /** Reached only from `authenticateEnvironmentEvidence` on a fully checked object. */
  static issue(): AuthenticatedFactsIssuer {
    return new AuthenticatedFactsIssuer();
  }
}

/** Assessment input whose evidence was re-fetched from this run's index. Constructible only by the factory. */
export interface AuthenticatedEnvironmentFacts extends EnvironmentAssessmentInput {
  readonly issued_by: AuthenticatedFactsIssuer;
  readonly responses: readonly AuthenticatedResponseBytes[];
}

export interface AuthenticateEnvironmentEvidenceInput {
  run_id: string;
  /** The run's confirmed input hash; the stored lifecycle documents have to carry it. */
  input_hash: string;
  /**
   * The run's own time range, supplied by the caller: `manifest.json` is not an indexed artifact, so reading it
   * here would mean trusting a path this run's index cannot vouch for. Null defers the window check to
   * `assessEnvironment`, which then refuses with `ENV_RUN_WINDOW_UNAVAILABLE`.
   */
  run_window: RunTimeRange | null;
  /** Confirmed task/profile demands. Expected operations come from here, never from an observation. */
  requirements: ConfirmedEnvironmentRequirements;
  prepare_ref: EvidenceDocumentRef;
  finalization_ref: EvidenceDocumentRef;
  cleanup_ref: EvidenceDocumentRef;
  requests: readonly ExpectedRequest[];
  reader: EvidenceReader;
  /** This run's artifact index as the store wrote it. Paths absent from it are refused, not read. */
  artifact_index: readonly Artifact[];
}

export type AuthenticateEnvironmentEvidenceResult =
  | { ok: true; facts: AuthenticatedEnvironmentFacts }
  | { ok: false; diagnostics: Diagnostic[] };

/** One cited reference that passed preflight and may therefore be read. */
interface Cleared {
  label: string;
  entry: Artifact;
  /** The normalised bare digest the caller cited; equals the index entry's digest. */
  digest: string;
}

interface ReadBack {
  artifact: Artifact;
  bytes: Uint8Array;
}

/** Storage-side digests are bare; only strings arriving from the probe/observation layer may carry the prefix. */
function boundaryDigest(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (BARE_SHA256.test(value)) return value;
  return PREFIXED_SHA256.test(value) ? value.slice('sha256:'.length) : null;
}

/**
 * Only paths inside this run's own evidence tree are ever handed to the reader. Absolute paths, drive letters,
 * backslashes, empty segments and any `.`/`..` segment are refused before I/O, as is anything outside
 * `documents/` and `artifacts/`: `restricted/`, `manifest.json`, `events.jsonl` and the seal marker are
 * store-internal facts, not evidence references.
 */
function isOwnedPath(relative: unknown, directory: string): relative is string {
  if (typeof relative !== 'string' || relative.length === 0) return false;
  if (relative.includes('\\') || relative.includes(':') || relative.startsWith('/')) return false;
  const segments = relative.split('/');
  if (segments[0] !== directory) return false;
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

function withinWindow(value: string, window: RunTimeRange): boolean {
  const at = Date.parse(value);
  const opened = Date.parse(window.started_at);
  const closed = Date.parse(window.finished_at);
  return !Number.isNaN(at) && !Number.isNaN(opened) && !Number.isNaN(closed) && at >= opened && at <= closed;
}

function refusal(code: ReasonCode, reason: string, message: string, location = 'authenticate-environment-evidence'): Diagnostic {
  return {
    code, rule_id: `SG-EVIDENCE-${reason}`, message, location, observed_facts: { reason },
    recommended_action: 'Re-collect the evidence inside this run; nothing is inferred from a path alone.',
    source: 'authenticate-environment-evidence',
  };
}

/** Re-reads and authenticates this run's stored evidence, then hands the pure core facts it can cite. */
export async function authenticateEnvironmentEvidence(
  input: AuthenticateEnvironmentEvidenceInput,
): Promise<AuthenticateEnvironmentEvidenceResult> {
  const diagnostics: Diagnostic[] = [];
  const refuse = (code: ReasonCode, reason: string, message: string, location: string, facts: Record<string, unknown> = {}): void => {
    diagnostics.push({
      code, rule_id: `SG-EVIDENCE-${reason}`, message, location, observed_facts: { reason, ...facts },
      recommended_action: 'Re-collect the evidence inside this run, or cite the artifact this run already indexed.',
      source: 'authenticate-environment-evidence',
    });
  };

  // 1. Rebuild this run's index. Invalid entries and entries from another run are dropped, so a cited foreign
  //    path simply is not indexed here and can never be read from it.
  const index = new Map<string, Artifact>();
  const indexedIds = new Set<string>();
  for (const entry of input.artifact_index) {
    const location = typeof entry?.relative_path === 'string' ? entry.relative_path : 'artifact-index';
    const checked = validateSchema('artifact', entry);
    if (!checked.ok) {
      refuse('REPORT_INVALID', 'EVIDENCE_INDEX_ENTRY_INVALID', 'Artifact index entry does not satisfy the 0.1 artifact schema', location,
        { problems: checked.diagnostics.map(diagnostic => diagnostic.message).slice(0, 3) });
      continue;
    }
    if (entry.run_id !== input.run_id) {
      refuse('POLICY_WEAKEN_ATTEMPT', 'EVIDENCE_INDEX_FOREIGN_RUN', 'Artifact index carries an entry from another run; it is not this run\'s evidence', location,
        { entry_run_id: entry.run_id, run_id: input.run_id });
      continue;
    }
    if (index.has(entry.relative_path) || indexedIds.has(entry.artifact_id)) {
      refuse('REPORT_INVALID', 'EVIDENCE_INDEX_DUPLICATE', 'Artifact index repeats an identity, so no citation taken from it is trustworthy', location,
        { artifact_id: entry.artifact_id, relative_path: entry.relative_path });
      continue;
    }
    index.set(entry.relative_path, entry);
    indexedIds.add(entry.artifact_id);
  }

  // 2. Preflight a reference against the index, without touching the file system.
  const preflight = (
    label: string, ref: EvidenceDocumentRef,
    expected: { directory: string; path?: string; check_id: string | null; attempt_id: string | null },
  ): Cleared | null => {
    const location = `${label}:${typeof ref?.relative_path === 'string' ? ref.relative_path : 'unnamed'}`;
    const digest = boundaryDigest(ref?.digest);
    if (digest === null) {
      refuse('REPORT_INVALID', 'EVIDENCE_DIGEST_FORM_INVALID', 'Cited digest is neither bare lowercase hex nor the probe layer\'s sha256-prefixed form', location,
        { digest: String(ref?.digest) });
      return null;
    }
    if (!isOwnedPath(ref.relative_path, expected.directory)) {
      refuse('POLICY_WEAKEN_ATTEMPT', 'EVIDENCE_PATH_UNOWNED', 'Cited path is outside this run\'s own documents/ or artifacts/ tree, so it is refused instead of read', location);
      return null;
    }
    if (expected.path !== undefined && ref.relative_path !== expected.path) {
      refuse('POLICY_WEAKEN_ATTEMPT', 'EVIDENCE_PATH_MISMATCH', 'Cited path is not the fixed path this document kind is stored at', location,
        { expected_path: expected.path });
      return null;
    }
    const entry = index.get(ref.relative_path);
    if (!entry) {
      refuse('MISSING_REPORT', 'EVIDENCE_PATH_UNINDEXED', 'Cited path is not in this run\'s artifact index; unindexed paths are never read', location);
      return null;
    }
    if (ref.artifact_id !== entry.artifact_id) {
      refuse('REPORT_INVALID', 'EVIDENCE_INDEX_IDENTITY_MISMATCH', 'Cited artifact id differs from the id this run indexed for that path', location,
        { indexed_artifact_id: entry.artifact_id, cited_artifact_id: ref.artifact_id });
      return null;
    }
    if (digest !== entry.digest) {
      refuse('REPORT_INVALID', 'EVIDENCE_INDEX_DIGEST_MISMATCH', 'Cited digest differs from the digest this run indexed for that artifact', location,
        { indexed_digest: entry.digest, cited_digest: digest });
      return null;
    }
    if (entry.check_id !== expected.check_id || entry.attempt_id !== expected.attempt_id) {
      refuse('REPORT_INVALID', 'EVIDENCE_SCOPE_MISMATCH', 'Cited evidence belongs to a different run, check or attempt scope', location,
        {
          indexed_check_id: entry.check_id, indexed_attempt_id: entry.attempt_id,
          expected_check_id: expected.check_id, expected_attempt_id: expected.attempt_id,
        });
      return null;
    }
    if (entry.size > MAX_EVIDENCE_BYTES) {
      refuse('ARTIFACT_BUDGET_EXCEEDED', 'EVIDENCE_OVER_BUDGET', 'Cited evidence exceeds the 1 MiB read budget, so it cannot be authenticated as a whole', location,
        { size: entry.size, max_bytes: MAX_EVIDENCE_BYTES });
      return null;
    }
    return { label, entry, digest };
  };

  // 3+4. Read it back with the entry's own identity, then re-hash and compare integrity with our own eyes.
  const readBack = async (cleared: Cleared): Promise<ReadBack | null> => {
    const location = `${cleared.label}:${cleared.entry.relative_path}`;
    const read = await input.reader.read({
      run_id: input.run_id, relative_path: cleared.entry.relative_path,
      expected_digest: cleared.entry.digest, max_bytes: cleared.entry.size,
    });
    if (read.status !== 'FOUND') {
      refuse(read.status === 'MISSING' ? 'MISSING_REPORT' : 'REPORT_INVALID', 'EVIDENCE_REREAD_FAILED',
        `Cited evidence could not be re-fetched from this run (${read.status})`, location,
        { status: read.status, from_store: read.diagnostics.map(diagnostic => diagnostic.message).slice(0, 3) });
      return null;
    }
    if (canonicalJson(read.artifact) !== canonicalJson(cleared.entry)) {
      refuse('REPORT_INVALID', 'EVIDENCE_INDEX_ARTIFACT_DIVERGED', 'The artifact the store returned is not the entry this run indexed', location);
      return null;
    }
    if (read.bytes.length !== cleared.entry.size) {
      refuse('REPORT_INVALID', 'EVIDENCE_SIZE_MISMATCH', 'Stored bytes are not the size this run indexed', location,
        { indexed_size: cleared.entry.size, read_bytes: read.bytes.length });
      return null;
    }
    const recomputed = hashBytes(read.bytes);
    if (recomputed !== cleared.entry.digest) {
      refuse('REPORT_INVALID', 'EVIDENCE_DIGEST_MISMATCH', 'Bytes re-read from this run do not hash to the digest its index recorded', location,
        { indexed_digest: cleared.entry.digest, recomputed_digest: recomputed });
      return null;
    }
    return { artifact: read.artifact, bytes: read.bytes };
  };

  const parseAs = <T extends { run_id: string }>(schema: string, cleared: Cleared, bytes: Uint8Array): T | null => {
    const location = `${cleared.label}:${cleared.entry.relative_path}`;
    let value: unknown;
    try {
      value = parseStrictDocument(bytes, location, { maxBytes: MAX_EVIDENCE_BYTES, maxDepth: 64 });
    } catch (error) {
      refuse('REPORT_INVALID', 'EVIDENCE_DOCUMENT_UNPARSEABLE', 'Stored evidence is not a strict, finite JSON document', location,
        { message: error instanceof Error ? error.message : String(error) });
      return null;
    }
    const checked = validateSchema<T>(schema, value);
    if (!checked.ok) {
      refuse('REPORT_INVALID', 'EVIDENCE_DOCUMENT_KIND_INVALID', `Stored evidence is not a valid ${schema} document`, location,
        { schema, problems: checked.diagnostics.map(diagnostic => diagnostic.message).slice(0, 3) });
      return null;
    }
    if (checked.value.run_id !== input.run_id) {
      refuse('REPORT_INVALID', 'EVIDENCE_DOCUMENT_RUN_MISMATCH', 'Stored document names a run other than this one', location,
        { document_run_id: checked.value.run_id });
      return null;
    }
    return checked.value;
  };

  const lifecycle = async <T extends { run_id: string }>(
    key: 'prepare' | 'finalization' | 'cleanup', ref: EvidenceDocumentRef,
  ): Promise<{ artifact: Artifact; value: T } | null> => {
    const label = key;
    const cleared = preflight(label, ref, { directory: DOCUMENTS_DIRECTORY, path: ENVIRONMENT_DOCUMENT_PATHS[key], check_id: null, attempt_id: null });
    if (!cleared) return null;
    if (cleared.entry.media_type !== 'application/json') {
      refuse('REPORT_INVALID', 'EVIDENCE_DOCUMENT_MEDIA_TYPE', 'Environment documents are stored as application/json', `${label}:${cleared.entry.relative_path}`,
        { media_type: cleared.entry.media_type });
      return null;
    }
    if (cleared.entry.artifact_kind !== 'report') {
      refuse('REPORT_INVALID', 'EVIDENCE_DOCUMENT_KIND_MISMATCH', 'Environment documents are stored as report artifacts', `${label}:${cleared.entry.relative_path}`,
        { artifact_kind: cleared.entry.artifact_kind });
      return null;
    }
    const read = await readBack(cleared);
    if (!read) return null;
    const value = parseAs<T>(key === 'prepare' ? 'environment' : `environment-${key}`, cleared, read.bytes);
    if (!value) return null;
    return { artifact: cleared.entry, value };
  };

  const prepared = await lifecycle<EnvironmentManifest>('prepare', input.prepare_ref);
  const finalized = await lifecycle<EnvironmentFinalization>('finalization', input.finalization_ref);
  const cleaned = await lifecycle<EnvironmentCleanup>('cleanup', input.cleanup_ref);

  // The lifecycle documents have to carry the input hash this run was planned with, and sit inside its window.
  for (const document of [prepared, finalized]) {
    if (document && document.value.input_hash !== input.input_hash) {
      refuse('INPUT_STALE', 'EVIDENCE_INPUT_HASH_MISMATCH', 'Lifecycle document was written for a different input hash', document.artifact.relative_path,
        { document_input_hash: document.value.input_hash, expected_input_hash: input.input_hash });
    }
  }
  if (input.run_window) {
    if (finalized && !withinWindow(finalized.value.observed_at, input.run_window)) {
      refuse('REPORT_INVALID', 'EVIDENCE_FINALIZE_OUT_OF_RUN_WINDOW', 'Finalization document falls outside this run\'s time range', 'finalization');
    }
    if (cleaned && !withinWindow(cleaned.value.cleaned_at, input.run_window)) {
      refuse('REPORT_INVALID', 'EVIDENCE_CLEANUP_OUT_OF_RUN_WINDOW', 'Cleanup document falls outside this run\'s time range', 'cleanup');
    }
  }

  // 5. Connect every expected request to the observation and raw bytes stored for it.
  const seenRequests = new Set<string>();
  const usedPaths = new Set<string>();
  const expectedOperations = new Set<string>();
  const observations: AuthenticatedObservation[] = [];
  const responses: AuthenticatedResponseBytes[] = [];
  const digests: Record<string, string> = {};
  const refsByRequest: Record<string, readonly string[]> = {};

  for (const request of input.requests) {
    const location = `request:${request?.request_id ?? 'unnamed'}`;
    if (seenRequests.has(request.request_id)) {
      refuse('REPORT_INVALID', 'EVIDENCE_REQUEST_IDENTITY_CONFLICT', 'The same request id is expected twice; one evidence item cannot prove two requests', location);
      continue;
    }
    seenRequests.add(request.request_id);
    if (request.run_id !== input.run_id) {
      refuse('POLICY_WEAKEN_ATTEMPT', 'EVIDENCE_REQUEST_RUN_MISMATCH', 'Expected request is scoped to another run', location,
        { request_run_id: request.run_id, run_id: input.run_id });
      continue;
    }
    expectedOperations.add(request.operation_key);

    const observationCleared = preflight('observation', request.observation_ref, {
      directory: DOCUMENTS_DIRECTORY, path: scopedDocumentPath('backend-observation', request.check_id, request.attempt_id),
      check_id: request.check_id, attempt_id: request.attempt_id,
    });
    const responseCleared = preflight('response', request.response_ref, {
      directory: ARTIFACTS_DIRECTORY, check_id: request.check_id, attempt_id: request.attempt_id,
    });
    if (!observationCleared || !responseCleared) continue;
    if (!responseCleared.entry.relative_path.startsWith(scopedArtifactPrefix(request.check_id, request.attempt_id))) {
      refuse('POLICY_WEAKEN_ATTEMPT', 'EVIDENCE_RESPONSE_PATH_UNSCOPED', 'Raw response bytes must sit in this run\'s own check/attempt artifact directory', location,
        { relative_path: responseCleared.entry.relative_path, expected_prefix: scopedArtifactPrefix(request.check_id, request.attempt_id) });
      continue;
    }
    const reused = [observationCleared, responseCleared].filter(cleared => usedPaths.has(cleared.entry.relative_path));
    if (reused.length) {
      refuse('REPORT_INVALID', 'EVIDENCE_REUSED_ACROSS_REQUESTS', 'One stored evidence item is cited by two expected requests', location,
        { relative_paths: reused.map(cleared => cleared.entry.relative_path) });
      continue;
    }
    for (const cleared of [observationCleared, responseCleared]) usedPaths.add(cleared.entry.relative_path);

    if (observationCleared.entry.media_type !== 'application/json' || observationCleared.entry.artifact_kind !== 'report') {
      refuse('REPORT_INVALID', 'EVIDENCE_DOCUMENT_KIND_MISMATCH', 'The backend observation must be a stored JSON report document', location,
        { media_type: observationCleared.entry.media_type, artifact_kind: observationCleared.entry.artifact_kind });
      continue;
    }
    if (responseCleared.entry.artifact_kind !== 'observation') {
      refuse('REPORT_INVALID', 'EVIDENCE_RESPONSE_KIND_MISMATCH', 'Raw response bytes must be stored as an observation artifact', location,
        { artifact_kind: responseCleared.entry.artifact_kind });
      continue;
    }
    if (responseCleared.entry.media_type !== request.media_type) {
      refuse('REPORT_INVALID', 'EVIDENCE_RESPONSE_MEDIA_TYPE_MISMATCH', 'Stored response artifact carries a different media type than the expected request', location,
        { indexed_media_type: responseCleared.entry.media_type, expected_media_type: request.media_type });
      continue;
    }
    if (responseCleared.entry.retention?.truncated) {
      refuse('ARTIFACT_BUDGET_EXCEEDED', 'EVIDENCE_RESPONSE_TRUNCATED', 'A truncated response artifact cannot authenticate a request', location,
        { retention: responseCleared.entry.retention });
      continue;
    }

    const observationRead = await readBack(observationCleared);
    if (!observationRead) continue;
    const observation = parseAs<BackendObservation>('backend-observation', observationCleared, observationRead.bytes);
    if (!observation) continue;
    const responseRead = await readBack(responseCleared);
    if (!responseRead) continue;

    const body = responseRead.bytes;
    const bodyDigest = hashBytes(body);
    const claimedDigest = boundaryDigest(observation.response_digest);
    const differences: string[] = [];
    const note = (field: string, expected: unknown, found: unknown): void => {
      if (expected !== found) differences.push(`${field}: expected ${String(expected)}, found ${String(found)}`);
    };
    note('run_id', input.run_id, observation.run_id);
    note('check_id', request.check_id, observation.check_id);
    note('attempt_id', request.attempt_id, observation.attempt_id);
    note('request_id', request.request_id, observation.request_id);
    note('instance_id', request.instance_id, observation.instance_id);
    note('operation_key', request.operation_key, observation.operation_key);
    note('status_code', request.status_code, observation.status_code);
    note('media_type', request.media_type, observation.media_type);
    note('response_digest', bodyDigest, claimedDigest);
    note('response_bytes', body.length, observation.response_bytes);
    note('observation_path', observationCleared.entry.relative_path, observation.observation_path);
    if (differences.length) {
      refuse('REPORT_INVALID', 'EVIDENCE_REQUEST_NOT_CONNECTED', 'The stored observation does not describe the expected request', location,
        { differences });
      continue;
    }
    const started = Date.parse(observation.started_at);
    const finished = Date.parse(observation.finished_at);
    if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) {
      refuse('REPORT_INVALID', 'EVIDENCE_OBSERVATION_TIMING_INVALID', 'Observation timing is unparsable or runs backwards', location,
        { started_at: observation.started_at, finished_at: observation.finished_at });
      continue;
    }
    if (input.run_window && (!withinWindow(observation.started_at, input.run_window) || !withinWindow(observation.finished_at, input.run_window))) {
      refuse('REPORT_INVALID', 'EVIDENCE_OBSERVATION_OUT_OF_RUN_WINDOW', 'Observation timing falls outside this run\'s time range', location);
      continue;
    }

    const artifact_ids: readonly string[] = [observationCleared.entry.artifact_id, responseCleared.entry.artifact_id];
    // The only references this request can ever cite: the artifact ids the index holds for it.
    observations.push({ observation, artifact_ids });
    responses.push({
      request_id: request.request_id, artifact_id: responseCleared.entry.artifact_id,
      relative_path: responseCleared.entry.relative_path, media_type: responseCleared.entry.media_type,
      digest: bodyDigest, bytes: body,
    });
    digests[request.request_id] = bodyDigest;
    refsByRequest[request.request_id] = artifact_ids;
  }

  // 6. Expectations come from the confirmed requirements, never from what an observation happened to report.
  for (const operation of input.requirements.required_operations) {
    if (!expectedOperations.has(operation)) {
      refuse('CONFIG_INVALID', 'EVIDENCE_REQUIRED_OPERATION_NOT_EXPECTED', 'A required operation has no expected request to authenticate', 'requirements.required_operations',
        { operation });
    }
  }
  if (input.requirements.requires_backend_observation && input.requests.length === 0) {
    refuse('CONFIG_INVALID', 'EVIDENCE_REQUESTS_MISSING', 'Backend observation is required but no expected request was supplied', 'requirements');
  }

  const missing = [
    prepared ? undefined : 'prepare', finalized ? undefined : 'finalization', cleaned ? undefined : 'cleanup',
  ].filter((name): name is string => name !== undefined);
  if (missing.length) {
    refuse('MISSING_REPORT', 'EVIDENCE_LIFECYCLE_DOCUMENT_INCOMPLETE', 'A lifecycle document could not be authenticated', missing.join(','), { missing });
  }

  if (diagnostics.length) return { ok: false, diagnostics };
  if (!prepared || !finalized || !cleaned) {
    // Unreachable while diagnostics stay empty; kept so no half-authenticated facts can ever escape.
    return { ok: false, diagnostics: [refusal('REPORT_INVALID', 'EVIDENCE_AUTHENTICATION_INCOMPLETE', 'Authentication produced neither facts nor a refusal')] };
  }

  return {
    ok: true,
    facts: {
      run_id: input.run_id,
      expected_input_hash: input.input_hash,
      requirements: input.requirements,
      run_window: input.run_window,
      prepare: prepared.value,
      finalization: finalized.value,
      cleanup: cleaned.value,
      observations,
      authenticated_refs: [
        prepared.artifact.artifact_id, finalized.artifact.artifact_id, cleaned.artifact.artifact_id,
        ...Object.values(refsByRequest).flat(),
      ],
      authenticated_digests: digests,
      prepare_ref: prepared.artifact.artifact_id,
      finalization_ref: finalized.artifact.artifact_id,
      cleanup_ref: cleaned.artifact.artifact_id,
      issued_by: AuthenticatedFactsIssuer.issue(),
      responses,
    },
  };
}
