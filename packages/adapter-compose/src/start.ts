import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Diagnostic, EnvironmentManifest, ReasonCode } from '../../contracts/src/index.js';
import type { ProcessIdentity, ResolvedCommand, RunnerPort, RunnerResult } from '../../core/src/ports/runner.js';
import { filterEnvironment } from '../../core/src/domain/environment-filter.js';
import { hashBytes } from '../../core/src/storage/hash.js';
import { canonicalJson } from '../../core/src/storage/canonical-json.js';
import { DOCKER_COMMAND_ENVIRONMENT_NAMES, reviewDockerExecutable } from './provenance.js';

/**
 * Compose resource creation for SG-058.
 *
 * Two responsibilities live here and nowhere else: (1) the run's own identity — a project namespace, an
 * owner token and an instance id that bind every created object back to this run — and (2) the only path
 * by which a Docker command leaves this adapter. Every command goes out as an argv array through the
 * reviewed `RunnerPort` (the controlled local executor, which re-verifies the executable digest and holds
 * the owned-job identity); no command is ever assembled as a shell string, and no argv element is ever
 * taken from a log line, a response body or a task description.
 *
 * The argv boundary is deliberately narrow: create, observe, account. Anything that could reach resources
 * this run does not own (`system prune`, `container rm`, `compose down`, `pull`, a bare `ps -q`, an
 * `inspect` by name) is refused before a process is spawned. Reclaiming resources is SG-061's task.
 */

const PREFIX = 'SG-POLICY-COMPOSE-START-';
const SOURCE = 'compose-start';

/** Every refusal this module can emit. SG-061 and SG-062 bind against these exact rule ids. */
export const COMPOSE_START_RULES = {
  ARGV_UNSAFE: `${PREFIX}ARGV_UNSAFE`,
  COMMAND_NOT_PERMITTED: `${PREFIX}COMMAND_NOT_PERMITTED`,
  COMMAND_IDENTITY_UNREVIEWED: `${PREFIX}COMMAND_IDENTITY_UNREVIEWED`,
  COMMAND_WORKING_DIRECTORY_UNSAFE: `${PREFIX}COMMAND_WORKING_DIRECTORY_UNSAFE`,
  COMMAND_FAILED: `${PREFIX}DOCKER_COMMAND_FAILED`,
  COMMAND_OUTPUT_INCOMPLETE: `${PREFIX}DOCKER_COMMAND_OUTPUT_INCOMPLETE`,
  DAEMON_UNREACHABLE: `${PREFIX}DAEMON_UNREACHABLE`,
  HOST_PORT_CONFLICT: `${PREFIX}HOST_PORT_CONFLICT`,
  IMAGE_UNAVAILABLE: `${PREFIX}IMAGE_UNAVAILABLE`,
  BUILD_FAILED: `${PREFIX}BUILD_FAILED`,
  UNKNOWN_FAILURE: `${PREFIX}START_FAILURE_UNCLASSIFIED`,
  COMPOSE_UNAVAILABLE: `${PREFIX}COMPOSE_PLUGIN_UNAVAILABLE`,
  NAMESPACE_UNSAFE: `${PREFIX}NAMESPACE_UNSAFE`,
  DATA_REVISION_UNCONFIRMED: `${PREFIX}DATA_REVISION_UNCONFIRMED`,
  CONTROLLED_NOT_CERTIFIABLE: `${PREFIX}CONTROLLED_NOT_CERTIFIABLE`,
  PROCESS_PROVENANCE_PLATFORM_UNVERIFIED: `${PREFIX}PROCESS_PROVENANCE_PLATFORM_UNVERIFIED`,
  INPUT_HASH_MISMATCH: `${PREFIX}ENV_INPUT_MISMATCH`,
  RESOURCE_ADOPTION_REFUSED: `${PREFIX}RESOURCE_ADOPTION_REFUSED`,
  SERVICE_NOT_RUNNING: `${PREFIX}SERVICE_NOT_RUNNING`,
  HOST_BINDING_ABSENT: `${PREFIX}HOST_BINDING_ABSENT`,
  HOST_BINDING_CHANGED: `${PREFIX}HOST_BINDING_CHANGED`,
  HOST_BINDING_AMBIGUOUS: `${PREFIX}HOST_BINDING_AMBIGUOUS`,
  HOST_BINDING_NOT_LOOPBACK: `${PREFIX}HOST_BINDING_NOT_LOOPBACK`,
  SERVICE_SCHEME_UNDECLARED: `${PREFIX}SERVICE_SCHEME_UNDECLARED`,
  SERVICE_ROLE_AMBIGUOUS: `${PREFIX}SERVICE_ROLE_AMBIGUOUS`,
  SERVICES_NOT_IN_PLAN: `${PREFIX}SERVICES_NOT_IN_PLAN`,
  CONFIGURATION_DRIFT: `${PREFIX}EFFECTIVE_CONFIGURATION_DRIFT`,
  SCOPE_UNSETTLED: `${PREFIX}RUN_SCOPE_UNSETTLED`,
  CONTINUITY_BROKEN: `${PREFIX}RESOURCE_CONTINUITY_BROKEN`,
  LEDGER_INCOMPLETE: `${PREFIX}RESOURCE_LEDGER_INCOMPLETE`,
  CLEANUP_RESERVED: `${PREFIX}CLEANUP_RESERVED_FOR_SG061`,
  DIAGNOSTIC_RULE_ID_MISSING: `${PREFIX}DIAGNOSTIC_RULE_ID_MISSING`,
} as const satisfies Record<string, `${typeof PREFIX}${string}`>;

export type StartRule = typeof COMPOSE_START_RULES[keyof typeof COMPOSE_START_RULES];

/** The closed set of docker sub-shapes this adapter is able to ask for. */
export type ComposeCommandPurpose = 'version' | 'compose-version' | 'config' | 'up' | 'build' | 'inspect' | 'enumerate' | 'image-inspect';

export interface ComposeCommandRequest {
  purpose: ComposeCommandPurpose;
  argv: readonly string[];
  /** The namespace every project-scoped command must name; never inferred from previous output. */
  project_namespace: string | null;
  timeout_ms?: number;
  signal: AbortSignal;
  scope: { run_id: string; check_id: string; attempt_id: string };
}

export interface ComposeCommandResult {
  argv: readonly string[];
  purpose: ComposeCommandPurpose;
  permitted: boolean;
  status: RunnerResult['status'] | 'REFUSED';
  exit_code: number | null;
  stdout: string;
  stderr: string;
  /** The kernel-level identity of the process this run created, exactly as the owned-process runner reported it. */
  process: ProcessIdentity | null;
  mechanism: string | null;
  cleanup: 'VERIFIED' | 'UNVERIFIED' | null;
  diagnostics: Diagnostic[];
}

export interface ComposeCommandPort {
  readonly reviewed: { executable: string; version: string; digest: string };
  run(request: ComposeCommandRequest): Promise<ComposeCommandResult>;
}

export interface OwnedResourceInput {
  resource_type: EnvironmentManifest['resources'][number]['resource_type'];
  native_id: string;
  /** What this run can actually attest about who created the object. */
  created_by_stackgate: boolean;
  creation_identity: string;
  run_id: string;
  owner_token: string;
  created_at: string;
  cleanup_status: EnvironmentManifest['resources'][number]['cleanup_status'];
}

const DEFAULT_TIMEOUTS: Readonly<Record<ComposeCommandPurpose, number>> = {
  version: 20_000,
  'compose-version': 20_000,
  config: 60_000,
  up: 180_000,
  build: 300_000,
  inspect: 30_000,
  enumerate: 30_000,
  'image-inspect': 30_000,
};

const DENIED_SUBCOMMANDS = new Set(['prune', 'down', 'rm', 'remove', 'kill', 'stop', 'restart', 'start', 'exec', 'attach', 'cp', 'commit', 'run', 'create', 'pull', 'push', 'login', 'logout', 'system', 'builder', 'context', 'service', 'stack', 'plugin', 'trust', 'events', 'logs', 'stats', 'history', 'tag', 'save', 'load', 'import', 'export', 'rename', 'update', 'wait', 'diff', 'pause', 'unpause', 'port', 'top', 'resize', 'detach', 'debug', 'bundle']);
const COMPOSE_SUBCOMMANDS = new Set(['config', 'up', 'build', 'version']);
const ID_SHAPE = /^[0-9a-f]{12,64}$/;
const NAMESPACE_SHAPE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/**
 * Map a refusal to the diagnostic code the core already knows. Boundary escapes are POLICY_WEAKEN_ATTEMPT,
 * structural problems are CONFIG_INVALID, tool conditions are TOOL_FAILURE, and anything that leaves the
 * run unable to attest provenance is ENV_PROVENANCE_INSUFFICIENT.
 */
const CODE_BY_RULE: Readonly<Partial<Record<StartRule, ReasonCode>>> = {
  [COMPOSE_START_RULES.NAMESPACE_UNSAFE]: 'CONFIG_INVALID',
  [COMPOSE_START_RULES.ARGV_UNSAFE]: 'CONFIG_INVALID',
  [COMPOSE_START_RULES.DATA_REVISION_UNCONFIRMED]: 'CONFIG_INVALID',
  [COMPOSE_START_RULES.SERVICES_NOT_IN_PLAN]: 'CONFIG_INVALID',
  [COMPOSE_START_RULES.COMMAND_IDENTITY_UNREVIEWED]: 'CONFIG_INVALID',
  [COMPOSE_START_RULES.COMMAND_WORKING_DIRECTORY_UNSAFE]: 'CONFIG_INVALID',
  [COMPOSE_START_RULES.COMMAND_NOT_PERMITTED]: 'POLICY_WEAKEN_ATTEMPT',
  [COMPOSE_START_RULES.RESOURCE_ADOPTION_REFUSED]: 'POLICY_WEAKEN_ATTEMPT',
  [COMPOSE_START_RULES.CONFIGURATION_DRIFT]: 'POLICY_WEAKEN_ATTEMPT',
  [COMPOSE_START_RULES.HOST_PORT_CONFLICT]: 'POLICY_WEAKEN_ATTEMPT',
  [COMPOSE_START_RULES.COMMAND_FAILED]: 'TOOL_FAILURE',
  [COMPOSE_START_RULES.UNKNOWN_FAILURE]: 'TOOL_FAILURE',
  [COMPOSE_START_RULES.LEDGER_INCOMPLETE]: 'TOOL_FAILURE',
  [COMPOSE_START_RULES.CONTINUITY_BROKEN]: 'TOOL_FAILURE',
  [COMPOSE_START_RULES.COMMAND_OUTPUT_INCOMPLETE]: 'ARTIFACT_BUDGET_EXCEEDED',
  [COMPOSE_START_RULES.DAEMON_UNREACHABLE]: 'TOOL_FAILURE',
  [COMPOSE_START_RULES.COMPOSE_UNAVAILABLE]: 'UNSUPPORTED_CAPABILITY',
  [COMPOSE_START_RULES.BUILD_FAILED]: 'TOOL_FAILURE',
  [COMPOSE_START_RULES.IMAGE_UNAVAILABLE]: 'INPUT_STALE',
  [COMPOSE_START_RULES.INPUT_HASH_MISMATCH]: 'INPUT_STALE',
  [COMPOSE_START_RULES.CLEANUP_RESERVED]: 'UNSUPPORTED_CAPABILITY',
  [COMPOSE_START_RULES.PROCESS_PROVENANCE_PLATFORM_UNVERIFIED]: 'UNSUPPORTED_CAPABILITY',
  [COMPOSE_START_RULES.SCOPE_UNSETTLED]: 'ENV_PROVENANCE_INSUFFICIENT',
  [COMPOSE_START_RULES.CONTROLLED_NOT_CERTIFIABLE]: 'ENV_PROVENANCE_INSUFFICIENT',
};

function refuseStart(rule: StartRule, message: string, location: string, observed_facts: Record<string, unknown>, recommended_action: string): Diagnostic {
  return { code: CODE_BY_RULE[rule] ?? 'ENV_PROVENANCE_INSUFFICIENT', rule_id: rule, message, location, observed_facts, recommended_action, source: SOURCE };
}

export function startDiagnostic(rule: StartRule, message: string, location: string, observed_facts: Record<string, unknown> = {}, recommended_action = 'Fix the run inputs or the daemon state; never widen the command boundary to work around it.'): Diagnostic {
  return refuseStart(rule, message, location, observed_facts, recommended_action);
}

/**
 * Decide whether this run may spawn this argv at all. The checks are ordered so a request is refused by
 * its real cause: an unsafe element, then a denied operation, then a namespace that is not this run's.
 */
export function assertPermittedArgv(argv: readonly string[], project_namespace: string | null): { ok: true } | { ok: false; rule: StartRule; message: string } {
  if (argv.length === 0 || argv.length > 64) return { ok: false, rule: COMPOSE_START_RULES.ARGV_UNSAFE, message: 'A docker invocation must be a bounded argv array.' };
  for (const entry of argv) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.includes('\0')) return { ok: false, rule: COMPOSE_START_RULES.ARGV_UNSAFE, message: 'An argv element is empty or carries a NUL byte, so it cannot be a command array element.' };
    if (/^[&|;<>\n\r]$/u.test(entry)) return { ok: false, rule: COMPOSE_START_RULES.ARGV_UNSAFE, message: 'An argv element is a shell operator.' };
  }
  if (project_namespace !== null && !NAMESPACE_SHAPE.test(project_namespace)) {
    return { ok: false, rule: COMPOSE_START_RULES.NAMESPACE_UNSAFE, message: 'The project namespace is not a safe compose project name, so no resource can be scoped to it.' };
  }
  const head = argv[0]!;
  if (DENIED_SUBCOMMANDS.has(head)) return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: `This run may not run docker ${head}: it would act on resources the run does not own.` };
  if (head === 'compose') return composeArgvDecision(argv, project_namespace);
  if (head === 'inspect') {
    const ids = argv.slice(1);
    if (ids.length === 0 || ids.length > 32) return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'docker inspect must name a bounded set of ids.' };
    // ids only: inspecting by name would let a log line steer which container this run reads.
    if (ids.some((id) => !ID_SHAPE.test(id))) return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'docker inspect is limited to resource ids this run enumerated itself.' };
    return { ok: true };
  }
  if (head === 'image' && argv[1] === 'inspect') {
    const references = argv.slice(2);
    if (references.length !== 1 || references[0]!.length > 512 || references[0]!.includes(' ')) return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'docker image inspect takes exactly one image reference.' };
    return { ok: true };
  }
  if (head === 'version') {
    if (argv.length !== 3 || argv[1] !== '--format' || argv[2] !== '{{.Server.Version}}') return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'docker version is only allowed in its pinned single-field form.' };
    return { ok: true };
  }
  if (head === 'ps' || (head === 'network' && argv[1] === 'ls') || (head === 'volume' && argv[1] === 'ls')) {
    return enumerationDecision(argv, project_namespace, head);
  }
  return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: `docker ${head} is outside the operations this run is allowed to start.` };
}

/**
 * Enumerations are admitted only in one exact pinned shape per listing, filtered to this run's project label.
 *
 * The shape is chosen by what the ledger has to be able to see, not by what is convenient to write:
 * - `ps -a`: a container this run created and that then exited must still be enumerated. Without `-a` the
 *   daemon hides it, so the ownership gate would adopt a namespace whose only leftover is an exited object,
 *   and the accounting gate would drop the very resource SG-061 has to reclaim. `network ls` and `volume ls`
 *   already list every object, so no such flag exists or is needed there.
 * - `--no-trunc`: without it the daemon truncates ids to 12 characters, and the ledger would record an id no
 *   independent inspection repeats. Verified on this host's CLI: `docker ps -a --format {{.ID}}` answers
 *   `39297b3eb3a8`, the same listing with `--no-trunc` answers the 64-character id `docker inspect` reports.
 *   `volume ls` is pinned without it because this CLI rejects the flag outright (`docker volume ls
 *   --no-trunc` exits 125 with `unknown flag: --no-trunc`), and `{{.Name}}` is a volume name, never an id the
 *   daemon would shorten, so nothing is lost by omitting it.
 * - the project label and the pinned format field are matched position by position against the request, so a
 *   looser listing (`-q`, a foreign label, `{{.Names}}`, an extra `--filter`) cannot reach the ledger.
 */
function enumerationDecision(argv: readonly string[], project_namespace: string | null, head: string): { ok: true } | { ok: false; rule: StartRule; message: string } {
  if (project_namespace === null) {
    return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: `docker ${head} must be filtered to this run own project label.` };
  }
  const required = `label=com.docker.compose.project=${project_namespace}`;
  const untruncated = head === 'volume' ? [] : ['--no-trunc'];
  const expected = [
    ...(head === 'ps' ? ['ps', '-a'] : [head, 'ls']),
    ...untruncated,
    '--filter',
    required,
    '--format',
    head === 'volume' ? '{{.Name}}' : '{{.ID}}',
  ];
  if (argv.length === expected.length && expected.every((token, index) => argv[index] === token)) return { ok: true };
  return {
    ok: false,
    rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED,
    message: `docker ${head} enumeration must be exactly the pinned shape (${expected.join(' ')}); a looser listing could report objects this run does not own, or hide ones it created.`,
  };
}

function composeArgvDecision(argv: readonly string[], project_namespace: string | null): { ok: true } | { ok: false; rule: StartRule; message: string } {
  // `compose version --short` creates and reads nothing project-scoped, so it needs no namespace pin.
  if (argv.length === 3 && argv[1] === 'version' && argv[2] === '--short') return { ok: true };
  if (project_namespace === null) return { ok: false, rule: COMPOSE_START_RULES.NAMESPACE_UNSAFE, message: 'A compose command without this run project namespace cannot be scoped.' };
  const nameIndex = argv.indexOf('--project-name');
  if (nameIndex === -1 || argv[nameIndex + 1] !== project_namespace) {
    return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'The compose command does not name this run project namespace, so it could act on another project.' };
  }
  // Everything up to the subcommand is global flags; the subcommand is the first token after them.
  let cursor = 1;
  while (cursor < argv.length && !COMPOSE_SUBCOMMANDS.has(argv[cursor]!)) {
    if (argv[cursor]!.startsWith('--') || argv[cursor]!.startsWith('-')) {
      // a flag taking a value is skipped together with its value
      if (cursor + 1 >= argv.length) return { ok: false, rule: COMPOSE_START_RULES.ARGV_UNSAFE, message: 'A compose global flag is missing its value.' };
      cursor += argv[cursor + 1] !== undefined && !COMPOSE_SUBCOMMANDS.has(argv[cursor + 1]!) && !argv[cursor + 1]!.startsWith('-') ? 2 : 1;
      continue;
    }
    return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: `Unexpected compose token ${argv[cursor]!} before the subcommand.` };
  }
  const subcommand = argv[cursor];
  if (subcommand === undefined || !COMPOSE_SUBCOMMANDS.has(subcommand)) {
    return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'Only compose config, up, build and version are allowed for this run.' };
  }
  const rest = argv.slice(cursor + 1);
  const denied = rest.find((token) => DENIED_SUBCOMMANDS.has(token) || token === '--force-recreate' || token === '--remove-orphans' || token === '--wait');
  if (denied !== undefined) return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: `compose ${subcommand} cannot carry ${denied}: it would touch resources beyond this run plan.` };
  if (subcommand === 'config' && !(rest.length === 2 && rest[0] === '--format' && rest[1] === 'json')) {
    return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'compose config is only allowed in its json form, so the effective document is machine-checkable.' };
  }
  if (subcommand === 'up') {
    if (!rest.includes('-d')) return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'compose up must be detached; a foreground start would outlive the reviewed command deadline.' };
    if (!rest.includes('--no-build')) return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'compose up must forbid implicit builds, so only the preflighted plan can create resources.' };
    if (rest.includes('--pull')) return { ok: false, rule: COMPOSE_START_RULES.COMMAND_NOT_PERMITTED, message: 'compose up must not pull: the run inputs would no longer be the images it recorded.' };
  }
  return { ok: true };
}

/** Classify the daemon/compose stderr of a real failed start, so the run reports a cause and not a guess. */
export function classifyStartFailure(text: string): 'HOST_PORT_CONFLICT' | 'IMAGE_UNAVAILABLE' | 'BUILD_FAILED' | 'DAEMON_UNREACHABLE' | 'COMPOSE_UNAVAILABLE' | 'UNKNOWN_FAILURE' {
  const value = text.toLowerCase();
  if (/port is already allocated|bind for .*failed|address already in use|prefix template .*already/iu.test(value)) return 'HOST_PORT_CONFLICT';
  // the daemon answers but the compose plugin did not load, e.g. PROGRAMFILES missing from the CLI env
  if (/is not a docker command|unknown flag: --|unknown shorthand flag|docker \[options\] command/iu.test(value)) return 'COMPOSE_UNAVAILABLE';
  if (/error during build|failed to solve|dockerfile|buildkit|build failed/iu.test(value)) return 'BUILD_FAILED';
  if (/no such image|manifest unknown|image not known|pull access denied|not found: .*revision|errdefnotfound|reference is not a tag/iu.test(value)) return 'IMAGE_UNAVAILABLE';
  if (/cannot connect to the docker daemon|failed to connect|is the docker daemon running|npipe|connection refused|client version .*is too old|context deadline/iu.test(value)) return 'DAEMON_UNREACHABLE';
  return 'UNKNOWN_FAILURE';
}

const START_RULE_BY_CLASSIFICATION: Readonly<Record<ReturnType<typeof classifyStartFailure>, StartRule>> = {
  HOST_PORT_CONFLICT: COMPOSE_START_RULES.HOST_PORT_CONFLICT,
  COMPOSE_UNAVAILABLE: COMPOSE_START_RULES.COMPOSE_UNAVAILABLE,
  IMAGE_UNAVAILABLE: COMPOSE_START_RULES.IMAGE_UNAVAILABLE,
  BUILD_FAILED: COMPOSE_START_RULES.BUILD_FAILED,
  DAEMON_UNREACHABLE: COMPOSE_START_RULES.DAEMON_UNREACHABLE,
  UNKNOWN_FAILURE: COMPOSE_START_RULES.UNKNOWN_FAILURE,
};

export function startFailureRule(text: string): StartRule {
  return START_RULE_BY_CLASSIFICATION[classifyStartFailure(text)];
}

/** A compose project name for this run: the run id, lower-cased and slugified, plus per-run entropy. */
export function composeProjectNamespace(run_id: string, entropy?: string): string {
  if (!/^run_[A-Za-z0-9_-]+$/.test(run_id)) throw new Error('A compose project namespace needs a valid run id');
  const suffix = entropy ?? randomBytes(6).toString('hex');
  if (!/^[0-9a-f]{12}$/.test(suffix)) throw new Error('Compose namespace entropy must be twelve hex characters');
  const slug = run_id.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  const namespace = `stackgate-${slug}-${suffix}`.slice(0, 63);
  if (!NAMESPACE_SHAPE.test(namespace)) throw new Error('The generated compose project name is not safe');
  return namespace;
}

/** The owner token every resource of this run carries: one per run, so a reclaim can be scoped to it. */
export function composeOwnerToken(entropy?: string): string {
  const suffix = entropy ?? randomBytes(12).toString('hex');
  if (!/^[0-9a-f]{24}$/.test(suffix)) throw new Error('Compose owner token entropy must be twenty-four hex characters');
  return `ot_${suffix}`;
}

export function composeInstanceId(entropy?: string): string {
  const suffix = entropy ?? randomBytes(6).toString('hex');
  if (!/^[0-9a-f]{12}$/.test(suffix)) throw new Error('Compose instance entropy must be twelve hex characters');
  return `inst_${suffix}`;
}

function projectLabel(namespace: string): string {
  return `label=com.docker.compose.project=${namespace}`;
}

export interface ComposeCommandPortOptions {
  runner: RunnerPort;
  docker: { executable: string; version: string };
  cwd: string;
  /** Values this run authorises compose to interpolate; never read from the wider process environment. */
  environment: Readonly<Record<string, string>>;
  on_command?: (record: { purpose: ComposeCommandPurpose; argv: readonly string[]; exit_code: number | null }) => void;
  timeouts_ms?: Partial<Record<ComposeCommandPurpose, number>>;
}

const MAX_CAPTURED_BYTES = 4 * 1024 * 1024;

/**
 * Build the only command port the compose adapter uses. The reviewed executable identity is verified here
 * and then verified again by the runner before the process exists, so a substituted binary is caught by
 * both layers; nothing in this port reads a path out of command output.
 */
export async function createComposeCommandPort(options: ComposeCommandPortOptions): Promise<ComposeCommandPort> {
  const reviewed = await reviewDockerExecutable(options.docker);
  const cwd = path.resolve(options.cwd);
  let directory;
  try {
    directory = await fs.stat(cwd);
  } catch {
    directory = undefined;
  }
  if (!directory?.isDirectory()) {
    throw new Error(`The compose working directory ${cwd} does not exist; a run may not create resources outside its own directory`);
  }
  const baseEnvironment = filterEnvironment(process.env, DOCKER_COMMAND_ENVIRONMENT_NAMES, process.platform);
  const authorizationHash = hashBytes(Buffer.from(canonicalJson({ executable: reviewed.executable, digest: reviewed.digest, cwd })));
  return {
    reviewed,
    async run(request) {
      const decision = assertPermittedArgv(request.argv, request.project_namespace);
      if (!decision.ok) {
        return {
          argv: [...request.argv],
          purpose: request.purpose,
          permitted: false,
          status: 'REFUSED',
          exit_code: null,
          stdout: '',
          stderr: '',
          process: null,
          mechanism: null,
          cleanup: null,
          diagnostics: [startDiagnostic(decision.rule, decision.message, `/commands/${request.purpose}`, { argv_length: request.argv.length })],
        };
      }
      const environment: Record<string, string> = { ...baseEnvironment };
      for (const [key, value] of Object.entries(options.environment)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !value.includes('\0')) environment[key.toUpperCase()] = value;
      }
      const command: ResolvedCommand = {
        command_id: `compose-${request.purpose}`,
        identity: { executable: reviewed.executable, version: reviewed.version, digest: reviewed.digest },
        args: [...request.argv],
        cwd,
        environment,
        timeout_ms: request.timeout_ms ?? options.timeouts_ms?.[request.purpose] ?? DEFAULT_TIMEOUTS[request.purpose],
        authorization_hash: authorizationHash,
        command_hash: hashBytes(Buffer.from(canonicalJson({ argv: request.argv, cwd, environment_names: Object.keys(environment).sort() }))),
        verified_inputs: [{ path: reviewed.executable, digest: reviewed.digest }],
      };
      let stdout = '';
      let stderr = '';
      let truncated = false;
      const capture = (stream: 'stdout' | 'stderr') => async (chunk: Uint8Array): Promise<void> => {
        const text = Buffer.from(chunk).toString('utf8');
        if (stream === 'stdout') stdout = appendCapped(stdout, text);
        else stderr = appendCapped(stderr, text);
      };
      const appendCapped = (current: string, text: string): string => {
        if (truncated) return current;
        const combined = current + text;
        if (Buffer.byteLength(combined) > MAX_CAPTURED_BYTES) {
          truncated = true;
          return Buffer.from(combined).subarray(0, MAX_CAPTURED_BYTES).toString('utf8');
        }
        return combined;
      };
      const result = await options.runner.run(command, {
        run_id: request.scope.run_id,
        check_id: request.scope.check_id,
        attempt_id: request.scope.attempt_id,
        signal: request.signal,
        stdout: capture('stdout'),
        stderr: capture('stderr'),
      });
      options.on_command?.({ purpose: request.purpose, argv: [...request.argv], exit_code: result.raw_exit_code });
      const diagnostics: Diagnostic[] = result.diagnostics.map((diagnostic) => ({ ...diagnostic, location: `/commands/${request.purpose}${diagnostic.location}` }));
      if (truncated) diagnostics.push(startDiagnostic(COMPOSE_START_RULES.COMMAND_OUTPUT_INCOMPLETE, 'The command output exceeded the retained evidence budget, so the recorded bytes are a bounded prefix.', `/commands/${request.purpose}`, { stream_limit_bytes: MAX_CAPTURED_BYTES }));
      if (result.status !== 'EXITED') diagnostics.push(startDiagnostic(COMPOSE_START_RULES.COMMAND_FAILED, `The reviewed docker command did not complete normally (${result.status}).`, `/commands/${request.purpose}`, { purpose: request.purpose, exit_code: result.raw_exit_code, signal: result.signal }));
      // A refusal or unknown-flag answer comes back as a clean exit-125, so it is echoed here in bounded
      // form; a later `unknown flag: --short` then names the command that produced it instead of arriving
      // as an unclassified `up` failure several commands later.
      if (result.status === 'EXITED' && result.raw_exit_code !== 0) {
        const firstLine = `${stderr}\n${stdout}`.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0)[0] ?? '';
        diagnostics.push(startDiagnostic(COMPOSE_START_RULES.COMMAND_FAILED, `docker ${request.argv.slice(0, 2).join(' ')} exited ${String(result.raw_exit_code)}: ${firstLine.slice(0, 240)}`, `/commands/${request.purpose}`, { purpose: request.purpose, argv: request.argv.slice(0, 8) }));
      }
      return {
        argv: [...request.argv],
        purpose: request.purpose,
        permitted: true,
        status: result.status,
        exit_code: result.raw_exit_code,
        stdout,
        stderr,
        process: result.process,
        mechanism: result.provenance?.mechanism ?? null,
        cleanup: result.provenance?.cleanup ?? null,
        diagnostics,
      };
    },
  };
}

/** Ids of every object the daemon reports under this project namespace, taken from label-filtered listings. */
export async function enumerateProjectResources(port: ComposeCommandPort, namespace: string, scope: ComposeCommandRequest['scope'], signal: AbortSignal = new AbortController().signal): Promise<{ containers: string[]; networks: string[]; volumes: string[] }> {
  const listing = async (argv: string[], field: 'containers' | 'networks' | 'volumes'): Promise<string[]> => {
    const result = await port.run({ purpose: 'enumerate', argv, project_namespace: namespace, signal, scope });
    if (result.exit_code !== 0) throw new ComposeEnumerationError(field, result);
    return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
  };
  const [containers, networks, volumes] = await Promise.all([
    listing(['ps', '-a', '--no-trunc', '--filter', projectLabel(namespace), '--format', '{{.ID}}'], 'containers'),
    listing(['network', 'ls', '--no-trunc', '--filter', projectLabel(namespace), '--format', '{{.ID}}'], 'networks'),
    // `volume ls` on this CLI has no `--no-trunc` flag: passing it exits 125, so the pinned volume shape omits
    // it and reads the full `{{.Name}}`, which the daemon never shortens.
    listing(['volume', 'ls', '--filter', projectLabel(namespace), '--format', '{{.Name}}'], 'volumes'),
  ]);
  return { containers, networks, volumes };
}

/** A failed enumeration is a tool condition, never an empty answer: the caller must not report no resources. */
export class ComposeEnumerationError extends Error {
  constructor(readonly field: 'containers' | 'networks' | 'volumes', readonly command: ComposeCommandResult) {
    super(`docker enumeration of ${field} failed with exit ${String(command.exit_code)}`);
    this.name = 'ComposeEnumerationError';
  }
}

/** Assemble the ledger entries. One owner token per run, one creation identity per created object. */
export function buildResourceLedger(inputs: {
  run_id: string;
  owner_token: string;
  created_at: string;
  creation: ProcessIdentity | null;
  containers: string[];
  networks: string[];
  volumes: string[];
  /** Ids this run did not create in this command (already present under the namespace) are never claimed. */
  not_owned?: { containers?: readonly string[]; networks?: readonly string[]; volumes?: readonly string[] };
}): EnvironmentManifest['resources'] {
  const identity = inputs.creation ? `${inputs.creation.pid}:${inputs.creation.creation_identity}:${inputs.creation.owner_token}` : 'stackgate-compose-creation-identity-unobserved';
  const rows: EnvironmentManifest['resources'] = [];
  const push = (resource_type: EnvironmentManifest['resources'][number]['resource_type'], native_id: string, owned: boolean, created_at: string): void => {
    rows.push({
      run_id: inputs.run_id,
      owner_token: inputs.owner_token,
      resource_type,
      native_id,
      created_at,
      creation_identity: owned ? identity : 'not-created-by-this-run',
      created_by_stackgate: owned,
      cleanup_status: owned ? 'PENDING' : 'PRESERVED',
    });
  };
  for (const id of inputs.containers) push('container', id, !(inputs.not_owned?.containers ?? []).includes(id), inputs.created_at);
  for (const id of inputs.networks) push('network', id, !(inputs.not_owned?.networks ?? []).includes(id), inputs.created_at);
  for (const name of inputs.volumes) push('volume', name, !(inputs.not_owned?.volumes ?? []).includes(name), inputs.created_at);
  return rows;
}

export function newRunEntropyHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function newRunUuid(): string {
  return randomUUID();
}
