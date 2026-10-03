import type { Diagnostic } from '../../contracts/src/index.js';

/**
 * Service port -> host binding model for SG-057.
 *
 * This module deliberately cannot know a host port. `docker compose` allocates the host side of a
 * dynamic mapping at create time, so a binding is only ever `DECLARED` (container side, from the
 * configuration text) until SG-058 records an `OBSERVED` value taken from real inspection of the
 * container it owns. Nothing here guesses, and an unobserved binding authorises no origin.
 */

/** Rule recorded on every planned binding; SG-058/SG-062 bind against it instead of localhost ranges. */
export const CONTAINER_PORT_ORIGIN_RULE =
  'container-port-origin: an origin is authorisable only after this run observed a loopback host binding for that exact declared container port, and only when the resulting origin is already inside EffectivePolicy.allowed_origins; a declared container port never authorises a localhost origin.';

// Rule ids owned by preflight.COMPOSE_REFUSAL_CODES; repeated here as literals because importing
// them would create a module cycle (preflight imports this module). Tests assert the two stay equal.
const BINDING_NOT_OBSERVED = 'SG-POLICY-COMPOSE-BINDING-NOT-OBSERVED';
const BINDING_SCHEME_UNDECLARED = 'SG-POLICY-COMPOSE-BINDING-SCHEME-UNDECLARED';
const BINDING_ORIGIN_UNAUTHORIZED = 'SG-POLICY-COMPOSE-BINDING-ORIGIN-UNAUTHORIZED';
const BINDING_HOST_NOT_LOOPBACK = 'SG-POLICY-COMPOSE-BINDING-HOST-NOT-LOOPBACK';

export interface DeclaredPortTarget {
  service: string;
  network_alias: string;
  container_port: number;
  protocol: 'tcp' | 'udp';
  host_ip: string | null;
}

export interface ServicePortBinding {
  service: string;
  network_alias: string;
  container_port: number;
  protocol: 'tcp' | 'udp';
  host_ip: string | null;
  /** Null until a real inspection records it; null never means "assume a port". */
  host_port: number | null;
  observed: boolean;
  provenance: 'DECLARED' | 'OBSERVED';
  scheme: 'http' | 'https' | null;
  internal_target: string;
  host_origin: string | null;
  authorization_rule: string;
}

export interface PortBindingObservation { host_ip: string; host_port: number; scheme?: 'http' | 'https' | undefined }
export interface BindingOriginDecision { decision: 'ALLOW' | 'DENY'; origin: string | null; reason: string }

/** Loopback only, by address form. `localhost` is not accepted: compose host_ip must be an address. */
export function isLoopbackAddress(value: string): boolean {
  if (value === '::1') return true;
  const octets = value.split('.');
  return octets.length === 4 && octets[0] === '127' && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/** Plan the host-binding slots from declared container ports only. The host side stays unobserved. */
export function planServiceBindings(declared: readonly DeclaredPortTarget[]): ServicePortBinding[] {
  return declared.map((entry) => ({
    service: entry.service,
    network_alias: entry.network_alias,
    container_port: entry.container_port,
    protocol: entry.protocol,
    host_ip: entry.host_ip,
    host_port: null,
    observed: false,
    provenance: 'DECLARED' as const,
    scheme: null,
    internal_target: `${entry.network_alias}:${entry.container_port}`,
    host_origin: null,
    authorization_rule: CONTAINER_PORT_ORIGIN_RULE,
  }));
}

/**
 * Attach one real inspection result to a planned binding. A reported interface that is not loopback
 * is refused and leaves the binding exactly as it was, because a published-on-all-interfaces port
 * cannot be re-scoped by observation alone.
 */
export function recordObservedBindings(binding: ServicePortBinding, observation: PortBindingObservation): { binding: ServicePortBinding; diagnostics: Diagnostic[] } {
  const port = observation.host_port;
  const hostPortValid = Number.isSafeInteger(port) && port >= 1 && port <= 65_535;
  if (!hostPortValid || !isLoopbackAddress(observation.host_ip)) {
    return { binding, diagnostics: [refuseBinding(BINDING_HOST_NOT_LOOPBACK, binding, { host_ip: observation.host_ip, host_port_valid: hostPortValid })] };
  }
  const origin = observation.scheme ? `${observation.scheme}://${observation.host_ip}:${port}` : null;
  return {
    binding: { ...binding, host_ip: observation.host_ip, host_port: port, observed: true, provenance: 'OBSERVED', scheme: observation.scheme ?? null, host_origin: origin },
    diagnostics: [],
  };
}

/** Narrow-only origin authorization: never widen EffectivePolicy.allowed_origins, never act on a declaration. */
export function authorizeBindingOrigin(binding: ServicePortBinding, policy: { allowed_origins: readonly string[] }): BindingOriginDecision {
  if (!binding.observed || binding.host_port === null) return { decision: 'DENY', origin: null, reason: BINDING_NOT_OBSERVED };
  if (!binding.host_origin || binding.scheme === null) return { decision: 'DENY', origin: null, reason: BINDING_SCHEME_UNDECLARED };
  if (!isLoopbackAddress(binding.host_ip ?? '')) return { decision: 'DENY', origin: binding.host_origin, reason: BINDING_HOST_NOT_LOOPBACK };
  if (!policy.allowed_origins.includes(binding.host_origin)) return { decision: 'DENY', origin: binding.host_origin, reason: BINDING_ORIGIN_UNAUTHORIZED };
  return { decision: 'ALLOW', origin: binding.host_origin, reason: 'policy-allowed-observed-loopback' };
}

function refuseBinding(rule: typeof BINDING_HOST_NOT_LOOPBACK | typeof BINDING_NOT_OBSERVED | typeof BINDING_SCHEME_UNDECLARED | typeof BINDING_ORIGIN_UNAUTHORIZED, binding: ServicePortBinding, observed_facts: Record<string, unknown>): Diagnostic {
  return {
    code: 'ENV_PROVENANCE_INSUFFICIENT',
    rule_id: rule,
    message: 'The host binding for this container port is not an observed loopback binding, so no origin is authorized.',
    location: `/services/${binding.service}`,
    observed_facts: { container_port: binding.container_port, network_alias: binding.network_alias, ...observed_facts },
    recommended_action: 'Read the published port from this run own compose resources (SG-058) and keep the origin inside the effective policy.',
    source: 'compose-target-bindings',
  };
}
