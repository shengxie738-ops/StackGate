import path from 'node:path';
import type { CleanupResult, EnvironmentPort, EnvironmentRequest } from '../../core/src/ports/environment.js';
import type { ExecutionContext } from '../../core/src/ports/adapter.js';
import type { ArtifactWrite } from '../../core/src/ports/evidence.js';
import type { ReasonCode, Diagnostic, EnvironmentManifest } from '../../contracts/src/index.js';
import { accountBuildInputs, asRecord, loadComposeFile } from './config.js';
import { preflightCompose, type ComposePreflightResult, type ComposeResourcePlan } from './preflight.js';
import { authorizeBindingOrigin, planServiceBindings, recordObservedBindings, type ServicePortBinding } from './target-bindings.js';
import {
  COMPOSE_START_RULES,
  buildResourceLedger,
  classifyStartFailure,
  composeInstanceId,
  composeOwnerToken,
  composeProjectNamespace,
  enumerateProjectResources,
  startDiagnostic,
  startFailureRule,
  type ComposeCommandPort,
  type ComposeCommandRequest,
  type ComposeCommandResult,
  type StartRule,
} from './start.js';
import { containerFacts, inspectObjects, networkFacts, observedImageIds, readPublishedBinding, type InspectedObject } from './inspect.js';
import { composeProvenanceSnapshot, digestOfText, isConfirmedDataRevision, observeDockerIdentities, provenanceCeiling, redactComposeEvidence, type DockerIdentities } from './provenance.js';

/**
 * `ComposeAdapter` — the StackGate-owned Compose environment for one run (SG-058).
 *
 * Read this file as an ordering of gates, because the ordering *is* the behaviour:
 *
 *   1. inputs this run must already have settled — data revision, demanded provenance level, platform
 *      ceiling, run id and input hash. Refused here means nothing is created and no command is spawned.
 *   2. configuration — the compose document is parsed (`config.ts`) and preflighted (`preflightCompose`)
 *      with *this run's* namespace; then `docker compose config` is asked for its effective document and
 *      that is preflighted too. Both must approve and their plans must agree before anything can exist.
 *   3. ownership — the daemon is asked whether the namespace already holds objects. If it does, this run
 *      refuses to adopt them and stops; a same-named resource is never recycled into this run's ledger.
 *   4. create — one detached `compose up --no-build` naming only the services the approved plan carries.
 *   5. account — enumerate by project label, inspect by id, build the ledger. This runs even when step 4
 *      failed, so every object the aborted start created is reclaimable by SG-061.
 *   6. bind — host ports come from `docker inspect` and nowhere else. They are handed to SG-057's
 *      `recordObservedBindings`, and the API/web origins are derived from that observation. No profile,
 *      policy hash or allowlist is modified to make a port fit; the origin authorization decision is
 *      recorded as it comes out, denial included.
 *   7. snapshot — declared and observed facts are written as redacted evidence artifacts, with the
 *      provenance ceiling next to them.
 *
 * Every command leaves through the reviewed command port (`start.ts`), which spawns an argv array inside
 * the owned-process runner that re-verifies the executable digest and attests a creation identity. Local
 * Compose is never reported as controlled: `provenanceCeiling` caps it at OBSERVED, and on a platform
 * where no creation identity can be attested the environment is refused instead of claimed.
 */

const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE = 'compose-adapter';

/** Machine-readable reasons the environment layer already knows, kept outside the start-rule namespace. */
const DATA_REVISION_RULE = COMPOSE_START_RULES.DATA_REVISION_UNCONFIRMED;
const CONTROLLED_RULE = COMPOSE_START_RULES.CONTROLLED_NOT_CERTIFIABLE;
const PROCESS_PROVENANCE_RULE = COMPOSE_START_RULES.PROCESS_PROVENANCE_PLATFORM_UNVERIFIED;
const INPUT_HASH_RULE = COMPOSE_START_RULES.INPUT_HASH_MISMATCH;
const CONTROLLED_DEMAND: EnvironmentManifest['provenance'] = 'CONTROLLED';

export interface ComposeAdapterOptions {
  /** The only way this adapter can reach the daemon; built from the reviewed runner in `start.ts`. */
  command_port: ComposeCommandPort;
  /** Absolute run working directory that holds the compose document. */
  cwd: string;
  /** Environment this run authorises compose to interpolate; also the redaction secret set. */
  environment: Readonly<Record<string, string>>;
  /** Scheme per service. A service with no declared scheme yields no origin, never a guessed one. */
  service_protocols?: Readonly<Record<string, 'http' | 'https'>>;
  /** Which observed service is the backend and which is the frontend. Ambiguity is refused, not inferred. */
  service_roles?: Readonly<Record<string, 'backend' | 'frontend'>>;
  namespace_entropy?: () => string;
  owner_entropy?: () => string;
  instance_entropy?: () => string;
  profile_directories?: readonly string[];
  on_namespace?: (namespace: string, run_id: string) => void;
}

interface RunIdentity {
  namespace: string;
  owner_token: string;
  instance_id: string;
}

/** Everything prepare learned that the manifest alone cannot carry. */
export interface ComposePrepareDetail {
  identity: RunIdentity;
  diagnostics: Diagnostic[];
  bindings: ServicePortBinding[];
  authorizations: { decision: 'ALLOW' | 'DENY'; origin: string | null; reason: string }[];
  artifact_ids: string[];
  start: ComposeCommandResult | null;
  docker: DockerIdentities | null;
}

export class ComposeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeConfigurationError';
  }
}

type Scope = ComposeCommandRequest['scope'];

/** The daemon-side evidence prepare gathered, kept out of the manifest because the manifest has no field for it. */
interface PrepareEvidence {
  docker: DockerIdentities | null;
  start: ComposeCommandResult | null;
  effective: unknown;
}

export class ComposeAdapter implements EnvironmentPort {
  readonly command_port: ComposeCommandPort;
  private readonly identities = new Map<string, RunIdentity>();
  private readonly details = new Map<string, ComposePrepareDetail>();
  private readonly scopes = new Map<string, Scope>();

  constructor(readonly options: ComposeAdapterOptions) {
    this.command_port = options.command_port;
  }

  /** The project namespace this run owns, settled once per run so the ledger and the daemon agree. */
  namespaceFor(run_id: string): string {
    return this.identity(run_id, { run_id, check_id: SOURCE, attempt_id: 'attempt_settled' }).namespace;
  }

  detailFor(run_id: string): ComposePrepareDetail | null {
    return this.details.get(run_id) ?? null;
  }

  /** What the CLI and the daemon really report, through the same reviewed boundary as the create path. */
  async observeDockerIdentity(context: ExecutionContext): Promise<{
    daemon_reachable: boolean;
    server_version: string | null;
    compose_version: string | null;
    mechanism: string;
    cleanup: 'VERIFIED' | 'UNVERIFIED';
    executable_digest: string;
    commands: DockerIdentities['commands'];
  }> {
    const scope: Scope = { run_id: context.run_id, check_id: context.check_id, attempt_id: context.attempt_id };
    // Deliberately no this.identity(...) here: minting a project namespace is a claim about the run,
    // and answering "is the daemon reachable" must not allocate one or fire on_namespace.
    const observed = await observeDockerIdentities(this.command_port, scope, context.signal);
    return {
      daemon_reachable: observed.daemon_reachable,
      server_version: observed.server_version,
      compose_version: observed.compose_version,
      mechanism: observed.mechanism,
      cleanup: observed.cleanup,
      executable_digest: observed.executable_digest,
      commands: observed.commands,
    };
  }

  async prepare(request: EnvironmentRequest, context: ExecutionContext): Promise<EnvironmentManifest> {
    if (context.run_id !== request.run_id) {
      throw new ComposeConfigurationError(`the environment request is for ${request.run_id} while the execution context is ${context.run_id}`);
    }
    if (!/^run_[A-Za-z0-9_-]+$/.test(request.run_id)) throw new ComposeConfigurationError('a compose environment needs a valid run id');
    if (!SHA256.test(request.input_hash)) throw new ComposeConfigurationError('the environment input hash must be sixty-four lowercase hex characters');
    const configuration = request.configuration;
    if (configuration.mode !== 'compose') throw new ComposeConfigurationError('ComposeAdapter only prepares a compose environment');
    const configFile = path.resolve(this.options.cwd, configuration.compose_file);
    if (!path.isAbsolute(this.options.cwd)) throw new ComposeConfigurationError('the compose working directory must be absolute');

    const scope: Scope = { run_id: context.run_id, check_id: context.check_id, attempt_id: context.attempt_id };
    this.scopes.set(request.run_id, scope);
    const identity = this.identity(request.run_id, scope);
    const clock = () => context.clock.now();
    const refusals = new Refusals();
    const stop = (
      status: EnvironmentManifest['status'],
      extra: { resources?: EnvironmentManifest['resources']; detail?: PrepareEvidence; artifacts?: string[]; provenance?: EnvironmentManifest['provenance'] } = {},
    ): EnvironmentManifest =>
      this.manifest({
        request,
        identity,
        status,
        refusals,
        clock,
        resources: extra.resources ?? [],
        image_ids: [],
        bindings: undefined,
        provenance: extra.provenance ?? 'DECLARED',
        origin: { backend: null, frontend: null },
        detail: extra.detail ?? null,
        artifacts: extra.artifacts ?? [],
        data_revision: revisionFor(configuration.data_revision),
      });

    // Gate 1 · inputs this run must already have settled. No command is spawned on any of these paths.
    const revision = isConfirmedDataRevision(configuration.data_revision);
    if (!revision.ok) refusals.add(DATA_REVISION_RULE, revision.reason ?? 'the environment configuration carries no data revision', '/configuration/data_revision', 'CONFIG_INVALID');
    if (request.policy.minimum_provenance === CONTROLLED_DEMAND) {
      refusals.add(CONTROLLED_RULE, 'this profile demands controlled provenance, which a locally started compose environment cannot attest', '/policy/minimum_provenance', 'ENV_PROVENANCE_INSUFFICIENT');
    }
    const platform = provenanceCeiling({ platform: process.platform, runner_cleanup: null, start_evidence: false, independent_build_evidence: false });
    if (platform.level === 'DECLARED' && process.platform !== 'win32') {
      refusals.add(PROCESS_PROVENANCE_RULE, `${platform.reason ?? 'no creation identity is attestable'}; resources this run creates could not be owned, so nothing is created`, '/platform', 'UNSUPPORTED_CAPABILITY');
    }
    if (refusals.blocked) return stop('BLOCKED');

    // Gate 2 · the document as written, then the document as compose will actually apply it.
    const parsed = await loadComposeFile({ file: configuration.compose_file, cwd: this.options.cwd, environment: this.options.environment });
    if (!parsed.ok) {
      for (const diagnostic of parsed.diagnostics) refusals.add(diagnostic.rule_id ?? COMPOSE_START_RULES.DIAGNOSTIC_RULE_ID_MISSING, diagnostic.message, diagnostic.location, 'CONFIG_INVALID');
      return stop('BLOCKED');
    }
    const preflightOptions = {
      repository_prefix: '',
      project_directory: this.options.cwd,
      project_namespace: identity.namespace,
      profile_directories: this.options.profile_directories ?? [],
      restricted_pointers: parsed.restricted_pointers,
      build_accounting: await accountBuilds(parsed.config, this.options.cwd),
    };
    const declaredPlan = preflightCompose(parsed.config, request.policy, preflightOptions);
    for (const diagnostic of declaredPlan.diagnostics) refusals.add(diagnostic.rule_id ?? COMPOSE_START_RULES.DIAGNOSTIC_RULE_ID_MISSING, diagnostic.message, diagnostic.location, 'CONFIG_INVALID');
    if (!declaredPlan.approved) return stop('BLOCKED');

    const docker = await observeDockerIdentities(this.command_port, scope, context.signal);
    if (!docker.daemon_reachable) {
      refusals.add(COMPOSE_START_RULES.DAEMON_UNREACHABLE, 'the docker CLI could not reach a daemon (the server version probe exited non-zero)', '/observed/docker', 'TOOL_FAILURE');
      return stop('BLOCKED', { detail: { docker, start: null, effective: null } });
    }
    if (docker.compose_version === null) {
      // Measured on this host: without PROGRAMFILES in the CLI environment the compose plugin never loads,
      // so the CLI answers `unknown flag` for every compose invocation. Say that here instead of letting a
      // half-configured `up` fail with something nobody can read.
      refusals.add(COMPOSE_START_RULES.COMPOSE_UNAVAILABLE, 'the docker CLI is reachable but its compose plugin did not load, so this run cannot create the compose environment it planned', '/observed/docker', 'UNSUPPORTED_CAPABILITY');
      return stop('BLOCKED', { detail: { docker, start: null, effective: null } });
    }

    const render = await this.command_port.run({
      purpose: 'config',
      argv: ['compose', '--project-name', identity.namespace, '--project-directory', this.options.cwd, '-f', configFile, 'config', '--format', 'json'],
      project_namespace: identity.namespace,
      signal: context.signal,
      scope,
    });
    for (const diagnostic of render.diagnostics) refusals.add(diagnostic.rule_id ?? COMPOSE_START_RULES.DIAGNOSTIC_RULE_ID_MISSING, diagnostic.message, `/commands/${render.purpose}`, 'TOOL_FAILURE');
    let effective: unknown = null;
    let effectivePlan: ComposePreflightResult | null = null;
    if (render.exit_code !== 0) {
      const rule = startFailureRule(`${render.stderr}\n${render.stdout}`);
      refusals.add(rule, `docker compose config exited ${String(render.exit_code)}: ${summarise(render.stderr || render.stdout)}`, `/commands/${render.purpose}`, 'TOOL_FAILURE');
    } else {
      try {
        effective = JSON.parse(render.stdout) as unknown;
      } catch (error) {
        refusals.add(COMPOSE_START_RULES.CONFIGURATION_DRIFT, `the effective compose document is not readable JSON: ${(error as Error).message}`, '/commands/config', 'CONFIG_INVALID');
      }
      if (effective !== null) {
        effectivePlan = preflightCompose(effective, request.policy, preflightOptions);
        for (const diagnostic of effectivePlan.diagnostics) refusals.add(diagnostic.rule_id ?? COMPOSE_START_RULES.DIAGNOSTIC_RULE_ID_MISSING, diagnostic.message, `/effective${diagnostic.location}`, 'CONFIG_INVALID');
        for (const entry of planDrift(declaredPlan.resource_plan, effectivePlan.resource_plan)) {
          refusals.add(COMPOSE_START_RULES.CONFIGURATION_DRIFT, `the declared plan and the effective plan disagree about ${entry}; this run would create something it did not preflight`, '/effective', 'POLICY_WEAKEN_ATTEMPT');
        }
      }
    }
    if (effectivePlan === null || !effectivePlan.approved) {
      return stop('BLOCKED', { detail: { docker, start: null, effective }, artifacts: effective === null ? [] : [await this.storeEffective(context, String(render.stdout))] });
    }

    // Gate 3 · ownership. A namespace that already holds objects is somebody else's, and is never adopted.
    let preexisting: { containers: string[]; networks: string[]; volumes: string[] } | null = null;
    try {
      preexisting = await enumerateProjectResources(this.command_port, identity.namespace, scope, context.signal);
    } catch (error) {
      refusals.add(COMPOSE_START_RULES.LEDGER_INCOMPLETE, `resources under this namespace could not be enumerated before creating: ${(error as Error).message}`, '/observed/enumeration', 'TOOL_FAILURE');
    }
    if (preexisting !== null && preexisting.containers.length + preexisting.networks.length + preexisting.volumes.length > 0) {
      refusals.add(
        COMPOSE_START_RULES.RESOURCE_ADOPTION_REFUSED,
        `the namespace ${identity.namespace} already holds ${String(preexisting.containers.length)} container(s), ${String(preexisting.networks.length)} network(s) and ${String(preexisting.volumes.length)} volume(s); this run does not adopt resources it did not create`,
        '/observed/enumeration',
        'POLICY_WEAKEN_ATTEMPT',
      );
      const resources = buildResourceLedger({
        run_id: request.run_id,
        owner_token: identity.owner_token,
        created_at: clock(),
        creation: null,
        containers: preexisting.containers,
        networks: preexisting.networks,
        volumes: preexisting.volumes,
        not_owned: { containers: preexisting.containers, networks: preexisting.networks, volumes: preexisting.volumes },
      });
      return stop('BLOCKED', { resources, detail: { docker, start: null, effective } });
    }

    // Gate 4 · create only the services the approved plan carries.
    const services = configuredServices(effectivePlan.resource_plan, configuration.services, refusals);
    if (refusals.blocked) return stop('BLOCKED', { detail: { docker, start: null, effective } });
    const start = await this.command_port.run({
      purpose: 'up',
      argv: ['compose', '--project-name', identity.namespace, '--project-directory', this.options.cwd, '-f', configFile, 'up', '-d', '--no-build', ...services],
      project_namespace: identity.namespace,
      signal: context.signal,
      scope,
    });
    for (const diagnostic of start.diagnostics) refusals.add(diagnostic.rule_id ?? COMPOSE_START_RULES.DIAGNOSTIC_RULE_ID_MISSING, diagnostic.message, `/commands/${start.purpose}`, 'TOOL_FAILURE');
    const startFailed = start.exit_code !== 0;
    if (startFailed) {
      const combined = `${start.stderr}\n${start.stdout}`;
      const rule = startFailureRule(combined);
      refusals.add(rule, `compose up exited ${String(start.exit_code)}: ${summarise(start.stderr || start.stdout)} (classified ${classifyStartFailure(combined)})`, '/commands/up', rule === COMPOSE_START_RULES.DAEMON_UNREACHABLE ? 'TOOL_FAILURE' : 'ENV_PROVENANCE_INSUFFICIENT');
    }

    // Gate 5 · account for what exists, whether or not the start completed.
    let enumerated = { containers: [] as string[], networks: [] as string[], volumes: [] as string[] };
    let inspected: InspectedObject[] = [];
    let resources: EnvironmentManifest['resources'] = [];
    let image_ids: EnvironmentManifest['image_ids'] = [];
    try {
      enumerated = await enumerateProjectResources(this.command_port, identity.namespace, scope, context.signal);
      const ids = [...enumerated.containers, ...enumerated.networks, ...enumerated.volumes];
      inspected = ids.length === 0 ? [] : await inspectObjects(this.command_port, ids, scope, context.signal);
      resources = buildResourceLedger({ run_id: request.run_id, owner_token: identity.owner_token, created_at: clock(), creation: start.process, containers: enumerated.containers, networks: enumerated.networks, volumes: enumerated.volumes });
      image_ids = observedImageIds(inspected);
      if (resources.length !== ids.length) {
        refusals.add(COMPOSE_START_RULES.LEDGER_INCOMPLETE, `the daemon reports ${String(ids.length)} object(s) under this namespace while the ledger holds ${String(resources.length)}`, '/observed/resources', 'TOOL_FAILURE');
      }
      if (ids.length === 0 && !startFailed) {
        refusals.add(COMPOSE_START_RULES.LEDGER_INCOMPLETE, 'the start completed yet this run owns no resource, so nothing could be scoped or reclaimed', '/observed/resources', 'TOOL_FAILURE');
      }
    } catch (error) {
      refusals.add(COMPOSE_START_RULES.LEDGER_INCOMPLETE, `created resources could not be accounted for: ${(error as Error).message}`, '/observed/resources', 'TOOL_FAILURE');
    }

    // Gate 6 · read the published ports out of the inspected containers.
    const planned = planServiceBindings(effectivePlan.resource_plan.ports.map((entry) => ({ service: entry.service, network_alias: entry.service, container_port: entry.container_port, protocol: entry.protocol, host_ip: entry.host_ip })));
    const bindings: ServicePortBinding[] = [];
    const manifestBindings: NonNullable<EnvironmentManifest['bindings']> = {};
    for (const binding of planned) {
      const container = inspected.find((object) => {
        const facts = containerFacts(object);
        return facts.service === binding.service && facts.project === identity.namespace;
      });
      if (!container) {
        refusals.add(COMPOSE_START_RULES.SERVICE_NOT_RUNNING, `no container for service ${binding.service} exists under this namespace, so its published port cannot be read`, `/bindings/${binding.service}`, 'ENV_PROVENANCE_INSUFFICIENT');
        continue;
      }
      const facts = containerFacts(container);
      if (facts.state !== 'running') {
        refusals.add(COMPOSE_START_RULES.SERVICE_NOT_RUNNING, `service ${binding.service} is ${facts.state}, not running`, `/bindings/${binding.service}`, 'ENV_PROVENANCE_INSUFFICIENT');
      }
      const read = readPublishedBinding(container, binding.container_port, binding.protocol);
      if (read.status !== 'OBSERVED' || read.host_port === null || read.host_ip === null) {
        const rule = read.status === 'AMBIGUOUS' ? COMPOSE_START_RULES.HOST_BINDING_AMBIGUOUS : read.status === 'NOT_LOOPBACK' ? COMPOSE_START_RULES.HOST_BINDING_NOT_LOOPBACK : COMPOSE_START_RULES.HOST_BINDING_ABSENT;
        refusals.add(rule, `service ${binding.service} port ${String(binding.container_port)}/${binding.protocol} was reported as ${read.status} by docker inspect (${JSON.stringify(read.candidates)}); no host port is assumed`, `/bindings/${binding.service}`, 'ENV_PROVENANCE_INSUFFICIENT');
        continue;
      }
      const scheme = this.options.service_protocols?.[binding.service] ?? null;
      const recorded = recordObservedBindings(binding, scheme === null ? { host_ip: read.host_ip, host_port: read.host_port } : { host_ip: read.host_ip, host_port: read.host_port, scheme });
      bindings.push(recorded.binding);
      for (const diagnostic of recorded.diagnostics) refusals.add(diagnostic.rule_id ?? COMPOSE_START_RULES.DIAGNOSTIC_RULE_ID_MISSING, diagnostic.message, `/bindings/${binding.service}`, 'ENV_PROVENANCE_INSUFFICIENT');
      if (scheme === null) {
        refusals.add(COMPOSE_START_RULES.SERVICE_SCHEME_UNDECLARED, `service ${binding.service} has an observed loopback binding but no declared scheme, so no origin is derived`, `/bindings/${binding.service}`, 'ENV_PROVENANCE_INSUFFICIENT');
        continue;
      }
      if (!SAFE_ID.test(binding.service) || recorded.binding.host_origin === null || recorded.binding.host_port === null) {
        refusals.add(COMPOSE_START_RULES.SERVICE_ROLE_AMBIGUOUS, `the observed binding for ${binding.service} cannot be written into the manifest bindings`, `/bindings/${binding.service}`, 'CONFIG_INVALID');
        continue;
      }
      manifestBindings[binding.service] = {
        service: binding.service,
        container_port: binding.container_port,
        host_port: recorded.binding.host_port,
        protocol: scheme,
        publish_host: '127.0.0.1',
        container_id: facts.container_id,
        origin: recorded.binding.host_origin,
      };
    }

    const origin = this.origins(bindings, effectivePlan.resource_plan, refusals);
    const level = provenanceCeiling({ platform: process.platform, runner_cleanup: start.cleanup, start_evidence: !startFailed, independent_build_evidence: effectivePlan.resource_plan.builds.length > 0 });
    if (level.level !== 'OBSERVED') refusals.add(PROCESS_PROVENANCE_RULE, `${level.reason ?? 'the owned job was not confirmed reclaimed'}; the environment cannot be certified`, '/provenance/ceiling', 'ENV_PROVENANCE_INSUFFICIENT');
    if (Object.keys(manifestBindings).length === 0 && !startFailed) {
      refusals.add(COMPOSE_START_RULES.HOST_BINDING_ABSENT, 'no authorized container port received an observed loopback host binding, so this environment exposes nothing this run can name', '/bindings', 'ENV_PROVENANCE_INSUFFICIENT');
    }

    // Gate 7 · write the declared/observed snapshot before saying anything about readiness.
    const artifacts: string[] = [await this.storeEffective(context, String(render.stdout))];
    const authorizations = bindings.map((binding) => authorizeBindingOrigin(binding, { allowed_origins: request.policy.allowed_origins }));
    const snapshot = composeProvenanceSnapshot({
      run_id: request.run_id,
      environment_id: request.environment_id,
      project_namespace: identity.namespace,
      owner_token: identity.owner_token,
      instance_id: identity.instance_id,
      input_hash: request.input_hash,
      data_revision: configuration.data_revision,
      policy: { policy_id: request.policy.policy_id, policy_hash: request.policy.policy_hash, minimum_provenance: request.policy.minimum_provenance },
      declared: {
        compose_file: configuration.compose_file,
        compose_file_digest: digestOfText(String(render.stdout)),
        requested_image_refs: effectivePlan.resource_plan.services.map((service) => service.image),
        services: services.slice(),
        declared_container_ports: effectivePlan.resource_plan.ports.map((entry) => `${entry.service}:${String(entry.container_port)}/${entry.protocol}@${entry.host_ip ?? 'unspecified'}`),
        mounts: effectivePlan.resource_plan.mounts,
        builds: effectivePlan.resource_plan.builds,
        restricted_references: effectivePlan.resource_plan.restricted_references,
        resource_plan_counts: effectivePlan.resource_plan.counts,
        profile_directories: (this.options.profile_directories ?? []).length,
      },
      observed: {
        docker_server_version: docker.server_version,
        compose_version: docker.compose_version,
        executable_digest: docker.executable_digest,
        command_mechanism: docker.mechanism,
        owned_job_cleanup: docker.cleanup,
        commands: [...docker.commands, { purpose: start.purpose, argv: start.argv, exit_code: start.exit_code }],
        command_diagnostics: docker.diagnostics,
        start_process_identity: start.process,
        image_ids,
        containers: inspected.filter(isContainerObject).map(containerFacts),
        networks: inspected.filter((object) => typeof object.Id === 'string' && object.Name !== undefined && !isContainerObject(object)).map(networkFacts),
        bindings: bindings.map((binding) => ({
          service: binding.service,
          container_port: binding.container_port,
          host_ip: binding.host_ip,
          host_port: binding.host_port,
          scheme: binding.scheme,
          provenance: binding.provenance,
          internal_target: binding.internal_target,
          host_origin: binding.host_origin,
          authorization_rule: binding.authorization_rule,
        })),
        authorizations,
        ledger: resources,
      },
      provenance: { level: level.level, ceiling_reason: level.reason, ci_flag_observed: ciFlagPresent(this.options.environment) },
      recorded_at: clock(),
    });
    artifacts.push(await this.storeText(context, { name: 'compose-start-evidence.json', text: stableStringify(snapshot), kind: 'report', sensitivity: 'restricted' }));
    artifacts.push(await this.storeText(context, { name: 'compose-resource-snapshot.json', text: stableStringify({ schema_version: '0.1', kind: 'stackgate-compose-resources', run_id: request.run_id, project_namespace: identity.namespace, owner_token: identity.owner_token, resources, enumerated, bindings: manifestBindings, recorded_at: clock() }), kind: 'report', sensitivity: 'regular' }));

    const status: EnvironmentManifest['status'] = refusals.blocked ? (startFailed && start.status === 'ERROR' ? 'ERROR' : 'BLOCKED') : 'READY';
    return this.manifest({
      request,
      identity,
      status,
      refusals,
      clock,
      resources,
      image_ids,
      bindings: Object.keys(manifestBindings).length > 0 ? manifestBindings : undefined,
      provenance: bindings.some((binding) => binding.observed) ? level.level : 'DECLARED',
      origin,
      detail: { docker, start, effective },
      artifacts,
      data_revision: revisionFor(configuration.data_revision),
      bindings_observed: bindings,
      authorizations,
    });
  }

  /** Re-read what this run owns and compare it with the prepare ledger; create nothing while doing so. */
  async observe(request: { manifest: EnvironmentManifest; expected_input_hash: string; signal: AbortSignal }): Promise<EnvironmentManifest> {
    const refusals = new Refusals();
    const scope = this.scopes.get(request.manifest.run_id) ?? null;
    const identity = this.identities.get(request.manifest.run_id) ?? null;
    if (request.expected_input_hash !== request.manifest.input_hash) {
      refusals.add(INPUT_HASH_RULE, `the manifest records input hash ${request.manifest.input_hash}, not ${request.expected_input_hash}`, '/observed/input_hash', 'INPUT_STALE');
    }
    if (scope === null || identity === null) {
      refusals.add(COMPOSE_START_RULES.SCOPE_UNSETTLED, 'this adapter never prepared the run, so it has no namespace to re-read', '/observed', 'ENV_PROVENANCE_INSUFFICIENT');
    }
    if (refusals.blocked) {
      return { ...withoutBindings(request.manifest), status: 'BLOCKED', reasons: refusals.reasons };
    }
    let enumerated = { containers: [] as string[], networks: [] as string[], volumes: [] as string[] };
    let inspected: InspectedObject[] = [];
    try {
      enumerated = await enumerateProjectResources(this.command_port, identity!.namespace, scope!, request.signal);
      const ids = [...enumerated.containers, ...enumerated.networks, ...enumerated.volumes];
      inspected = ids.length === 0 ? [] : await inspectObjects(this.command_port, ids, scope!, request.signal);
    } catch (error) {
      refusals.add(COMPOSE_START_RULES.LEDGER_INCOMPLETE, `the running environment could not be re-read: ${(error as Error).message}`, '/observed', 'TOOL_FAILURE');
      return { ...request.manifest, status: 'ERROR', reasons: refusals.reasons };
    }
    const ledger = new Set(request.manifest.resources.map((resource) => resource.native_id));
    const live = new Set([...enumerated.containers, ...enumerated.networks, ...enumerated.volumes]);
    for (const id of ledger) {
      if (!live.has(id)) refusals.add(COMPOSE_START_RULES.CONTINUITY_BROKEN, `resource ${id} was recorded at prepare and is no longer under this namespace`, '/observed', 'ENV_PROVENANCE_INSUFFICIENT');
    }
    for (const id of live) {
      if (!ledger.has(id)) refusals.add(COMPOSE_START_RULES.RESOURCE_ADOPTION_REFUSED, `resource ${id} is under this namespace but was never recorded in the prepare ledger`, '/observed', 'POLICY_WEAKEN_ATTEMPT');
    }
    for (const [service, binding] of Object.entries(request.manifest.bindings ?? {})) {
      const container = inspected.find((object) => containerFacts(object).container_id === binding.container_id);
      if (!container) {
        refusals.add(COMPOSE_START_RULES.CONTINUITY_BROKEN, `service ${service} container ${binding.container_id} is gone; the instance this run certified is not the instance running`, '/observed', 'ENV_INSTANCE_MISMATCH');
        continue;
      }
      const facts = containerFacts(container);
      if (facts.state !== 'running') refusals.add(COMPOSE_START_RULES.SERVICE_NOT_RUNNING, `service ${service} is ${facts.state} at observation time`, '/observed', 'ENV_PROVENANCE_INSUFFICIENT');
      const read = readPublishedBinding(container, binding.container_port, 'tcp');
      if (read.status !== 'OBSERVED' || read.host_port !== binding.host_port || read.host_ip !== binding.publish_host) {
        refusals.add(COMPOSE_START_RULES.HOST_BINDING_CHANGED, `service ${service} now reports ${read.status} (${JSON.stringify(read.candidates)}) instead of ${binding.publish_host}:${String(binding.host_port)}`, '/observed', 'ENV_PROVENANCE_INSUFFICIENT');
      }
    }
    return {
      ...request.manifest,
      status: refusals.blocked ? 'BLOCKED' : request.manifest.status,
      reasons: refusals.reasons,
      image_ids: observedImageIds(inspected),
      resources: request.manifest.resources.map((resource) => ({ ...resource })),
    };
  }

  /**
   * SG-061 owns reclaiming. This method therefore deletes nothing: it hands every resource back as
   * preserved with a refusal diagnostic naming the task that owns the cleanup policy. A run that needs its
   * resources gone must not get a partial, adapter-invented cleanup here.
   */
  async cleanup(request: { run_id: string; owner_token: string; resources: readonly EnvironmentManifest['resources'][number][]; signal: AbortSignal }): Promise<CleanupResult> {
    const diagnostic = startDiagnostic(
      COMPOSE_START_RULES.CLEANUP_RESERVED,
      'compose resources are reclaimed by SG-061, which owns the cleanup policy and the test-data boundary; this run leaves every resource it created pending so nothing is deleted without that policy',
      `/runs/${request.run_id}/resources`,
      { run_id: request.run_id, owner_token: request.owner_token, resource_count: request.resources.length },
      'implement the per-resource reclaim in SG-061 against this ledger; never widen the command boundary here',
    );
    return { cleaned: [], preserved: request.resources.map((resource) => ({ ...resource })), failed: [], diagnostics: [diagnostic] };
  }

  private identity(run_id: string, scope: Scope): RunIdentity {
    const existing = this.identities.get(run_id);
    if (existing) return existing;
    const identity: RunIdentity = {
      namespace: composeProjectNamespace(run_id, this.options.namespace_entropy?.()),
      owner_token: composeOwnerToken(this.options.owner_entropy?.()),
      instance_id: composeInstanceId(this.options.instance_entropy?.()),
    };
    this.identities.set(run_id, identity);
    if (!this.scopes.has(run_id)) this.scopes.set(run_id, scope);
    this.options.on_namespace?.(identity.namespace, run_id);
    return identity;
  }

  /** Backend and frontend origins are read off the observed bindings for the roles this run was given. */
  private origins(bindings: readonly ServicePortBinding[], plan: ComposeResourcePlan, refusals: Refusals): { backend: string | null; frontend: string | null } {
    const roles: Record<string, 'backend' | 'frontend'> = { ...(this.options.service_roles ?? {}) };
    if (Object.keys(roles).length === 0 && plan.services.length === 1) roles[plan.services[0]!.name] = 'backend';
    const output = { backend: null as string | null, frontend: null as string | null };
    for (const binding of bindings) {
      const role = roles[binding.service];
      if (role === undefined) {
        if (bindings.length > 1) refusals.add(COMPOSE_START_RULES.SERVICE_ROLE_AMBIGUOUS, `service ${binding.service} has an observed binding but no confirmed backend/frontend role, so no host origin is guessed into the manifest`, `/bindings/${binding.service}`, 'ENV_PROVENANCE_INSUFFICIENT');
        continue;
      }
      if (binding.host_origin === null) continue;
      if (output[role] !== null && output[role] !== binding.host_origin) {
        refusals.add(COMPOSE_START_RULES.SERVICE_ROLE_AMBIGUOUS, `two services claim the ${role} origin, so the manifest would have to choose and does not`, `/bindings/${binding.service}`, 'CONFIG_INVALID');
        continue;
      }
      output[role] = binding.host_origin;
    }
    return output;
  }

  /** `docker compose config` can echo interpolated values, so the stored bytes are always redacted. */
  private async storeEffective(context: ExecutionContext, text: string): Promise<string> {
    let canonical = text;
    try {
      canonical = stableStringify(JSON.parse(text) as unknown);
    } catch {
      canonical = text;
    }
    return this.storeText(context, { name: 'compose-effective-config.json', text: redactComposeEvidence(canonical, this.options.environment), kind: 'report', sensitivity: 'restricted' });
  }

  private async storeText(context: ExecutionContext, input: { name: string; text: string; kind: ArtifactWrite['artifact_kind']; sensitivity: ArtifactWrite['sensitivity'] }): Promise<string> {
    const artifact = await context.artifacts.store({ name: input.name, media_type: 'application/json', bytes: Buffer.from(input.text, 'utf8'), artifact_kind: input.kind, sensitivity: input.sensitivity, redaction_state: 'REDACTED' });
    return artifact.artifact_id;
  }

  private manifest(input: ManifestInput): EnvironmentManifest {
    const manifest: EnvironmentManifest = {
      schema_version: '0.1',
      run_id: input.request.run_id,
      mode: 'compose',
      status: input.status,
      frontend_origin: input.origin.frontend,
      backend_origin: input.origin.backend,
      instance_id: input.identity.instance_id,
      provenance: input.provenance,
      input_hash: input.request.input_hash,
      image_ids: input.image_ids,
      resources: input.resources,
      data_revision: input.data_revision,
      observations: input.artifacts,
      reasons: input.refusals.reasons,
    };
    if (input.bindings !== undefined && Object.keys(input.bindings).length > 0) manifest.bindings = input.bindings;
    this.details.set(input.request.run_id, {
      identity: input.identity,
      diagnostics: input.refusals.diagnostics,
      bindings: input.bindings_observed ?? [],
      authorizations: input.authorizations ?? [],
      artifact_ids: input.artifacts,
      start: input.detail?.start ?? null,
      docker: input.detail?.docker ?? null,
    });
    return manifest;
  }
}

interface ManifestInput {
  request: EnvironmentRequest;
  identity: RunIdentity;
  status: EnvironmentManifest['status'];
  refusals: Refusals;
  clock: () => string;
  resources: EnvironmentManifest['resources'];
  image_ids: EnvironmentManifest['image_ids'];
  bindings: EnvironmentManifest['bindings'] | undefined;
  provenance: EnvironmentManifest['provenance'];
  origin: { backend: string | null; frontend: string | null };
  detail: { docker: DockerIdentities | null; start: ComposeCommandResult | null; effective: unknown } | null;
  artifacts: string[];
  data_revision: string;
  bindings_observed?: ServicePortBinding[];
  authorizations?: { decision: 'ALLOW' | 'DENY'; origin: string | null; reason: string }[];
}

/** A refusal keeps its machine-readable id in `reasons` and the full diagnostic next to it. */
class Refusals {
  private readonly entries: Diagnostic[] = [];
  get reasons(): string[] {
    return [...new Set(this.entries.map((diagnostic) => diagnostic.rule_id ?? COMPOSE_START_RULES.DIAGNOSTIC_RULE_ID_MISSING))];
  }
  get diagnostics(): Diagnostic[] {
    return this.entries.map((diagnostic) => ({ ...diagnostic }));
  }
  get blocked(): boolean {
    return this.entries.length > 0;
  }
  add(rule: NonNullable<Diagnostic['rule_id']>, message: string, location: string, code: ReasonCode = 'ENV_PROVENANCE_INSUFFICIENT'): void {
    const known = (Object.values(COMPOSE_START_RULES) as string[]).includes(rule);
    this.entries.push(
      known
        ? startDiagnostic(rule as StartRule, message, location, { rule })
        : { code, rule_id: rule, message, location, observed_facts: { rule }, recommended_action: 'repair the run inputs or the environment; never widen the compose command boundary to work around a refusal', source: SOURCE },
    );
  }
}

function revisionFor(value: string): string {
  return isConfirmedDataRevision(value).ok ? value : 'UNCONFIRMED';
}

function ciFlagPresent(environment: Readonly<Record<string, string>>): boolean {
  return Object.entries(environment).some(([key, value]) => /^(?:CI|GITHUB_ACTIONS|GITLAB_CI)$/u.test(key) && value.length > 0 && value !== 'false' && value !== '0');
}

function isContainerObject(object: InspectedObject): boolean {
  return typeof object.Id === 'string' && object.NetworkSettings !== undefined && asRecord(object.Config) !== null;
}

/** Only services the approved plan carries may be started; a missing one is a refusal, not a guess. */
function configuredServices(plan: ComposeResourcePlan, configured: readonly string[], refusals: Refusals): string[] {
  const approved = new Set(plan.services.map((service) => service.name));
  for (const service of configured) {
    if (!approved.has(service)) refusals.add(COMPOSE_START_RULES.SERVICES_NOT_IN_PLAN, `service ${service} is configured for this environment but the preflighted plan does not carry it`, `/services/${service}`, 'CONFIG_INVALID');
  }
  return configured.filter((service) => approved.has(service));
}

/** What the document said versus what compose says it will do. */
function planDrift(declared: ComposeResourcePlan, effective: ComposeResourcePlan): string[] {
  const fingerprint = (plan: ComposeResourcePlan): Record<string, string> => ({
    services: [...plan.services.map((service) => service.name)].sort().join(','),
    ports: [...plan.ports.map((port) => `${port.service}:${String(port.container_port)}/${port.protocol}@${port.host_ip ?? 'unspecified'}`)].sort().join(','),
    networks: [...plan.networks.map((network) => network.name)].sort().join(','),
    volumes: [...plan.volumes.map((volume) => volume.name)].sort().join(','),
    mounts: [...plan.mounts.map((mount) => `${mount.service}:${String(mount.source)}->${mount.target}:${String(mount.read_only)}`)].sort().join(','),
    builds: [...plan.builds.map((build) => `${build.service}:${build.context}`)].sort().join(','),
  });
  const before = fingerprint(declared);
  const after = fingerprint(effective);
  const drift: string[] = [];
  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) drift.push(`${key} (declared ${String(before[key])} versus effective ${String(after[key])})`);
  }
  return drift;
}

/** The build inputs of every declared context, accounted from the real directory the daemon will read. */
async function accountBuilds(config: unknown, cwd: string): Promise<Record<string, Awaited<ReturnType<typeof accountBuildInputs>>>> {
  const output: Record<string, Awaited<ReturnType<typeof accountBuildInputs>>> = {};
  const services = asRecord(asRecord(config)?.services);
  for (const [name, body] of Object.entries(services ?? {})) {
    const build = asRecord(body)?.build;
    if (build === undefined) continue;
    const context = typeof build === 'string' ? build : String(asRecord(build)?.context ?? '.');
    output[name] = await accountBuildInputs(cwd, context);
  }
  return output;
}

/** Key order is fixed by a sorted clone, so the stored evidence bytes are diffable between runs. */
function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  const record = asRecord(value);
  if (!record) return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) output[key] = sortDeep(record[key]);
  return output;
}

function summarise(text: string): string {
  const first = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0)[0] ?? '';
  return first.slice(0, 300);
}

/**
 * A blocked observation must not carry a bindings claim: the adapter refused to establish the
 * environment, so any port or origin it had listed says nothing about what is running now.
 */
function withoutBindings(manifest: EnvironmentManifest): Omit<EnvironmentManifest, 'bindings'> {
  const copy = { ...manifest } as Partial<EnvironmentManifest>;
  delete copy.bindings;
  return copy as Omit<EnvironmentManifest, 'bindings'>;
}
