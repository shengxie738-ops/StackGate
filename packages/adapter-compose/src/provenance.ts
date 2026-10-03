import fs from 'node:fs/promises';
import path from 'node:path';
import type { EnvironmentManifest } from '../../contracts/src/index.js';
import { redactText } from '../../core/src/evidence/redaction.js';
import { hashBytes } from '../../core/src/storage/hash.js';
import type { ComposeCommandPort, ComposeCommandRequest } from './start.js';

/**
 * Provenance boundary for SG-058.
 *
 * Two questions are answered separately here and must never be conflated:
 *   - what this run *declared* (the compose document bytes it pinned, the references it asked for); and
 *   - what this run *observed* (the versions the CLI reported, the ids the daemon returned, the process
 *     identity the owned-process runner attested for the command that created each object).
 *
 * The provenance ceiling is computed from those facts. A locally started Compose environment is never
 * `CONTROLLED`: CONTROLLED needs a trusted execution context this host cannot attest, and setting `CI=true`
 * in the environment of the very command that started it does not change that. The cap is applied before
 * anything is created, so a run that could not be certified does not first create resources.
 */

/**
 * Environment names the docker CLI may see. Values come from this process and nothing else is forwarded:
 * no credential, no proxy setting and no user variable reaches the CLI by accident.
 *
 * `PROGRAMFILES` is not decoration. Measured on this host (`win32-x64`, Docker Desktop, docker.exe under
 * `resources\bin`): with a filtered environment that omits it, `docker compose` never loads its plugin and
 * the CLI exits 125 with `unknown flag: --short`, while `docker version` still succeeds. Set it and the
 * same invocation reports Compose 5.1.4. It is a path locator, not a secret, and the same reasoning covers
 * the other three.
 */
export const DOCKER_COMMAND_ENVIRONMENT_NAMES: readonly string[] = [
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CLI_PATH',
  'DOCKER_CLI_PLUGINS',
  'COMPOSE_PROJECT_NAME',
  'CI',
];

const PROHIBITED_EXECUTABLE = /\.(cmd|bat|ps1)$/iu;
const MAX_EXECUTABLE_BYTES = 150 * 1024 * 1024;

export interface ReviewedDockerExecutable {
  executable: string;
  version: string;
  digest: string;
}

/**
 * Turn a declared executable path into a reviewed identity by hashing the bytes that will actually be
 * spawned. The runner verifies the same digest again before it creates the process, so a binary replaced
 * between review and execution is refused by both layers.
 */
export async function reviewDockerExecutable(input: { executable: string; version: string }): Promise<ReviewedDockerExecutable> {
  const executable = path.resolve(input.executable);
  if (!path.isAbsolute(executable)) throw new Error('The reviewed docker executable must be an absolute path');
  if (PROHIBITED_EXECUTABLE.test(executable)) throw new Error('The reviewed docker executable must be a native binary, not a shell script');
  let stat;
  try {
    stat = await fs.lstat(executable);
  } catch {
    throw new Error(`The reviewed docker executable ${executable} is not present`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The reviewed docker executable must be a regular non-link file');
  if (stat.size > MAX_EXECUTABLE_BYTES) throw new Error('The reviewed docker executable exceeds the verified input budget');
  if (typeof input.version !== 'string' || input.version.length === 0) throw new Error('The reviewed docker executable needs a declared version string');
  return { executable, version: input.version, digest: hashBytes(await fs.readFile(executable)) };
}

/** What the CLI itself reports, read from the bytes of a real invocation rather than from a lock file. */
export interface DockerIdentities {
  daemon_reachable: boolean;
  server_version: string | null;
  compose_version: string | null;
  mechanism: string;
  cleanup: 'VERIFIED' | 'UNVERIFIED';
  executable_digest: string;
  commands: { purpose: string; argv: readonly string[]; exit_code: number | null }[];
  diagnostics: EnvironmentManifest['reasons'];
}

export async function observeDockerIdentities(port: ComposeCommandPort, scope: ComposeCommandRequest['scope'], signal: AbortSignal): Promise<DockerIdentities> {
  const commands: DockerIdentities['commands'] = [];
  const diagnostics: string[] = [];
  const version = await port.run({ purpose: 'version', argv: ['version', '--format', '{{.Server.Version}}'], project_namespace: null, signal, scope });
  commands.push({ purpose: version.purpose, argv: version.argv, exit_code: version.exit_code });
  const compose = await port.run({ purpose: 'compose-version', argv: ['compose', 'version', '--short'], project_namespace: null, signal, scope });
  commands.push({ purpose: compose.purpose, argv: compose.argv, exit_code: compose.exit_code });
  for (const command of [version, compose]) for (const diagnostic of command.diagnostics) diagnostics.push(`${diagnostic.rule_id ?? 'SG-TOOL-COMPOSE-START-DOCKER_COMMAND_FAILED'}: ${diagnostic.message}`);
  const reachable = version.exit_code === 0;
  if (!reachable) diagnostics.push(`SG-POLICY-COMPOSE-START-DAEMON_UNREACHABLE: exit ${String(version.exit_code)}`);
  const observed = compose.exit_code === 0 ? compose.stdout.trim().replace(/^v/iu, '') : null;
  if (observed === null) diagnostics.push(`SG-POLICY-COMPOSE-START-COMPOSE_PLUGIN_UNAVAILABLE: the docker CLI did not load its compose plugin: ${firstLine(compose.stderr || compose.stdout).slice(0, 240)}`);
  return {
    daemon_reachable: reachable,
    server_version: reachable ? version.stdout.trim() : null,
    compose_version: observed,
    mechanism: version.mechanism ?? 'UNSUPPORTED',
    cleanup: version.cleanup ?? 'UNVERIFIED',
    executable_digest: port.reviewed.digest,
    commands,
    diagnostics: diagnostics as EnvironmentManifest['reasons'],
  };
}

/**
 * A data revision is confirmed only when the configuration already carries one. `run-service` still writes
 * `local-input-<hash>` for pure-local M2 profiles, and V2-R05 refuses an unconfirmed revision, so this run
 * must not invent a revision of its own: it reports the gap and creates nothing.
 */
export function isConfirmedDataRevision(value: unknown): { ok: boolean; reason: string | null } {
  if (typeof value !== 'string') return { ok: false, reason: 'DATA_REVISION_UNCONFIRMED: not a string' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'DATA_REVISION_UNCONFIRMED: absent from the environment configuration' };
  if (/^(?:UNCONFIRMED|UNKNOWN|NONE|MISSING)$/iu.test(trimmed)) return { ok: false, reason: 'DATA_REVISION_UNCONFIRMED: placeholder value' };
  if (/^local-input-/iu.test(trimmed)) return { ok: false, reason: 'DATA_REVISION_UNCONFIRMED: derived from the input hash instead of a confirmed seed' };
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return { ok: false, reason: 'DATA_REVISION_UNCONFIRMED: carries control characters' };
  return { ok: true, reason: null };
}

/**
 * The strongest provenance this run can attest. `CI=true` in the environment of a locally started compose
 * command is recorded as an observation about the environment, never as a reason to upgrade: an
 * unverified job-object claim or a non-win32 platform caps the run at DECLARED instead.
 */
export function provenanceCeiling(input: { platform: NodeJS.Platform; runner_cleanup: 'VERIFIED' | 'UNVERIFIED' | null; start_evidence: boolean; independent_build_evidence: boolean }): { level: EnvironmentManifest['provenance']; reason: string | null } {
  if (input.platform !== 'win32') {
    return { level: 'DECLARED', reason: 'PROCESS_PROVENANCE_PLATFORM_UNVERIFIED: creation-identity attestation is only implemented and verified on win32' };
  }
  if (input.runner_cleanup !== 'VERIFIED') return { level: 'DECLARED', reason: 'PROCESS_PROVENANCE_JOB_CLEANUP_UNVERIFIED: the owned job was not confirmed reclaimed' };
  if (!input.start_evidence) return { level: 'DECLARED', reason: 'START_EVIDENCE_MISSING: no real start command completed' };
  // OBSERVED is the ceiling for a locally started environment. Build evidence is recorded but does not
  // upgrade it either: only a trusted execution context could, and that is not what this host can attest.
  if (!input.independent_build_evidence) return { level: 'OBSERVED', reason: null };
  return { level: 'OBSERVED', reason: null };
}

/** Values the run authorises are treated as secrets when compose output is stored; the raw text never lands. */
export function redactComposeEvidence(text: string, environment: Readonly<Record<string, string>>): string {
  const secrets = Object.values(environment).filter((value) => value.length > 0);
  return redactText(text, secrets);
}

/** Only the first non-empty line of a CLI answer is echoed into a diagnostic; the rest stays in the command result. */
function firstLine(text: string): string {
  return text.split(/[\r\n]+/u).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
}

export function digestOfText(text: string): string {
  return hashBytes(Buffer.from(text, 'utf8'));
}

export interface ProvenanceSnapshotInput {
  run_id: string;
  environment_id: string;
  project_namespace: string;
  owner_token: string;
  instance_id: string;
  input_hash: string;
  data_revision: string;
  policy: { policy_id: string; policy_hash: string; minimum_provenance: string };
  declared: Record<string, unknown>;
  observed: Record<string, unknown>;
  provenance: { level: EnvironmentManifest['provenance']; ceiling_reason: string | null; ci_flag_observed: boolean };
  recorded_at: string;
}

/**
 * The snapshot document this run writes during `prepare`. Declared and observed facts stay in separate
 * objects on purpose: a reader can never mistake a configuration string for something the daemon reported.
 */
export function composeProvenanceSnapshot(input: ProvenanceSnapshotInput): Record<string, unknown> {
  return {
    schema_version: '0.1',
    kind: 'stackgate-compose-provenance',
    run_id: input.run_id,
    environment_id: input.environment_id,
    project_namespace: input.project_namespace,
    owner_token: input.owner_token,
    instance_id: input.instance_id,
    input_hash: input.input_hash,
    data_revision: input.data_revision,
    policy: input.policy,
    declared: input.declared,
    observed: input.observed,
    provenance: {
      level: input.provenance.level,
      ceiling_reason: input.provenance.ceiling_reason,
      ci_flag_observed: input.provenance.ci_flag_observed,
      controlled_claim: false,
      ceiling: 'OBSERVED',
      note: 'A locally started compose environment is not a controlled one; a CI flag in the command environment does not change this ceiling.',
    },
    recorded_at: input.recorded_at,
  };
}
