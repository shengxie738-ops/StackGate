import path from 'node:path';
import type { Diagnostic, EffectivePolicy, ReasonCode } from '../../contracts/src/index.js';
import { matchesPath, validatePathPattern } from '../../core/src/domain/path-pattern.js';
import { asRecord, credentialBearing, inside, type BuildInputAccounting } from './config.js';
import { isLoopbackAddress, planServiceBindings, type DeclaredPortTarget, type ServicePortBinding } from './target-bindings.js';

/**
 * Compose configuration safety preflight (SG-057).
 *
 * Pure text reasoning over an already-resolved effective configuration: it creates nothing, spawns
 * nothing, reads nothing from the host and refuses before any resource could exist. An unknown or
 * unvalidated shape is refused rather than coerced into a permissive default.
 */

const PREFIX = 'SG-POLICY-COMPOSE-';
const SOURCE = 'compose-preflight';

/** Every refusal this module can emit. Later tasks bind against these exact rule ids. */
export const COMPOSE_REFUSAL_CODES = {
  CONFIG_UNVALIDATED: 'SG-POLICY-COMPOSE-CONFIG-UNVALIDATED',
  POLICY_INVALID: 'SG-POLICY-COMPOSE-POLICY-INVALID',
  TOPLEVEL_UNKNOWN: 'SG-POLICY-COMPOSE-TOPLEVEL-UNKNOWN',
  UNKNOWN_FIELD: 'SG-POLICY-COMPOSE-UNKNOWN-FIELD',
  UNSUPPORTED_SECTION: 'SG-POLICY-COMPOSE-UNSUPPORTED-SECTION',
  EMPTY_PLAN: 'SG-POLICY-COMPOSE-EMPTY-RESOURCE-PLAN',
  INTERPOLATION_UNRESOLVED: 'SG-POLICY-COMPOSE-INTERPOLATION-UNRESOLVED',
  CONTAINER_NAME_FIXED: 'SG-POLICY-COMPOSE-CONTAINER-NAME-FIXED',
  PROJECT_NAME_PINNED: 'SG-POLICY-COMPOSE-PROJECT-NAME-PINNED',
  RESOURCE_NAME_PINNED: 'SG-POLICY-COMPOSE-RESOURCE-NAME-PINNED',
  PRIVILEGED: 'SG-POLICY-COMPOSE-PRIVILEGED',
  CAP_DANGEROUS: 'SG-POLICY-COMPOSE-CAP-DANGEROUS',
  SECURITY_UNCONFINED: 'SG-POLICY-COMPOSE-SECURITY-UNCONFINED',
  NETWORK_MODE_HOST: 'SG-POLICY-COMPOSE-NETWORK-MODE-HOST',
  NETWORK_MODE_UNSCOPED: 'SG-POLICY-COMPOSE-NETWORK-MODE-UNSCOPED',
  HOST_ISOLATION: 'SG-POLICY-COMPOSE-HOST-ISOLATION',
  NETWORK_UNDECLARED: 'SG-POLICY-COMPOSE-NETWORK-UNDECLARED',
  NETWORK_EXTERNAL: 'SG-POLICY-COMPOSE-NETWORK-EXTERNAL',
  NETWORK_DRIVER: 'SG-POLICY-COMPOSE-NETWORK-DRIVER',
  VOLUME_EXTERNAL: 'SG-POLICY-COMPOSE-VOLUME-EXTERNAL',
  VOLUME_MALFORMED: 'SG-POLICY-COMPOSE-VOLUME-MALFORMED',
  DEVICE_PASSTHROUGH: 'SG-POLICY-COMPOSE-DEVICE-PASSTHROUGH',
  VOLUME_FROM: 'SG-POLICY-COMPOSE-VOLUME-FROM',
  RESTART_OUTLIVES_RUN: 'SG-POLICY-COMPOSE-RESTART-OUTLIVES-RUN',
  PULL_POLICY: 'SG-POLICY-COMPOSE-PULL-POLICY',
  HOST_GATEWAY: 'SG-POLICY-COMPOSE-HOST-GATEWAY',
  DOCKER_SOCKET_MOUNT: 'SG-POLICY-COMPOSE-DOCKER-SOCKET-MOUNT',
  PATH_HOST_ROOT: 'SG-POLICY-COMPOSE-PATH-HOST-ROOT',
  PATH_HOME: 'SG-POLICY-COMPOSE-PATH-HOME',
  PATH_ESCAPES_RUN: 'SG-POLICY-COMPOSE-PATH-ESCAPES-RUN',
  PATH_OUTSIDE_POLICY: 'SG-POLICY-COMPOSE-PATH-OUTSIDE-POLICY',
  MOUNT_WRITABLE_UNDECLARED: 'SG-POLICY-COMPOSE-MOUNT-WRITABLE-UNDECLARED',
  PORT_FIXED_HOST: 'SG-POLICY-COMPOSE-PORT-FIXED-HOST',
  PORT_NOT_LOOPBACK: 'SG-POLICY-COMPOSE-PORT-NOT-LOOPBACK',
  PORT_MALFORMED: 'SG-POLICY-COMPOSE-PORT-MALFORMED',
  DSN_EXTERNAL_HOST: 'SG-POLICY-COMPOSE-DSN-EXTERNAL-HOST',
  CREDENTIAL_HARDCODED: 'SG-POLICY-COMPOSE-CREDENTIAL-HARDCODED',
  IMAGE_UNPINNED: 'SG-POLICY-COMPOSE-IMAGE-UNPINNED',
  IMAGE_DIGEST_MALFORMED: 'SG-POLICY-COMPOSE-IMAGE-DIGEST-MALFORMED',
  BUILD_CONTEXT_REMOTE: 'SG-POLICY-COMPOSE-BUILD-CONTEXT-REMOTE',
  BUILD_INPUTS_UNACCOUNTED: 'SG-POLICY-COMPOSE-BUILD-INPUTS-UNACCOUNTED',
  BUILD_SSH: 'SG-POLICY-COMPOSE-BUILD-SSH',
  BUILD_SECRET: 'SG-POLICY-COMPOSE-BUILD-SECRET',
  BINDING_NOT_OBSERVED: 'SG-POLICY-COMPOSE-BINDING-NOT-OBSERVED',
  BINDING_SCHEME_UNDECLARED: 'SG-POLICY-COMPOSE-BINDING-SCHEME-UNDECLARED',
  BINDING_ORIGIN_UNAUTHORIZED: 'SG-POLICY-COMPOSE-BINDING-ORIGIN-UNAUTHORIZED',
  BINDING_HOST_NOT_LOOPBACK: 'SG-POLICY-COMPOSE-BINDING-HOST-NOT-LOOPBACK',
} as const satisfies Record<string, `${typeof PREFIX}${string}`>;

type ComposeCode = typeof COMPOSE_REFUSAL_CODES[keyof typeof COMPOSE_REFUSAL_CODES];

/** Structural failures get CONFIG_INVALID; boundary escapes get POLICY_WEAKEN_ATTEMPT. */
const CONFIG_SHAPED: ReadonlySet<ComposeCode> = new Set<ComposeCode>([
  COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED,
  COMPOSE_REFUSAL_CODES.POLICY_INVALID,
  COMPOSE_REFUSAL_CODES.TOPLEVEL_UNKNOWN,
  COMPOSE_REFUSAL_CODES.UNKNOWN_FIELD,
  COMPOSE_REFUSAL_CODES.UNSUPPORTED_SECTION,
  COMPOSE_REFUSAL_CODES.EMPTY_PLAN,
  COMPOSE_REFUSAL_CODES.INTERPOLATION_UNRESOLVED,
  COMPOSE_REFUSAL_CODES.PORT_MALFORMED,
  COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED,
  COMPOSE_REFUSAL_CODES.IMAGE_UNPINNED,
  COMPOSE_REFUSAL_CODES.IMAGE_DIGEST_MALFORMED,
]);

const DANGEROUS_CAPS = new Set(['ALL', 'SYS_ADMIN', 'SYS_PTRACE', 'SYS_MODULE', 'SYS_BOOT', 'SYS_RAWIO', 'DAC_READ_SEARCH', 'DAC_OVERRIDE', 'NET_ADMIN', 'NET_RAW', 'LINUX_IMMUTABLE', 'SETFCAP', 'BPF', 'PERFMON', 'TRACEFS']);
const TOPLEVEL_KNOWN = new Set(['services', 'networks', 'volumes', 'name', 'version']);
const TOPLEVEL_UNSUPPORTED = new Set(['include', 'configs', 'secrets']);
const SERVICE_FIELDS = new Set([
  'image', 'build', 'ports', 'expose', 'environment', 'env_file', 'volumes', 'tmpfs', 'networks', 'network_mode', 'privileged',
  'cap_add', 'cap_drop', 'security_opt', 'container_name', 'hostname', 'command', 'entrypoint', 'user', 'working_dir', 'labels',
  'depends_on', 'healthcheck', 'restart', 'pull_policy', 'read_only', 'ulimits', 'dns', 'dns_search', 'extra_hosts', 'profiles',
  'platform', 'init', 'shm_size', 'stop_signal', 'stop_grace_period', 'sysctls', 'tty', 'stdin_open', 'deploy', 'pid', 'ipc', 'uts',
  'oom_kill_disable', 'oom_score_adj', 'group_add', 'isolation', 'runtime', 'cgroup',
]);
const BUILD_FIELDS = new Set(['context', 'dockerfile', 'dockerfile_inline', 'args', 'ssh', 'secrets', 'secret_envfiles', 'additional_contexts', 'contexts', 'network', 'target', 'tags', 'platforms', 'no_cache', 'pull', 'cache_from', 'cache_to', 'extra_hosts', 'isolation', 'privileged', 'labels', 'shm_size']);
const NETWORK_FIELDS = new Set(['name', 'driver', 'driver_opts', 'attachable', 'internal', 'ipam', 'external', 'labels']);
const VOLUME_FIELDS = new Set(['name', 'driver', 'driver_opts', 'external', 'labels']);
const VOLUME_ITEM_FIELDS = new Set(['type', 'source', 'target', 'read_only', 'consistency', 'bind', 'volume', 'selinux']);
const PORT_ITEM_FIELDS = new Set(['name', 'host_ip', 'published', 'target', 'mode', 'protocol', 'app_protocol']);
const REMOTE_SCHEME = /^[a-z][a-z0-9+.-]*:\/\/\S*$/iu;
const INTERPOLATION_TOKEN = /\$(?:\{[^{}]*\}|[A-Za-z_][A-Za-z0-9_]*)/u;
const DOCKER_SOCKET_PATHS = new Set(['/var/run/docker.sock', '/run/docker.sock', '//./pipe/docker_engine', '//./pipe/docker_pipe', '//./pipe/multipassdocker']);

export interface ComposeResourcePlan {
  source: 'DECLARED';
  ownership: 'run-scoped-only';
  /** Null unless the configuration itself carries a project name; the run namespace is never invented here. */
  project_namespace: string | null;
  services: { name: string; image: string | null; build: string | null; networks: string[] }[];
  networks: { name: string; internal: boolean; declared: boolean }[];
  volumes: { name: string }[];
  ports: { service: string; container_port: number; protocol: 'tcp' | 'udp'; host_ip: string | null; published: number | null }[];
  exposed: { service: string; container_port: number; protocol: 'tcp' | 'udp' }[];
  mounts: { service: string; kind: 'bind' | 'volume' | 'tmpfs'; source: string | null; target: string; read_only: boolean | null }[];
  builds: { service: string; context: string; dockerfile: string | null; ignored_inputs_declared: boolean; accounted_entries: number }[];
  restricted_references: { pointer: string; sensitivity: 'restricted'; source: 'interpolation' | 'env_file' }[];
  counts: { services: number; networks: number; volumes: number; ports: number; mounts: number; builds: number };
}

export interface ComposePreflightResult { approved: boolean; diagnostics: Diagnostic[]; resource_plan: ComposeResourcePlan; bindings: ServicePortBinding[] }

export interface PreflightOptions {
  /** Repository-relative path of the compose project directory; empty string means the repository root. */
  repository_prefix?: string;
  /** Absolute host path of that same directory, because `docker compose config` resolves bind sources absolutely. */
  project_directory?: string;
  /** Project name this run will use. A configuration name that differs from it is a pinned identity. */
  project_namespace?: string;
  /** Absolute host profile directories the caller declares off-limits; preflight never reads the environment itself. */
  profile_directories?: readonly string[];
  restricted_pointers?: readonly string[];
  build_accounting?: Readonly<Record<string, BuildInputAccounting>>;
}

interface ResolvedPolicy { allowed_paths: string[]; allowed_origins: string[]; writable_roots: string[] }

export function preflightCompose(effectiveConfig: unknown, policy: EffectivePolicy, options: PreflightOptions = {}): ComposePreflightResult {
  const diagnostics: Diagnostic[] = [];
  const resolved = resolvePolicy(policy, diagnostics);
  if (!resolved) return { approved: false, diagnostics, resource_plan: emptyPlan(), bindings: [] };

  const config = asRecord(effectiveConfig);
  if (!config || Object.keys(config).length === 0) {
    return { approved: false, diagnostics: [refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'The effective configuration is not a non-empty mapping, so nothing can be reasoned about it.', '/', { shape: shapeOf(effectiveConfig) })], resource_plan: emptyPlan(), bindings: [] };
  }

  const plan = emptyPlan();
  for (const key of Object.keys(config)) {
    if (key.startsWith('x-')) continue;
    if (TOPLEVEL_UNSUPPORTED.has(key)) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.UNSUPPORTED_SECTION, `Top-level ${key} brings in resources and inputs this preflight cannot reason about.`, `/${key}`, { section: key }));
    else if (!TOPLEVEL_KNOWN.has(key)) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.TOPLEVEL_UNKNOWN, `Unknown top-level configuration shape ${key}.`, `/${key}`, { section: key }));
  }

  const declaredName = typeof config.name === 'string' ? config.name : null;
  plan.project_namespace = declaredName;
  const namespace = options.project_namespace ?? declaredName;
  if (declaredName !== null && declaredName !== options.project_namespace) {
    diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.PROJECT_NAME_PINNED, 'The configuration pins a project name this run did not choose, so resource identity is not run-scoped.', '/name', { declared: declaredName, run_namespace: options.project_namespace ?? null }));
  }

  const networks = sections(config.networks, '/networks', diagnostics, NETWORK_FIELDS);
  const volumes = sections(config.volumes, '/volumes', diagnostics, VOLUME_FIELDS);
  for (const [name, entry] of networks.entries()) {
    const record = entry ?? {};
    checkResourceName(record, name, namespace, `/networks/${name}`, diagnostics);
    if (record.external !== undefined) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.NETWORK_EXTERNAL, 'The network is external, so this run does not own it and cannot scope cleanup to it.', `/networks/${name}/external`, { network: name }));
    const driver = record.driver;
    if (driver !== undefined && driver !== null && driver !== 'bridge') diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.NETWORK_DRIVER, 'Only the project-scoped bridge driver is authorised for this run.', `/networks/${name}/driver`, { network: name }));
    plan.networks.push({ name, internal: record.internal === true, declared: true });
  }
  const declaredVolumes = new Set<string>();
  for (const [name, entry] of volumes.entries()) {
    const record = entry ?? {};
    checkResourceName(record, name, namespace, `/volumes/${name}`, diagnostics);
    if (record.external !== undefined) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_EXTERNAL, 'The volume is external, so this run does not own the data inside it.', `/volumes/${name}/external`, { volume: name }));
    declaredVolumes.add(name);
    plan.volumes.push({ name });
  }

  if (!('services' in config)) {
    diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.EMPTY_PLAN, 'The configuration declares no service section, so the run would own no resource to scope or clean up.', '/', {}));
    return { approved: false, diagnostics, resource_plan: plan, bindings: [] };
  }
  const services = asRecord(config.services);
  if (!services) {
    diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'services must be a mapping of service name to definition.', '/services', { shape: shapeOf(config.services) }));
    return { approved: false, diagnostics, resource_plan: plan, bindings: [] };
  }
  const serviceNames = Object.keys(services);
  if (serviceNames.length === 0) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.EMPTY_PLAN, 'The configuration declares no service, so the run would own no resource to scope or clean up.', '/services', {}));

  const declaredNetworks = new Set(networks.keys());
  const bindingInputs: DeclaredPortTarget[] = [];
  for (const name of serviceNames) {
    const body = asRecord(services[name]);
    const location = `/services/${name}`;
    if (!body) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'A service definition must be a mapping.', location, { service: name, shape: shapeOf(services[name]) }));
      continue;
    }
    for (const key of Object.keys(body)) if (!SERVICE_FIELDS.has(key) && !key.startsWith('x-')) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.UNKNOWN_FIELD, `Unknown service field ${key} is refused instead of being ignored.`, `${location}/${key}`, { service: name, field: key }));
    const attached = attachNetworks(body, name, declaredNetworks, location, diagnostics, plan);
    inspectService(name, body, location, plan, diagnostics, bindingInputs, options, resolved, declaredVolumes);
    plan.services.push({ name, image: typeof body.image === 'string' ? body.image : null, build: buildContextLabel(body.build), networks: attached });
  }

  const restricted = new Set(options.restricted_pointers ?? []);
  for (const [pointer, value] of stringLeaves(services, '/services')) {
    if (INTERPOLATION_TOKEN.test(value)) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.INTERPOLATION_UNRESOLVED, 'A value still carries an interpolation token, so its effective form is unknown and cannot be reasoned about.', pointer, { token_present: true }));
      continue;
    }
    const external = externalTargetHost(value, new Set(serviceNames));
    if (external) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.DSN_EXTERNAL_HOST, 'A connection target outside this run namespace is declared, so the run would reach a resource it does not own.', pointer, { kind: external.kind, scheme: external.scheme }));
    if (credentialBearing(value)) {
      if (restricted.has(pointer)) plan.restricted_references.push({ pointer, sensitivity: 'restricted', source: 'interpolation' });
      else diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CREDENTIAL_HARDCODED, 'A credential-shaped value is written into the configuration instead of arriving from the authorised environment.', pointer, {}));
    }
  }

  plan.counts = { services: plan.services.length, networks: plan.networks.length, volumes: plan.volumes.length, ports: plan.ports.length, mounts: plan.mounts.length, builds: plan.builds.length };
  return { approved: diagnostics.length === 0, diagnostics, resource_plan: plan, bindings: planServiceBindings(bindingInputs) };
}

function inspectService(name: string, body: Record<string, unknown>, location: string, plan: ComposeResourcePlan, diagnostics: Diagnostic[], bindings: DeclaredPortTarget[], options: PreflightOptions, policy: ResolvedPolicy, declaredVolumes: Set<string>): void {
  if (body.privileged === true) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.PRIVILEGED, 'Privileged mode hands the container host-level control.', `${location}/privileged`, { service: name }));
  else if (body.privileged !== undefined && typeof body.privileged !== 'boolean') diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'privileged must be a boolean.', `${location}/privileged`, { service: name }));

  if (body.container_name !== undefined) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONTAINER_NAME_FIXED, 'A fixed container name is collision-prone and cannot be scoped to this run.', `${location}/container_name`, { service: name }));

  if (body.network_mode !== undefined) {
    const mode = String(body.network_mode);
    if (mode === 'host') diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.NETWORK_MODE_HOST, 'Host network mode removes the network namespace this run is supposed to own.', `${location}/network_mode`, { service: name }));
    else diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.NETWORK_MODE_UNSCOPED, 'Only networks declared inside this document are authorised.', `${location}/network_mode`, { service: name, mode }));
  }
  for (const field of ['pid', 'ipc', 'uts'] as const) {
    const value = body[field];
    if (value === undefined) continue;
    const text = String(value);
    if (text === 'host' || text.startsWith('container:')) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.HOST_ISOLATION, `This option shares a ${field} namespace the run does not own.`, `${location}/${field}`, { service: name, value: text }));
  }
  for (const capability of list(body.cap_add)) if (DANGEROUS_CAPS.has(String(capability).toUpperCase())) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CAP_DANGEROUS, 'This capability grants host-level control.', `${location}/cap_add`, { service: name, capability: String(capability) }));
  for (const option of list(body.security_opt)) {
    const text = String(option);
    if (/^(?:seccomp|apparmor)=unconfined$/iu.test(text) || /^label=(?:disable|level)/iu.test(text) || /no-new-privileges:false/iu.test(text)) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.SECURITY_UNCONFINED, 'This security option removes the containment the run relies on.', `${location}/security_opt`, { service: name }));
  }
  const devices = list(body.devices);
  if (devices.length > 0) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.DEVICE_PASSTHROUGH, 'Host devices are outside this run resource namespace.', `${location}/devices`, { service: name, count: devices.length }));
  const borrowed = list(body.volumes_from);
  if (borrowed.length > 0) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_FROM, 'Borrowing another container filesystem means the mounted data is not owned by this run.', `${location}/volumes_from`, { service: name, count: borrowed.length }));

  const restart = body.restart;
  if (restart !== undefined && String(restart) !== 'no') diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.RESTART_OUTLIVES_RUN, 'This restart policy can keep a container running after the run finished.', `${location}/restart`, { service: name, restart: String(restart) }));
  const pull = body.pull_policy;
  if (pull !== undefined && pull !== 'never' && pull !== 'build') diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.PULL_POLICY, 'This pull policy fetches content the declared inputs do not cover.', `${location}/pull_policy`, { service: name, pull_policy: String(pull) }));

  for (const entry of list(body.extra_hosts)) {
    const text = String(entry);
    const value = text.includes(':') ? text.slice(text.lastIndexOf(':') + 1) : text;
    if (value === 'host-gateway' || /^(?:host|gateway)\.docker\.internal[:/]/u.test(text)) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.HOST_GATEWAY, 'Routing to the host gateway reaches the host network stack.', `${location}/extra_hosts`, { service: name }));
  }

  if (body.image !== undefined) inspectImage(body.image, `${location}/image`, name, diagnostics);

  inspectPorts(body.ports, `${location}/ports`, name, plan, diagnostics, bindings);
  for (const entry of list(body.expose)) {
    const port = parsePortNumber(entry);
    if (port === null) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.PORT_MALFORMED, 'An exposed port is not a finite container port.', `${location}/expose`, { service: name }));
    else plan.exposed.push({ service: name, container_port: port, protocol: 'tcp' });
  }
  inspectMounts(body.volumes, `${location}/volumes`, name, plan, diagnostics, options, policy, declaredVolumes);
  for (const entry of list(body.tmpfs)) plan.mounts.push({ service: name, kind: 'tmpfs', source: null, target: String(entry), read_only: null });

  inspectEnvironmentFiles(body, location, name, plan, diagnostics, options, policy);
  if (body.build !== undefined) inspectBuild(name, body.build, `${location}/build`, plan, diagnostics, options, policy);
}

function attachNetworks(body: Record<string, unknown>, name: string, declared: Set<string>, location: string, diagnostics: Diagnostic[], plan: ComposeResourcePlan): string[] {
  const value = body.networks;
  if (value === undefined) {
    if (body.network_mode !== undefined) return [];
    if (!plan.networks.some((entry) => entry.name === 'default')) plan.networks.push({ name: 'default', internal: false, declared: false });
    return ['default'];
  }
  const names = Array.isArray(value) ? value.map(String) : Object.keys(asRecord(value) ?? {});
  for (const network of names) if (!declared.has(network)) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.NETWORK_UNDECLARED, `Service ${name} attaches to network ${network}, which this document does not declare.`, `${location}/networks`, { service: name, network }));
  return names;
}

function inspectImage(image: unknown, location: string, name: string, diagnostics: Diagnostic[]): void {
  if (typeof image !== 'string' || image.length === 0) {
    diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'image must be a non-empty string.', location, { service: name }));
    return;
  }
  const at = image.indexOf('@');
  if (at >= 0) {
    const digest = image.slice(at + 1);
    // `name@<bare hex>` is not a reference at all, yet it looked pinned while only a tag was checked, and
    // the daemon refused it later: `Error response from daemon: invalid reference format`. A digest is
    // therefore validated as exactly one algorithm:hex pair after `@`, with the algorithms whose hex length
    // can be checked, so a typo cannot reach `compose up` wearing the costume of a pinned input.
    const wellFormed = /^(?:sha256:[0-9a-f]{64}|sha384:[0-9a-f]{96}|sha512:[0-9a-f]{128})$/.test(digest);
    if (!wellFormed) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.IMAGE_DIGEST_MALFORMED, 'An image digest must be one algorithm:lowercase-hex pair of sha256, sha384 or sha512, or the daemon cannot resolve the reference.', location, {service: name, algorithm: digest.split(':')[0] ?? null, hex_length: (digest.split(':')[1] ?? '').length}));
      return;
    }
    return;
  }
  const lastSegment = image.split('/').pop() ?? image;
  const tag = lastSegment.includes(':') ? lastSegment.slice(lastSegment.lastIndexOf(':') + 1) : null;
  if (tag === null || tag === 'latest') diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.IMAGE_UNPINNED, 'An unpinned or mutable image tag makes the run inputs unverifiable.', location, { service: name, tag }));
}

function inspectPorts(ports: unknown, location: string, name: string, plan: ComposeResourcePlan, diagnostics: Diagnostic[], bindings: DeclaredPortTarget[]): void {
  const entries = list(ports);
  entries.forEach((entry, index) => {
    const pointer = `${location}/${index}`;
    const parsed = typeof entry === 'string' ? parseShortPort(entry) : parseLongPort(entry);
    if ('error' in parsed) {
      diagnostics.push(refuse(parsed.error === 'malformed' ? COMPOSE_REFUSAL_CODES.PORT_MALFORMED : COMPOSE_REFUSAL_CODES.PORT_FIXED_HOST, parsed.message, pointer, { service: name }));
      return;
    }
    if (parsed.mode === 'host') {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.NETWORK_MODE_HOST, 'Publishing in host mode bypasses the project network namespace.', pointer, { service: name }));
      return;
    }
    if (parsed.target === null) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.PORT_MALFORMED, 'The container port is not a finite port number.', pointer, { service: name }));
      return;
    }
    if (parsed.published !== null) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.PORT_FIXED_HOST, 'This plan requires dynamic host ports; a fixed published port collides and cannot be scoped.', pointer, { service: name, published: parsed.published }));
      return;
    }
    if (parsed.host_ip === null || !isLoopbackAddress(parsed.host_ip)) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.PORT_NOT_LOOPBACK, 'Without an explicit loopback host_ip, compose publishes the port on every interface.', pointer, { service: name, host_ip: parsed.host_ip }));
      return;
    }
    plan.ports.push({ service: name, container_port: parsed.target, protocol: parsed.protocol, host_ip: parsed.host_ip, published: null });
    bindings.push({ service: name, network_alias: name, container_port: parsed.target, protocol: parsed.protocol, host_ip: parsed.host_ip });
  });
}

function parseShortPort(value: string): { host_ip: string | null; published: string | null; target: number | null; protocol: 'tcp' | 'udp'; mode: null } | { error: 'malformed' | 'fixed'; message: string } {
  let text = value.trim();
  let protocol: 'tcp' | 'udp' = 'tcp';
  if (text.includes('/')) {
    const split = text.split('/');
    text = split[0] ?? '';
    if (split[1] !== 'tcp' && split[1] !== 'udp') return { error: 'malformed', message: 'Unsupported port protocol.' };
    protocol = split[1];
  }
  const parts = text.split(':');
  if (parts.length > 3) return { error: 'malformed', message: 'A port declaration has too many colon-separated fields.' };
  const host_ip = parts.length === 3 ? parts[0] ?? null : null;
  const published = parts.length === 3 ? parts[1] ?? null : parts.length === 2 ? parts[0] ?? null : null;
  const target = parsePortNumber(parts[parts.length - 1]);
  if (published !== null && published !== '') return { error: 'fixed', message: 'A published host port is fixed instead of dynamic.' };
  return { host_ip, published: null, target, protocol, mode: null };
}

function parseLongPort(value: unknown): { host_ip: string | null; published: string | null; target: number | null; protocol: 'tcp' | 'udp'; mode: string | null } | { error: 'malformed' | 'fixed'; message: string } {
  const record = asRecord(value);
  if (!record) return { error: 'malformed', message: 'A port declaration must be a string or a mapping.' };
  for (const key of Object.keys(record)) if (!PORT_ITEM_FIELDS.has(key)) return { error: 'malformed', message: `Unknown port field ${key}.` };
  if (record.protocol !== undefined && record.protocol !== null && record.protocol !== 'tcp' && record.protocol !== 'udp') return { error: 'malformed', message: 'Port protocol must be tcp or udp.' };
  const published = record.published;
  if (published !== undefined && published !== null && published !== '') return { error: 'fixed', message: 'A published host port is fixed instead of dynamic.' };
  return {
    host_ip: typeof record.host_ip === 'string' && record.host_ip.length > 0 ? record.host_ip : null,
    published: null,
    target: parsePortNumber(record.target),
    protocol: record.protocol === 'udp' ? 'udp' : 'tcp',
    mode: record.mode === undefined || record.mode === null ? null : String(record.mode),
  };
}

function parsePortNumber(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : null;
}

function inspectMounts(volumes: unknown, location: string, name: string, plan: ComposeResourcePlan, diagnostics: Diagnostic[], options: PreflightOptions, policy: ResolvedPolicy, declaredVolumes: Set<string>): void {
  list(volumes).forEach((entry, index) => {
    const pointer = `${location}/${index}`;
    let source: unknown;
    let target: unknown;
    let declaredReadOnly: boolean | null = null;
    let kind: string | null = null;
    if (typeof entry === 'string') {
      const parts = entry.split(':');
      if (parts.length < 2 || parts.length > 3) {
        diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED, 'A volume shorthand must be source:target[:mode].', pointer, { service: name }));
        return;
      }
      source = parts[0];
      target = parts[1];
      declaredReadOnly = parts[2] === undefined ? false : parts[2].split(',').includes('ro');
      kind = looksLikeHostPath(String(source ?? '')) ? 'bind' : 'volume';
    } else {
      const record = asRecord(entry);
      if (!record) {
        diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED, 'A volume entry must be a string or a mapping.', pointer, { service: name }));
        return;
      }
      for (const key of Object.keys(record)) if (!VOLUME_ITEM_FIELDS.has(key)) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.UNKNOWN_FIELD, `Unknown volume field ${key} is refused instead of being ignored.`, `${pointer}/${key}`, { service: name, field: key }));
      source = record.source;
      target = record.target;
      kind = record.type === undefined || record.type === null ? (looksLikeHostPath(String(record.source ?? '')) ? 'bind' : 'volume') : String(record.type);
      declaredReadOnly = record.read_only === undefined ? null : record.read_only === true;
    }
    if (kind === 'tmpfs') {
      if (typeof target === 'string' && target.startsWith('/')) plan.mounts.push({ service: name, kind: 'tmpfs', source: null, target, read_only: null });
      else diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED, 'A mount target must be an absolute container path.', pointer, { service: name }));
      return;
    }
    if (kind === 'volume') {
      if (typeof source !== 'string' || source.length === 0) {
        diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED, 'A mount source is missing.', pointer, { service: name }));
        return;
      }
      if (typeof target !== 'string' || !target.startsWith('/')) {
        diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED, 'A mount target must be an absolute container path.', pointer, { service: name }));
        return;
      }
      if (!declaredVolumes.has(source)) plan.volumes.push({ name: source });
      plan.mounts.push({ service: name, kind: 'volume', source, target, read_only: declaredReadOnly });
      return;
    }
    if (kind === 'npipe') {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.DOCKER_SOCKET_MOUNT, 'A named-pipe mount hands the Docker daemon pipe to the container.', pointer, { service: name }));
      return;
    }
    if (kind !== 'bind') {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.UNKNOWN_FIELD, `Unsupported mount type ${kind}; only bind, volume and tmpfs mounts are authorised.`, `${pointer}/type`, { service: name, type: kind }));
      return;
    }
    if (typeof source !== 'string' || source.length === 0) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED, 'A mount source is missing.', pointer, { service: name }));
      return;
    }
    // The bind source is classified before the target shape, so a socket or host-root mount is always
    // reported by its real cause instead of as a malformed declaration.
    const classified = classifyHostPath(source, pointer, options, policy);
    if ('code' in classified) {
      diagnostics.push(refuse(classified.code, classified.message, classified.location, classified.observed_facts));
      return;
    }
    if (typeof target !== 'string' || !target.startsWith('/')) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED, 'A mount target must be an absolute container path.', pointer, { service: name }));
      return;
    }
    if (declaredReadOnly === true) {
      plan.mounts.push({ service: name, kind: 'bind', source: classified.repo_path, target, read_only: true });
      return;
    }
    const writable = policy.writable_roots.some((root) => classified.repo_path === root || classified.repo_path.startsWith(`${root}/`) || (isPattern(root) && safeMatch(root, classified.repo_path)));
    if (!writable) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.MOUNT_WRITABLE_UNDECLARED, 'A writable bind mount is only allowed under a run output root the effective policy declares.', pointer, { service: name, source: classified.repo_path }));
    else plan.mounts.push({ service: name, kind: 'bind', source: classified.repo_path, target, read_only: false });
  });
}

function inspectEnvironmentFiles(body: Record<string, unknown>, location: string, name: string, plan: ComposeResourcePlan, diagnostics: Diagnostic[], options: PreflightOptions, policy: ResolvedPolicy): void {
  const value = body.env_file;
  if (value === undefined) return;
  const entries = Array.isArray(value) ? value : [value];
  entries.forEach((entry, index) => {
    const pointer = `${location}/env_file/${index}`;
    const pathValue = typeof entry === 'string' ? entry : asRecord(entry)?.path;
    if (typeof pathValue !== 'string') {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'env_file must name a path.', pointer, { service: name }));
      return;
    }
    const classified = classifyHostPath(pathValue, pointer, options, policy);
    if ('code' in classified) {
      diagnostics.push(refuse(classified.code, classified.message, classified.location, classified.observed_facts));
      return;
    }
    plan.restricted_references.push({ pointer, sensitivity: 'restricted', source: 'env_file' });
  });
}

function inspectBuild(name: string, build: unknown, location: string, plan: ComposeResourcePlan, diagnostics: Diagnostic[], options: PreflightOptions, policy: ResolvedPolicy): void {
  const record = typeof build === 'string' ? null : asRecord(build);
  if (record === null && typeof build !== 'string') {
    diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'build must be a context string or a mapping.', location, { service: name }));
    return;
  }
  if (record) for (const key of Object.keys(record)) if (!BUILD_FIELDS.has(key)) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.UNKNOWN_FIELD, `Unknown build field ${key} is refused instead of being ignored.`, `${location}/${key}`, { service: name, field: key }));
  if (record?.privileged === true) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.PRIVILEGED, 'A privileged build escapes the containment the run relies on.', `${location}/privileged`, { service: name }));
  if (record?.network === 'host') diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.NETWORK_MODE_HOST, 'A build on the host network bypasses the project network namespace.', `${location}/network`, { service: name }));
  if (list(record?.ssh).length > 0) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.BUILD_SSH, 'SSH forwarding hands the host agent to the build.', `${location}/ssh`, { service: name }));
  if (list(record?.secrets).length > 0 || list(record?.secret_envfiles).length > 0) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.BUILD_SECRET, 'Build secrets read host material this run does not declare as an input.', `${location}/secrets`, { service: name }));

  const contexts = [typeof build === 'string' ? build : typeof record?.context === 'string' ? record.context : '.', ...additionalContexts(record)];
  for (const context of contexts) {
    if (REMOTE_SCHEME.test(context)) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.BUILD_CONTEXT_REMOTE, 'A remote build context cannot be covered by the run declared inputs.', `${location}/context`, { service: name }));
      continue;
    }
    const classified = classifyHostPath(context, `${location}/context`, options, policy);
    if ('code' in classified) {
      diagnostics.push(refuse(classified.code, classified.message, classified.location, classified.observed_facts));
      continue;
    }
    const accounting = options.build_accounting?.[name];
    if (!accounting || !accounting.complete || accounting.context !== classified.repo_path) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.BUILD_INPUTS_UNACCOUNTED, 'The actual build inputs of this context are not accounted, so an image hash could not stand in for them.', `${location}/context`, { service: name, context: classified.repo_path, accounted: accounting?.complete ?? false }));
      continue;
    }
    const dockerfile = typeof record?.dockerfile === 'string' ? record.dockerfile : record?.dockerfile_inline !== undefined ? null : 'Dockerfile';
    plan.builds.push({ service: name, context: classified.repo_path, dockerfile, ignored_inputs_declared: accounting.dockerignore_present, accounted_entries: accounting.entry_count });
  }
}

function additionalContexts(record: Record<string, unknown> | null): string[] {
  const value = record?.additional_contexts;
  if (Array.isArray(value)) return value.map(String);
  const map = asRecord(value);
  return map ? Object.values(map).map(String) : [];
}

function buildContextLabel(build: unknown): string | null {
  if (build === undefined) return null;
  if (typeof build === 'string') return build;
  const record = asRecord(build);
  if (!record) return 'invalid';
  return typeof record.context === 'string' ? record.context : '.';
}

type PathClassification = { repo_path: string } | { code: ComposeCode; message: string; location: string; observed_facts: Record<string, unknown> };

/**
 * Decide where a host-side path really sits, without touching the filesystem. An absolute path is
 * only usable when the caller says which directory compose resolved it against; anything that cannot
 * be shown to live inside that directory is treated as an escape.
 */
function classifyHostPath(raw: string, location: string, options: PreflightOptions, policy: ResolvedPolicy): PathClassification {
  const normalized = raw.trim().replaceAll('\\', '/');
  const lowercase = normalized.toLowerCase();
  const finalSegment = lowercase.replace(/\/+$/u, '').split('/').pop() ?? '';
  if (DOCKER_SOCKET_PATHS.has(lowercase) || finalSegment === 'docker.sock' || finalSegment === 'docker.npipe' || finalSegment === 'docker_engine') {
    return { code: COMPOSE_REFUSAL_CODES.DOCKER_SOCKET_MOUNT, message: 'The Docker daemon socket is mounted, which hands the whole host daemon to the container.', location, observed_facts: {} };
  }
  if (/^(?:~|\$HOME|%USERPROFILE%)(?:[/\\]|$)/u.test(raw)) return { code: COMPOSE_REFUSAL_CODES.PATH_HOME, message: 'The mount reaches into a user profile directory.', location, observed_facts: { form: 'profile-prefix' } };
  const profiles = (options.profile_directories ?? []).map((entry) => entry.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase());
  if (profiles.some((entry) => entry.length > 0 && (lowercase === entry || lowercase.startsWith(`${entry}/`)))) return { code: COMPOSE_REFUSAL_CODES.PATH_HOME, message: 'The mount reaches into a user profile directory.', location, observed_facts: { form: 'profile-root' } };
  if (normalized === '/' || normalized === '//' || /^[A-Za-z]:[\\/]*$/u.test(normalized)) return { code: COMPOSE_REFUSAL_CODES.PATH_HOST_ROOT, message: 'A host filesystem root is mounted.', location, observed_facts: { source: normalized } };

  const prefix = (options.repository_prefix ?? '').replaceAll('\\', '/').replace(/\/+$/u, '');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) {
    const project = options.project_directory === undefined ? null : options.project_directory.replaceAll('\\', '/').replace(/\/+$/u, '');
    if (project === null || !inside(lowercase, project.toLowerCase())) return { code: COMPOSE_REFUSAL_CODES.PATH_ESCAPES_RUN, message: 'The path is outside the directory this run owns.', location, observed_facts: { source: normalized } };
    const relative = normalized.slice(project.length + 1);
    if (!policy.allowed_paths.some((pattern) => safeMatch(pattern, relative))) return { code: COMPOSE_REFUSAL_CODES.PATH_OUTSIDE_POLICY, message: 'The path is inside the run directory but outside the authorised paths of the policy.', location, observed_facts: { source: relative } };
    return { repo_path: joinPath(prefix, relative) };
  }
  const joined = joinPath(prefix, normalized);
  if (joined === '..' || joined.startsWith('../') || path.posix.isAbsolute(joined)) return { code: COMPOSE_REFUSAL_CODES.PATH_ESCAPES_RUN, message: 'The path escapes the directory this run owns.', location, observed_facts: { source: joined } };
  if (prefix.length > 0 && joined !== prefix && !joined.startsWith(`${prefix}/`)) return { code: COMPOSE_REFUSAL_CODES.PATH_ESCAPES_RUN, message: 'The path escapes the directory this run owns.', location, observed_facts: { source: joined } };
  if (!policy.allowed_paths.some((pattern) => safeMatch(pattern, joined))) return { code: COMPOSE_REFUSAL_CODES.PATH_OUTSIDE_POLICY, message: 'The path is not inside an authorised path of the effective policy.', location, observed_facts: { source: joined } };
  return { repo_path: joined };
}

function safeMatch(pattern: string, relative: string): boolean {
  try {
    return matchesPath(pattern, relative);
  } catch {
    return false;
  }
}

function isPattern(value: string): boolean {
  return value.includes('*') || value.includes('?');
}

function joinPath(prefix: string, relative: string): string {
  const cleaned = relative.replace(/^\.\/+/u, '');
  return prefix.length === 0 ? path.posix.normalize(cleaned) : path.posix.normalize(`${prefix}/${cleaned}`);
}

function looksLikeHostPath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\');
}

function sections(value: unknown, location: string, diagnostics: Diagnostic[], fields: Set<string>): Map<string, Record<string, unknown> | null> {
  const map = new Map<string, Record<string, unknown> | null>();
  if (value === undefined || value === null) return map;
  const record = asRecord(value);
  if (!record) {
    diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'This section must be a mapping of name to definition.', location, { shape: shapeOf(value) }));
    return map;
  }
  for (const [name, entry] of Object.entries(record)) {
    if (entry === null) {
      map.set(name, null);
      continue;
    }
    const body = asRecord(entry);
    if (!body) {
      diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED, 'A section definition must be a mapping or null.', `${location}/${name}`, { shape: shapeOf(entry) }));
      continue;
    }
    for (const key of Object.keys(body)) if (!fields.has(key) && !key.startsWith('x-')) diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.UNKNOWN_FIELD, `Unknown ${location.slice(1)} field ${key} is refused instead of being ignored.`, `${location}/${name}/${key}`, { name, field: key }));
    map.set(name, body);
  }
  return map;
}

function checkResourceName(record: Record<string, unknown>, key: string, namespace: string | null | undefined, location: string, diagnostics: Diagnostic[]): void {
  if (record.name === undefined) return;
  const name = String(record.name);
  if (typeof namespace === 'string' && name === `${namespace}_${key}`) return;
  diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.RESOURCE_NAME_PINNED, 'The resource pins a global name, so this run cannot own or scope it.', `${location}/name`, { declared_name: name, run_namespace: namespace ?? null }));
}

function resolvePolicy(policy: unknown, diagnostics: Diagnostic[]): ResolvedPolicy | null {
  const invalid = (field: string, detail: string): null => {
    diagnostics.push(refuse(COMPOSE_REFUSAL_CODES.POLICY_INVALID, `The effective policy does not provide a usable ${field}, so the preflight cannot decide.`, `/${field}`, { field, detail }, 'Repair the effective policy; a missing constraint is never treated as permission.'));
    return null;
  };
  const record = asRecord(policy);
  if (!record) return invalid('policy', shapeOf(policy));
  if (record.schema_version !== '0.1') return invalid('schema_version', String(record.schema_version));
  if (typeof record.policy_id !== 'string' || record.policy_id.length === 0) return invalid('policy_id', shapeOf(record.policy_id));
  if (!stringList(record.allowed_paths)) return invalid('allowed_paths', 'not a list of path patterns');
  if (!stringList(record.allowed_origins)) return invalid('allowed_origins', 'not a list of origins');
  for (const pattern of record.allowed_paths as string[]) {
    try {
      validatePathPattern(pattern);
    } catch {
      return invalid('allowed_paths', `unsupported pattern ${pattern}`);
    }
  }
  const writable = record.compose_writable_mount_roots;
  if (writable !== undefined && !stringList(writable)) return invalid('compose_writable_mount_roots', 'not a list of run output roots');
  return { allowed_paths: record.allowed_paths as string[], allowed_origins: record.allowed_origins as string[], writable_roots: (writable as string[] | undefined) ?? [] };
}

function stringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function shapeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * A connection target is inside this run only when it is loopback or names a service declared in the
 * same document. Anything else is outside the namespace, so it is refused without echoing the value.
 */
function externalTargetHost(value: string, services: Set<string>): { kind: 'external-host' | 'host-escape'; scheme: string } | null {
  if (!value.includes('://')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname.length === 0 || isLoopbackAddress(url.hostname) || services.has(url.hostname)) return null;
  return { kind: url.hostname.endsWith('.docker.internal') ? 'host-escape' : 'external-host', scheme: url.protocol.replace(':', '') };
}

function* stringLeaves(node: unknown, pointer: string): Generator<[string, string]> {
  const stack: { value: unknown; pointer: string }[] = [{ value: node, pointer }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (typeof current.value === 'string') {
      yield [current.pointer, current.value];
      continue;
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => stack.push({ value: entry, pointer: `${current.pointer}/${index}` }));
      continue;
    }
    const record = asRecord(current.value);
    if (record) for (const [key, entry] of Object.entries(record)) stack.push({ value: entry, pointer: `${current.pointer}/${key}` });
  }
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>);
  return [value];
}

function refuse(rule: ComposeCode, message: string, location: string, observed_facts: Record<string, unknown>, recommended_action = 'Rewrite the configuration so every resource is created, owned and cleaned up by this run.'): Diagnostic {
  const code: ReasonCode = rule.startsWith(`${PREFIX}BINDING-`) ? 'ENV_PROVENANCE_INSUFFICIENT' : CONFIG_SHAPED.has(rule) ? 'CONFIG_INVALID' : 'POLICY_WEAKEN_ATTEMPT';
  return { code, rule_id: rule, message, location, observed_facts, recommended_action, source: SOURCE };
}

function emptyPlan(): ComposeResourcePlan {
  return { source: 'DECLARED', ownership: 'run-scoped-only', project_namespace: null, services: [], networks: [], volumes: [], ports: [], exposed: [], mounts: [], builds: [], restricted_references: [], counts: { services: 0, networks: 0, volumes: 0, ports: 0, mounts: 0, builds: 0 } };
}
