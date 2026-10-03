import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Diagnostic, ReasonCode } from '../../../contracts/src/index.js';
import { inspectPathWithin } from '../../../core/src/storage/safe-path.js';
import { matchesPath, validatePathPattern } from '../../../core/src/domain/path-pattern.js';
import { parseStrictDocument } from '../../../core/src/services/strict-document.js';
import type { LiveListenerOwnership, LiveProcessIdentity } from './process-observation.js';

/**
 * Attach provenance: what has to be true before "a service the user already started" may be recorded as
 * `OBSERVED` rather than `DECLARED`.
 *
 * The rule this module implements is the audit's (§6 of `StackGate_V2_Audit_2791cf5.md`): an answer is not a
 * provenance. A start record is a file anyone can copy, and a 200 response says only that something answers.
 * `OBSERVED` is granted only when a set of facts that no single document can supply all agree — the record's
 * own bytes, the directory it was read from, the current confirmed input hash, the confirmed origin, and two
 * numbers the operating system gives about a process this run did not create: when it came into existence and
 * who owns the listening socket. Anything missing or unmatched leaves `DECLARED` plus a diagnostic; nothing here
 * ever upgrades a claim, and CONTROLLED is out of reach by construction (ADR-013 §3 caps core at OBSERVED).
 */

const PREFIX = 'SG-ENV-ATTACH-';
const SOURCE = 'attach-provenance';

/** Every refusal and risk note this module can emit; later tasks bind against these exact rule ids. */
export const ATTACH_REFUSAL_CODES = {
  CONFIGURATION_INVALID: `${PREFIX}CONFIGURATION-INVALID`,
  PROVENANCE_PATH_NOT_AUTHORIZED: `${PREFIX}PROVENANCE-PATH-NOT-AUTHORIZED`,
  RECORD_UNREADABLE: `${PREFIX}RECORD-UNREADABLE`,
  RECORD_OVER_BUDGET: `${PREFIX}RECORD-OVER-BUDGET`,
  RECORD_INVALID: `${PREFIX}RECORD-INVALID`,
  RECORD_TIMESTAMP_INCOHERENT: `${PREFIX}RECORD-TIMESTAMP-INCOHERENT`,
  RECORD_MOVED: `${PREFIX}RECORD-DIRECTORY-INCONSISTENT`,
  RECORD_SERVES_HEALTH_MISSING: `${PREFIX}RECORD-DOES-NOT-SERVE-HEALTH-PATH`,
  RECORD_PUBLIC_EVIDENCE_ROUTE: `${PREFIX}RECORD-PUBLIC-EVIDENCE-ROUTE`,
  INPUT_HASH_MISMATCH: `${PREFIX}INPUT-HASH-MISMATCH`,
  SOURCE_DIGEST_MISMATCH: `${PREFIX}SOURCE-DIGEST-MISMATCH`,
  SOURCE_DIGEST_UNRESOLVED: `${PREFIX}SOURCE-DIGEST-UNRESOLVED`,
  DATA_REVISION_UNCONFIRMED: `${PREFIX}DATA-REVISION-UNCONFIRMED`,
  DATA_REVISION_MISMATCH: `${PREFIX}DATA-REVISION-MISMATCH`,
  ORIGIN_NOT_CONFIRMED: `${PREFIX}ORIGIN-NOT-CONFIRMED`,
  ORIGIN_NOT_AUTHORIZED: `${PREFIX}ORIGIN-NOT-AUTHORIZED`,
  REQUEST_NOT_AUTHORIZED: `${PREFIX}REQUEST-NOT-AUTHORIZED`,
  HEALTH_NOT_ANSWERING: `${PREFIX}HEALTH-NOT-ANSWERING`,
  HEALTH_BUDGET_EXCEEDED: `${PREFIX}HEALTH-BUDGET-EXCEEDED`,
  PROCESS_IDENTITY_UNSUPPORTED: `${PREFIX}PROCESS-IDENTITY-UNSUPPORTED`,
  PROCESS_NOT_RUNNING: `${PREFIX}PROCESS-NOT-RUNNING`,
  CREATION_IDENTITY_MISMATCH: `${PREFIX}CREATION-IDENTITY-MISMATCH`,
  LISTENER_UNSUPPORTED: `${PREFIX}LISTENER-UNSUPPORTED`,
  LISTENER_OWNERSHIP_MISMATCH: `${PREFIX}LISTENER-OWNERSHIP-MISMATCH`,
  INSTANCE_MISSING: `${PREFIX}INSTANCE-UNATTESTED`,
  INSTANCE_CHANGED: `${PREFIX}INSTANCE-CHANGED`,
  SESSION_UNKNOWN: `${PREFIX}SESSION-UNKNOWN`,
  CLEANUP_CANCELED: `${PREFIX}CLEANUP-CANCELED`,
  OWNER_TOKEN_MISMATCH: `${PREFIX}OWNER-TOKEN-MISMATCH`,
  OWNERSHIP_REFUSED: `${PREFIX}OWNERSHIP-REFUSED`,
  FOREIGN_RESOURCE_UNSUPPORTED: `${PREFIX}FOREIGN-RESOURCE-UNSUPPORTED`,
  SERVICE_NOT_FOUND_AT_FINAL_CHECK: `${PREFIX}SERVICE-NOT-FOUND-AT-FINAL-CHECK`,
  EVIDENCE_UNWRITABLE: `${PREFIX}EVIDENCE-UNWRITABLE`,
} as const satisfies Record<string, `${typeof PREFIX}${string}`>;

export type AttachCode = typeof ATTACH_REFUSAL_CODES[keyof typeof ATTACH_REFUSAL_CODES];

/** The comparison the verdict is built from, named so a report can quote which fact moved. */
export const PROVENANCE_CHECKS = {
  RECORD_READABLE: 'record-readable',
  RECORD_SHAPE: 'record-shape',
  RECORD_TIMESTAMP_COHERENCE: 'record-timestamp-coherence',
  RECORD_DIRECTORY_CONSISTENCY: 'record-directory-consistency',
  RECORD_SERVES_HEALTH_PATH: 'record-serves-health-path',
  RECORD_NO_PUBLIC_EVIDENCE_ROUTE: 'record-no-public-evidence-route',
  INPUT_HASH_CONFIRMED: 'input-hash-confirmed',
  SOURCE_DIGESTS_RECOMPUTED: 'source-digests-recomputed',
  DATA_REVISION_CONFIRMED: 'data-revision-confirmed',
  CONFIRMED_ORIGIN: 'confirmed-origin',
  PROCESS_RUNNING: 'process-running',
  CREATION_IDENTITY_LIVE: 'creation-identity-live',
  LISTENER_OWNERSHIP: 'listener-ownership',
  HEALTH_ANSWERED: 'health-answered',
} as const;

/**
 * The checks that must all be `MATCH` for provenance to be `OBSERVED`. `SOURCE_DIGESTS_RECOMPUTED` is excluded
 * because a service on another machine legitimately has no re-hashable source here: a mismatch still refuses,
 * an unavailable source is recorded as an open fact instead of silently granting or withholding.
 */
const ENABLING: readonly string[] = Object.values(PROVENANCE_CHECKS).filter(name => name !== PROVENANCE_CHECKS.SOURCE_DIGESTS_RECOMPUTED);

/** Refusals the environment verdict treats as provenance shortfalls rather than configuration noise. */
const PROVENANCE_CODES: ReadonlySet<AttachCode> = new Set<AttachCode>([
  ATTACH_REFUSAL_CODES.RECORD_UNREADABLE, ATTACH_REFUSAL_CODES.RECORD_INVALID, ATTACH_REFUSAL_CODES.RECORD_MOVED,
  ATTACH_REFUSAL_CODES.RECORD_TIMESTAMP_INCOHERENT, ATTACH_REFUSAL_CODES.RECORD_SERVES_HEALTH_MISSING,
  ATTACH_REFUSAL_CODES.RECORD_PUBLIC_EVIDENCE_ROUTE, ATTACH_REFUSAL_CODES.INPUT_HASH_MISMATCH,
  ATTACH_REFUSAL_CODES.SOURCE_DIGEST_MISMATCH, ATTACH_REFUSAL_CODES.DATA_REVISION_UNCONFIRMED,
  ATTACH_REFUSAL_CODES.DATA_REVISION_MISMATCH, ATTACH_REFUSAL_CODES.ORIGIN_NOT_CONFIRMED,
  ATTACH_REFUSAL_CODES.HEALTH_NOT_ANSWERING, ATTACH_REFUSAL_CODES.PROCESS_NOT_RUNNING,
  ATTACH_REFUSAL_CODES.CREATION_IDENTITY_MISMATCH, ATTACH_REFUSAL_CODES.LISTENER_OWNERSHIP_MISMATCH,
  ATTACH_REFUSAL_CODES.INSTANCE_MISSING, ATTACH_REFUSAL_CODES.INSTANCE_CHANGED,
]);

export interface AttachStartRecord {
  schema_version: unknown;
  kind: 'stackgate-test-api-launch';
  phase: 'started';
  pid: number;
  process_creation: { status: string; mechanism: string | null; creation_identity: string | null; created_at: string | null; clock: string | null };
  instance_id: string;
  data_revision: string;
  input_hash: string;
  allowed_run_ids: string[];
  host: string;
  port: number;
  origin: string;
  state_directory: string;
  observation_directory: string;
  served_routes: string[];
  evidence_routes: string[];
  source_digests: Record<string, string>;
  started_at: string;
  max_recorded_bytes: number;
}

export type RecordParse = { ok: true; value: AttachStartRecord } | { ok: false; reason: string };

/**
 * Strict read of the launcher's start record. A copy of a valid record parses just as validly, which is exactly
 * why this is only one of the checks and never a sufficient one.
 */
export function parseStartRecord(raw: unknown): RecordParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'RECORD_IS_NOT_A_MAPPING' };
  const value = raw as Record<string, unknown>;
  if (value.schema_version !== '0.1') return { ok: false, reason: 'RECORD_SCHEMA_VERSION_UNEXPECTED' };
  if (value.kind !== 'stackgate-test-api-launch') return { ok: false, reason: 'RECORD_KIND_UNEXPECTED' };
  if (value.phase !== 'started') return { ok: false, reason: 'RECORD_PHASE_UNEXPECTED' };
  if (!Number.isSafeInteger(value.pid) || (value.pid as number) < 1) return { ok: false, reason: 'RECORD_PID_INVALID' };
  if (typeof value.instance_id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value.instance_id)) return { ok: false, reason: 'RECORD_INSTANCE_ID_INVALID' };
  if (typeof value.data_revision !== 'string' || value.data_revision.length === 0 || /[\u0000-\u001f\u007f]/.test(value.data_revision)) return { ok: false, reason: 'RECORD_DATA_REVISION_INVALID' };
  if (typeof value.input_hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.input_hash)) return { ok: false, reason: 'RECORD_INPUT_HASH_INVALID' };
  if (!Array.isArray(value.allowed_run_ids) || !value.allowed_run_ids.every(entry => typeof entry === 'string')) return { ok: false, reason: 'RECORD_ALLOWED_RUNS_INVALID' };
  if (value.host !== '127.0.0.1') return { ok: false, reason: 'RECORD_HOST_NOT_LOOPBACK' };
  if (!Number.isSafeInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65535) return { ok: false, reason: 'RECORD_PORT_INVALID' };
  if (typeof value.origin !== 'string' || value.origin !== `http://127.0.0.1:${String(value.port)}`) return { ok: false, reason: 'RECORD_ORIGIN_NOT_LOOPBACK_LITERAL' };
  if (typeof value.state_directory !== 'string' || value.state_directory.length === 0) return { ok: false, reason: 'RECORD_STATE_DIRECTORY_MISSING' };
  if (typeof value.observation_directory !== 'string' || value.observation_directory.length === 0) return { ok: false, reason: 'RECORD_OBSERVATION_DIRECTORY_MISSING' };
  const creation = value.process_creation;
  if (typeof creation !== 'object' || creation === null || Array.isArray(creation)) return { ok: false, reason: 'RECORD_PROCESS_CREATION_MISSING' };
  const fields = creation as Record<string, unknown>;
  if (typeof fields.status !== 'string') return { ok: false, reason: 'RECORD_PROCESS_CREATION_STATUS_MISSING' };
  if (fields.status === 'observed' && (typeof fields.creation_identity !== 'string' || !/^\d+$/.test(fields.creation_identity))) {
    return { ok: false, reason: 'RECORD_PROCESS_CREATION_IDENTITY_INVALID' };
  }
  if (fields.status === 'observed' && typeof fields.created_at !== 'string') return { ok: false, reason: 'RECORD_PROCESS_CREATION_TIME_MISSING' };
  if (!Array.isArray(value.served_routes) || !value.served_routes.every(entry => typeof entry === 'string')) return { ok: false, reason: 'RECORD_SERVED_ROUTES_INVALID' };
  if (!Array.isArray(value.evidence_routes)) return { ok: false, reason: 'RECORD_EVIDENCE_ROUTES_INVALID' };
  if (typeof value.source_digests !== 'object' || value.source_digests === null ||
      !Object.values(value.source_digests as Record<string, unknown>).every(entry => typeof entry === 'string' && /^[a-f0-9]{64}$/.test(entry))) {
    return { ok: false, reason: 'RECORD_SOURCE_DIGESTS_INVALID' };
  }
  if (typeof value.started_at !== 'string' || !/Z$/.test(value.started_at) || Number.isNaN(Date.parse(value.started_at))) return { ok: false, reason: 'RECORD_STARTED_AT_INVALID' };
  if (!Number.isSafeInteger(value.max_recorded_bytes) || (value.max_recorded_bytes as number) < 1) return { ok: false, reason: 'RECORD_MAX_BYTES_INVALID' };
  return {
    ok: true,
    value: {
      schema_version: value.schema_version, kind: value.kind, phase: value.phase, pid: value.pid as number,
      process_creation: {
        status: fields.status as string,
        mechanism: typeof fields.mechanism === 'string' ? fields.mechanism : null,
        creation_identity: typeof fields.creation_identity === 'string' ? fields.creation_identity : null,
        created_at: typeof fields.created_at === 'string' ? fields.created_at : null,
        clock: typeof fields.clock === 'string' ? fields.clock : null,
      },
      instance_id: value.instance_id, data_revision: value.data_revision, input_hash: value.input_hash,
      allowed_run_ids: value.allowed_run_ids as string[], host: value.host, port: value.port as number, origin: value.origin,
      state_directory: value.state_directory, observation_directory: value.observation_directory,
      served_routes: value.served_routes as string[], evidence_routes: value.evidence_routes as string[],
      source_digests: value.source_digests as Record<string, string>, started_at: value.started_at,
      max_recorded_bytes: value.max_recorded_bytes as number,
    },
  };
}

/** The record file and everything the reader could confirm about the bytes and the directory it came from. */
export interface AttachRecordEvidence {
  relative_path: string;
  resolved_path: string | null;
  readable: boolean;
  /** A copy of a record keeps the original's digest; that is why the digest is recorded and never trusted alone. */
  digest: string | null;
  size: number | null;
  read_reason: string | null;
  /** The directory the file was really read from, and whether the record names that same one. */
  containing_directory: string | null;
  observation_root_exists: boolean;
  /** Re-hashed source files, keyed exactly as the record names them. */
  sources: { key: string; expected_digest: string; resolved_path: string | null; actual_digest: string | null }[];
  record: AttachStartRecord | null;
  invalid_reason: string | null;
}

const RECORD_READ_BUDGET = 1024 * 1024;

/**
 * Read the declared provenance file from inside the repository root only, then re-hash the source files the
 * record claims the running process loaded. Containment comes first: a path the policy never authorised is
 * refused before any file is opened, and no symbolic link is followed.
 */
export async function collectAttachRecordEvidence(input: {
  repo_root: string; provenance_relative_path: string; health_path: string; candidate_source_roots: readonly string[];
  /** The effective policy's declared path patterns; an unmatched path is never read. */
  authorized_patterns: readonly string[];
}): Promise<AttachRecordEvidence> {
  const evidence: AttachRecordEvidence = {
    relative_path: input.provenance_relative_path, resolved_path: null, readable: false, digest: null, size: null,
    read_reason: null, containing_directory: null, observation_root_exists: false, sources: [], record: null, invalid_reason: null,
  };
  const authorized = input.authorized_patterns.some(pattern => {
    try {
      return validatePathPattern(pattern), matchesPath(pattern, input.provenance_relative_path);
    } catch {
      // An unreadable pattern authorises nothing; it is never treated as a wildcard.
      return false;
    }
  });
  if (!authorized) {
    evidence.read_reason = 'PROVENANCE_PATH_NOT_AUTHORIZED_BY_POLICY';
    return evidence;
  }
  let inspected: { path: string; links: unknown[] };
  try {
    inspected = await inspectPathWithin(input.repo_root, input.provenance_relative_path);
  } catch (error) {
    evidence.read_reason = error instanceof Error ? error.message.slice(0, 200) : 'RECORD_PATH_UNRESOLVABLE';
    return evidence;
  }
  if (inspected.links.length > 0) {
    evidence.read_reason = 'RECORD_PATH_CONTAINS_SYMLINK';
    return evidence;
  }
  try {
    const stat = await fs.lstat(inspected.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      evidence.read_reason = 'RECORD_IS_NOT_A_SINGLE_REGULAR_FILE';
      return evidence;
    }
    if (stat.size > RECORD_READ_BUDGET) {
      evidence.read_reason = 'RECORD_OVER_BUDGET';
      return evidence;
    }
    const bytes = await fs.readFile(inspected.path);
    evidence.readable = true;
    evidence.resolved_path = inspected.path;
    evidence.size = bytes.length;
    evidence.digest = createHash('sha256').update(bytes).digest('hex');
    evidence.containing_directory = await fs.realpath(path.dirname(inspected.path));
    const parsed = parseStrictDocument(bytes, 'attach-start-record', { maxBytes: RECORD_READ_BUDGET, maxDepth: 32 });
    const record = parseStartRecord(parsed);
    if (!record.ok) {
      evidence.invalid_reason = record.reason;
      return evidence;
    }
    evidence.record = record.value;
    const observationsRoot = path.join(evidence.containing_directory, record.value.observation_directory);
    try {
      evidence.observation_root_exists = (await fs.lstat(observationsRoot)).isDirectory();
    } catch {
      evidence.observation_root_exists = false;
    }
    for (const key of Object.keys(record.value.source_digests).sort()) {
      const matches: string[] = [];
      for (const root of input.candidate_source_roots) {
        const candidate = path.resolve(root, key);
        try {
          if ((await fs.lstat(candidate)).isFile()) matches.push(candidate);
        } catch {
          /* a root that does not carry this path simply does not resolve it */
        }
      }
      const unique = [...new Set(matches)];
      // One and only one root may hold the path; an ambiguous match is not resolved by picking the first.
      const resolved = unique.length === 1 ? unique[0]! : null;
      let actual: string | null = null;
      if (resolved !== null) {
        try {
          actual = createHash('sha256').update(await fs.readFile(resolved)).digest('hex');
        } catch {
          actual = null;
        }
      }
      evidence.sources.push({ key, expected_digest: record.value.source_digests[key]!, resolved_path: resolved, actual_digest: actual });
    }
  } catch (error) {
    evidence.read_reason = error instanceof Error ? error.message.slice(0, 200) : 'RECORD_COULD_NOT_BE_READ';
  }
  return evidence;
}

export interface AttachExpectations {
  run_id: string;
  environment_id: string;
  /** The candidate input this run was created with; the record must name this one, not a previous build. */
  expected_input_hash: string;
  /** The origin the confirmed configuration binds this environment to, already normalised. */
  expected_origin: string;
  health_path: string;
  /** Null when the run never confirmed a data revision: an attach cannot invent one and still claim OBSERVED. */
  expected_data_revision: string | null;
  /** Instance this run already bound, when a previous observation named one (continuity, not self-report). */
  expected_instance_id: string | null;
}

export interface HealthProbeFacts {
  requested: boolean;
  refusal: string | null;
  status_code: number | null;
  media_type: string | null;
  response_bytes: number | null;
  body_digest: string | null;
  observed_at: string;
}

export type CheckResult = 'MATCH' | 'MISMATCH' | 'UNAVAILABLE';
export interface ProvenanceCheck { name: string; result: CheckResult; detail: string }

export interface AttachVerdict {
  level: 'DECLARED' | 'OBSERVED';
  checks: ProvenanceCheck[];
  diagnostics: Diagnostic[];
  instance_id: string | null;
  data_revision: string | null;
  /** The origin that was actually used for the probe and recorded, never a re-derived guess. */
  bound_origin: string | null;
  pid: number | null;
  creation_identity: string | null;
  created_at: string | null;
  listener: LiveListenerOwnership | null;
}

/**
 * Compare the collected facts against the confirmed expectations. Pure: no file system, socket or process
 * access, so the same inputs always produce the same level and the same diagnostics.
 */
export function verifyAttachProvenance(input: {
  evidence: AttachRecordEvidence;
  expectations: AttachExpectations;
  identity: LiveProcessIdentity;
  listener: LiveListenerOwnership;
  health: HealthProbeFacts | null;
}): AttachVerdict {
  const checks: ProvenanceCheck[] = [];
  const diagnostics: Diagnostic[] = [];
  const record = input.evidence.record;

  const add = (name: string, result: CheckResult, detail: string): void => { checks.push({ name, result, detail }); };
  const refuse = (rule: AttachCode, message: string, location: string, observed: Record<string, unknown>): void => {
    diagnostics.push(refusal(rule, message, location, observed));
  };

  if (input.evidence.readable) add(PROVENANCE_CHECKS.RECORD_READABLE, 'MATCH', `read ${String(input.evidence.size)} bytes with digest ${String(input.evidence.digest).slice(0, 16)}`);
  else {
    add(PROVENANCE_CHECKS.RECORD_READABLE, 'MISMATCH', input.evidence.read_reason ?? 'RECORD_UNREADABLE');
    refuse(ATTACH_REFUSAL_CODES.RECORD_UNREADABLE, 'The declared start record could not be read, so nothing independent of the configuration backs this attach.', `/${input.evidence.relative_path}`, { reason: input.evidence.read_reason ?? 'UNREADABLE' });
  }

  if (record === null) add(PROVENANCE_CHECKS.RECORD_SHAPE, input.evidence.readable ? 'MISMATCH' : 'UNAVAILABLE', input.evidence.invalid_reason ?? 'RECORD_NOT_PARSED');
  else add(PROVENANCE_CHECKS.RECORD_SHAPE, 'MATCH', `kind ${record.kind}, pid ${String(record.pid)}, instance ${record.instance_id}`);

  // The record's own two numbers about one process must agree with each other before either is compared to the OS.
  if (record?.process_creation.created_at !== undefined && record !== null) {
    const claimed = Date.parse(record.process_creation.created_at ?? '');
    const fromIdentity = record.process_creation.creation_identity !== null
      ? Number(BigInt(record.process_creation.creation_identity) / 10_000n) - 11644473600000
      : Number.NaN;
    if (Number.isNaN(claimed) || Number.isNaN(fromIdentity) || Math.abs(claimed - fromIdentity) > 2_000) {
      add(PROVENANCE_CHECKS.RECORD_TIMESTAMP_COHERENCE, 'MISMATCH', `created_at ${String(record.process_creation.created_at)} versus identity ${String(record.process_creation.creation_identity)}`);
      refuse(ATTACH_REFUSAL_CODES.RECORD_TIMESTAMP_INCOHERENT, 'The start record contradicts itself about when its process existed, so neither of its numbers can be trusted.', '/process_creation/created_at', { created_at: record.process_creation.created_at, creation_identity: record.process_creation.creation_identity });
    } else add(PROVENANCE_CHECKS.RECORD_TIMESTAMP_COHERENCE, 'MATCH', 'recorded creation time and recorded creation identity agree');
  } else {
    add(PROVENANCE_CHECKS.RECORD_TIMESTAMP_COHERENCE, record === null ? 'UNAVAILABLE' : 'MISMATCH', 'no creation facts in the record');
  }

  // A record copied out of another state directory is the failure this guard exists for.
  if (record !== null && input.evidence.containing_directory !== null) {
    const declared = normaliseDirectory(record.state_directory);
    const actual = normaliseDirectory(input.evidence.containing_directory);
    const inside = declared === actual || actual.startsWith(`${declared}/`) || declared.startsWith(`${actual}/`);
    if (inside && input.evidence.observation_root_exists) add(PROVENANCE_CHECKS.RECORD_DIRECTORY_CONSISTENCY, 'MATCH', `read from ${input.evidence.containing_directory}`);
    else if (inside) {
      add(PROVENANCE_CHECKS.RECORD_DIRECTORY_CONSISTENCY, 'MISMATCH', 'the record names this directory but its observation root is not there');
      refuse(ATTACH_REFUSAL_CODES.RECORD_MOVED, 'The start record points at a state directory whose observation root does not exist here, so it is not the record this process committed.', '/state_directory', { state_directory: record.state_directory, read_from: input.evidence.containing_directory });
    } else {
      add(PROVENANCE_CHECKS.RECORD_DIRECTORY_CONSISTENCY, 'MISMATCH', `record says ${record.state_directory}, file was read from ${input.evidence.containing_directory}`);
      refuse(ATTACH_REFUSAL_CODES.RECORD_MOVED, 'The start record was read from a directory other than the one it says it belongs to: a copied or stale provenance file, not this instance.', '/state_directory', { state_directory: record.state_directory, read_from: input.evidence.containing_directory });
    }
  } else add(PROVENANCE_CHECKS.RECORD_DIRECTORY_CONSISTENCY, record === null ? 'UNAVAILABLE' : 'MISMATCH', 'the directory the record came from could not be established');

  if (record !== null) {
    if (record.served_routes.includes(input.expectations.health_path)) add(PROVENANCE_CHECKS.RECORD_SERVES_HEALTH_PATH, 'MATCH', `the record's own route table serves ${input.expectations.health_path}`);
    else {
      add(PROVENANCE_CHECKS.RECORD_SERVES_HEALTH_PATH, 'MISMATCH', `${input.expectations.health_path} is not in the route table the record reports`);
      refuse(ATTACH_REFUSAL_CODES.RECORD_SERVES_HEALTH_MISSING, 'The start record does not list the health path among the routes this process serves, so the answer cannot be attributed to it.', '/served_routes', { health_path: input.expectations.health_path });
    }
    if (record.evidence_routes.length === 0) add(PROVENANCE_CHECKS.RECORD_NO_PUBLIC_EVIDENCE_ROUTE, 'MATCH', 'no route serves the evidence tree back');
    else {
      add(PROVENANCE_CHECKS.RECORD_NO_PUBLIC_EVIDENCE_ROUTE, 'MISMATCH', `routes ${record.evidence_routes.join(', ')}`);
      refuse(ATTACH_REFUSAL_CODES.RECORD_PUBLIC_EVIDENCE_ROUTE, 'The service exposes a route that reads evidence back, so a recorded fact could be re-served rather than observed.', '/evidence_routes', { evidence_routes: record.evidence_routes });
    }
  } else add(PROVENANCE_CHECKS.RECORD_SERVES_HEALTH_PATH, 'UNAVAILABLE', 'no record');

  if (record !== null && record.input_hash === input.expectations.expected_input_hash) {
    add(PROVENANCE_CHECKS.INPUT_HASH_CONFIRMED, 'MATCH', record.input_hash.slice(0, 16));
  } else {
    add(PROVENANCE_CHECKS.INPUT_HASH_CONFIRMED, record === null ? 'UNAVAILABLE' : 'MISMATCH', record === null ? 'no record' : `record ${record.input_hash.slice(0, 16)} versus confirmed ${input.expectations.expected_input_hash.slice(0, 16)}`);
    if (record !== null) refuse(ATTACH_REFUSAL_CODES.INPUT_HASH_MISMATCH, 'The attached service was started for a different candidate input, so its answer describes another build.', '/input_hash', { record_input_hash: record.input_hash, expected_input_hash: input.expectations.expected_input_hash });
  }

  const unresolved: string[] = [];
  const mismatched: string[] = [];
  for (const source of input.evidence.sources) {
    if (source.actual_digest === null) unresolved.push(source.key);
    else if (source.actual_digest !== source.expected_digest) mismatched.push(source.key);
  }
  if (input.evidence.sources.length === 0) add(PROVENANCE_CHECKS.SOURCE_DIGESTS_RECOMPUTED, 'UNAVAILABLE', 'the record names no source files, or none resolved here');
  else if (mismatched.length > 0) {
    add(PROVENANCE_CHECKS.SOURCE_DIGESTS_RECOMPUTED, 'MISMATCH', `${String(mismatched.length)} of ${String(input.evidence.sources.length)} source files differ: ${mismatched.join(', ')}`);
    refuse(ATTACH_REFUSAL_CODES.SOURCE_DIGEST_MISMATCH, 'The bytes on disk no longer match what the record says the running process loaded, so the record describes an older input.', '/source_digests', { mismatched });
  } else if (unresolved.length > 0) {
    add(PROVENANCE_CHECKS.SOURCE_DIGESTS_RECOMPUTED, 'UNAVAILABLE', `${String(unresolved.length)} of ${String(input.evidence.sources.length)} source files could not be re-hashed here: ${unresolved.join(', ')}`);
    diagnostics.push(refusal(ATTACH_REFUSAL_CODES.SOURCE_DIGEST_UNRESOLVED, 'Some source files named by the record cannot be re-hashed from this host, so input binding rests on the confirmed input hash alone.', '/source_digests', { unresolved }, 'UNSUPPORTED_CAPABILITY'));
  } else add(PROVENANCE_CHECKS.SOURCE_DIGESTS_RECOMPUTED, 'MATCH', `${String(input.evidence.sources.length)} source files re-hashed and equal`);

  if (input.expectations.expected_data_revision === null) {
    add(PROVENANCE_CHECKS.DATA_REVISION_CONFIRMED, 'UNAVAILABLE', 'this run never confirmed a data revision');
    refuse(ATTACH_REFUSAL_CODES.DATA_REVISION_UNCONFIRMED, 'Without a data revision confirmed before the run was created, an attach cannot state which dataset the service holds (ADR-012 §4).', '/expected_data_revision', {});
  } else if (record !== null && record.data_revision === input.expectations.expected_data_revision) {
    add(PROVENANCE_CHECKS.DATA_REVISION_CONFIRMED, 'MATCH', record.data_revision);
  } else {
    add(PROVENANCE_CHECKS.DATA_REVISION_CONFIRMED, record === null ? 'UNAVAILABLE' : 'MISMATCH', record === null ? 'no record' : `record ${record.data_revision} versus confirmed ${input.expectations.expected_data_revision}`);
    if (record !== null) refuse(ATTACH_REFUSAL_CODES.DATA_REVISION_MISMATCH, 'The attached service reports a different data revision than the one this run confirmed.', '/data_revision', { record: record.data_revision, expected: input.expectations.expected_data_revision });
  }

  if (record !== null && record.origin === input.expectations.expected_origin) {
    add(PROVENANCE_CHECKS.CONFIRMED_ORIGIN, 'MATCH', record.origin);
  } else {
    add(PROVENANCE_CHECKS.CONFIRMED_ORIGIN, record === null ? 'UNAVAILABLE' : 'MISMATCH', record === null ? 'no record' : `record ${record.origin} versus bound ${input.expectations.expected_origin}`);
    if (record !== null) refuse(ATTACH_REFUSAL_CODES.ORIGIN_NOT_CONFIRMED, 'The record belongs to a service bound to a different origin: this is another instance, not the one this run was told to attach to.', '/origin', { record_origin: record.origin, bound_origin: input.expectations.expected_origin });
  }

  // Live process facts. A platform that cannot answer yields UNAVAILABLE, and UNAVAILABLE never becomes OBSERVED.
  if (input.identity.status === 'OBSERVED') add(PROVENANCE_CHECKS.PROCESS_RUNNING, 'MATCH', `pid ${String(input.identity.pid)} exists with an OS-reported creation identity`);
  else if (input.identity.status === 'NOT_FOUND') {
    add(PROVENANCE_CHECKS.PROCESS_RUNNING, 'MISMATCH', 'the operating system has no such process');
    refuse(ATTACH_REFUSAL_CODES.PROCESS_NOT_RUNNING, 'The process the start record names is not running, so the record is stale or copied.', '/pid', { pid: record?.pid ?? null });
  } else {
    add(PROVENANCE_CHECKS.PROCESS_RUNNING, 'UNAVAILABLE', input.identity.detail ?? `status ${input.identity.status}`);
    if (record !== null) diagnostics.push(refusal(ATTACH_REFUSAL_CODES.PROCESS_IDENTITY_UNSUPPORTED, `This platform cannot supply an independent creation identity (${input.identity.mechanism || 'no mechanism'}), so provenance stays DECLARED.`, '/process_creation', { status: input.identity.status, detail: input.identity.detail }, 'UNSUPPORTED_CAPABILITY'));
  }

  if (record !== null && input.identity.status === 'OBSERVED' && record.process_creation.status === 'observed') {
    if (record.process_creation.creation_identity === input.identity.creation_identity && record.pid === input.identity.pid) {
      add(PROVENANCE_CHECKS.CREATION_IDENTITY_LIVE, 'MATCH', `live FILETIME ${String(input.identity.creation_identity)} equals the recorded one`);
    } else {
      add(PROVENANCE_CHECKS.CREATION_IDENTITY_LIVE, 'MISMATCH', `record ${String(record.process_creation.creation_identity)} versus live ${String(input.identity.creation_identity)} for pid ${String(record.pid)}/${String(input.identity.pid)}`);
      refuse(ATTACH_REFUSAL_CODES.CREATION_IDENTITY_MISMATCH, 'The operating system reports a different creation identity than the record claims for that pid, so the record was forged or the pid has been reused.', '/process_creation/creation_identity', {
        record_pid: record.pid, live_pid: input.identity.pid, recorded_identity: record.process_creation.creation_identity, live_identity: input.identity.creation_identity,
      });
    }
  } else if (record !== null) add(PROVENANCE_CHECKS.CREATION_IDENTITY_LIVE, 'UNAVAILABLE', record.process_creation.status === 'observed' ? 'no live identity from this platform' : `the record itself says ${record.process_creation.status}`);
  else add(PROVENANCE_CHECKS.CREATION_IDENTITY_LIVE, 'UNAVAILABLE', 'no record');

  if (record !== null) {
    if (input.listener.status === 'OBSERVED') {
      if (input.listener.pid === record.pid) add(PROVENANCE_CHECKS.LISTENER_OWNERSHIP, 'MATCH', `pid ${String(input.listener.pid)} owns ${input.listener.addresses.join(', ')}`);
      else {
        add(PROVENANCE_CHECKS.LISTENER_OWNERSHIP, 'MISMATCH', `the bound port is owned by pid ${String(input.listener.pid)}, the record names pid ${String(record.pid)}`);
        refuse(ATTACH_REFUSAL_CODES.LISTENER_OWNERSHIP_MISMATCH, 'Some other process owns the port the record binds, so the answer on that origin did not come from the process the record describes.', '/port', {
          record_pid: record.pid, listening_pid: input.listener.pid, port: record.port, addresses: input.listener.addresses,
        });
      }
    } else if (input.listener.status === 'NOT_FOUND') {
      add(PROVENANCE_CHECKS.LISTENER_OWNERSHIP, 'MISMATCH', 'nothing is listening on the port the record names');
      refuse(ATTACH_REFUSAL_CODES.LISTENER_OWNERSHIP_MISMATCH, 'The port in the start record has no listening owner, so the record does not describe a service that is up.', '/port', { port: record.port });
    } else {
      add(PROVENANCE_CHECKS.LISTENER_OWNERSHIP, 'UNAVAILABLE', input.listener.detail ?? `status ${input.listener.status}`);
      diagnostics.push(refusal(ATTACH_REFUSAL_CODES.LISTENER_UNSUPPORTED, `This platform cannot report which process owns the listening socket (${input.listener.mechanism || 'no mechanism'}), so provenance stays DECLARED.`, '/port', { status: input.listener.status, detail: input.listener.detail }, 'UNSUPPORTED_CAPABILITY'));
    }
  } else add(PROVENANCE_CHECKS.LISTENER_OWNERSHIP, 'UNAVAILABLE', 'no record');

  if (input.health !== null && input.health.requested && input.health.status_code !== null && input.health.status_code >= 200 && input.health.status_code < 300 &&
      (input.health.media_type ?? '').startsWith('application/json')) {
    add(PROVENANCE_CHECKS.HEALTH_ANSWERED, 'MATCH', `status ${String(input.health.status_code)}, body digest ${String(input.health.body_digest).slice(0, 16)}`);
  } else {
    add(PROVENANCE_CHECKS.HEALTH_ANSWERED, input.health === null ? 'UNAVAILABLE' : 'MISMATCH', input.health === null ? 'no probe was made' : (input.health.refusal ?? `status ${String(input.health.status_code)}`));
    if (input.health !== null && input.health.requested) refuse(ATTACH_REFUSAL_CODES.HEALTH_NOT_ANSWERING, 'The bound origin did not answer the confirmed health operation, so the environment is not usable whatever the record says.', '/health', { refusal: input.health.refusal, status_code: input.health.status_code });
  }

  if (record !== null && input.expectations.expected_instance_id !== null && record.instance_id !== input.expectations.expected_instance_id) {
    refuse(ATTACH_REFUSAL_CODES.INSTANCE_CHANGED, 'The service behind this attach now reports a different instance than the one this run bound, so the environment changed underneath the run.', '/instance_id', {
      bound_instance: input.expectations.expected_instance_id, record_instance: record.instance_id,
    });
  }

  const enabled = ENABLING.every(name => (checks.find(check => check.name === name)?.result ?? 'UNAVAILABLE') === 'MATCH');
  const level: AttachVerdict['level'] = enabled ? 'OBSERVED' : 'DECLARED';
  if (level === 'DECLARED' && record !== null && !diagnostics.some(diagnostic => diagnostic.rule_id === ATTACH_REFUSAL_CODES.INSTANCE_MISSING)) {
    // Say plainly that a valid-looking record still is not provenance, whenever the shortfall is only "no live proof".
    if (!diagnostics.length) diagnostics.push(refusal(ATTACH_REFUSAL_CODES.INSTANCE_MISSING, 'Provenance could not be raised above DECLARED from the evidence actually obtained; the reasons are recorded alongside this verdict.', '/provenance', {
      checks: checks.map(check => ({ name: check.name, result: check.result })),
    }));
  }

  return {
    level,
    checks,
    diagnostics,
    instance_id: level === 'OBSERVED' && record !== null ? record.instance_id : null,
    data_revision: level === 'OBSERVED' && record !== null ? record.data_revision : null,
    bound_origin: input.health?.requested === true && record !== null ? record.origin : (record?.origin ?? null),
    pid: record?.pid ?? null,
    creation_identity: input.identity.status === 'OBSERVED' ? input.identity.creation_identity : null,
    created_at: input.identity.status === 'OBSERVED' ? input.identity.created_at : null,
    listener: input.listener,
  };
}

/** Directory comparison that survives Windows separators and case, without resolving anything on disk. */
export function normaliseDirectory(value: string): string {
  const forward = path.resolve(value).split(path.sep).join('/').replace(/\/+$/u, '');
  return process.platform === 'win32' ? forward.toLowerCase() : forward;
}

export function refusal(rule: AttachCode, message: string, location: string, observed_facts: Record<string, unknown>, code: ReasonCode = PROVENANCE_CODES.has(rule) ? 'ENV_PROVENANCE_INSUFFICIENT' : 'POLICY_WEAKEN_ATTEMPT'): Diagnostic {
  return {
    code: rule === ATTACH_REFUSAL_CODES.OWNERSHIP_REFUSED || rule === ATTACH_REFUSAL_CODES.SERVICE_NOT_FOUND_AT_FINAL_CHECK || rule === ATTACH_REFUSAL_CODES.OWNER_TOKEN_MISMATCH || rule === ATTACH_REFUSAL_CODES.SESSION_UNKNOWN || rule === ATTACH_REFUSAL_CODES.FOREIGN_RESOURCE_UNSUPPORTED ? 'RESOURCE_OWNERSHIP_UNVERIFIED' : code,
    rule_id: rule,
    message,
    location,
    observed_facts,
    recommended_action: 'Leave the user service running and attach again with independent start and process evidence; DECLARED is never upgraded by re-reading the same file.',
    source: SOURCE,
  };
}
