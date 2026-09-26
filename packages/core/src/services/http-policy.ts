export interface HttpRequestPolicy {
  deadline_ms: number;
  max_response_bytes: number;
  allow_redirects: false;
  allowed_origins: readonly string[];
  allowed_methods: readonly string[];
}

/** Initial resource budget (SG-054, plan §2.4). Tightening is allowed; silent widening is not. */
export const DEFAULT_HTTP_REQUEST_POLICY: HttpRequestPolicy = Object.freeze({
  deadline_ms: 5000,
  max_response_bytes: 1024 * 1024,
  allow_redirects: false,
  allowed_origins: Object.freeze([]) as readonly string[],
  allowed_methods: Object.freeze(['GET']) as readonly string[],
});

export interface NormalizedOrigin {
  origin: string;
  host: string;
  port: number | null;
  loopback: boolean;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Canonicalizes an origin without guessing: no path, query, fragment, or credentials survive, the host
 * is lower-cased and a default port is dropped, so authorization compares like for like.
 */
export function normalizeOrigin(raw: string): { ok: true; value: NormalizedOrigin } | { ok: false; reason: string } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'ORIGIN_EMPTY' };
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, reason: 'ORIGIN_CONTROL_CHARS' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'ORIGIN_UNPARSEABLE' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'ORIGIN_SCHEME_FORBIDDEN' };
  if (url.username || url.password) return { ok: false, reason: 'ORIGIN_USERINFO_FORBIDDEN' };
  if (url.pathname !== '/' && url.pathname !== '') return { ok: false, reason: 'ORIGIN_PATH_NOT_ALLOWED' };
  if (url.search || url.hash) return { ok: false, reason: 'ORIGIN_QUERY_NOT_ALLOWED' };
  const host = url.hostname.toLowerCase();
  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  if (url.port && !/^\d+$/.test(url.port)) return { ok: false, reason: 'ORIGIN_PORT_INVALID' };
  const parsedPort = url.port ? Number(url.port) : null;
  if (parsedPort !== null && (parsedPort < 1 || parsedPort > 65535)) return { ok: false, reason: 'ORIGIN_PORT_INVALID' };
  const port = parsedPort === defaultPort ? null : parsedPort;
  const serialized = `${url.protocol}//${host}${port ? ':' + port : ''}`;
  return { ok: true, value: { origin: serialized, host, port, loopback: LOOPBACK_HOSTS.has(host) } };
}

export interface RequestAuthorizationInput {
  policy: HttpRequestPolicy;
  origin: string;
  method: string;
  path: string;
  declared_operation_key: string | null;
}

export type RequestDecision = { allowed: true } | { allowed: false; reason: string };

/** A loopback host is not automatically a safe target: the origin must be one of the confirmed bindings. */
export function authorizeRequest(input: RequestAuthorizationInput): RequestDecision {
  const normalized = normalizeOrigin(input.origin);
  if (!normalized.ok) return { allowed: false, reason: normalized.reason };
  if (!input.policy.allowed_origins.includes(normalized.value.origin)) return { allowed: false, reason: 'ORIGIN_NOT_AUTHORIZED' };
  const method = input.method.toUpperCase();
  if (!input.policy.allowed_methods.includes(method)) return { allowed: false, reason: 'METHOD_NOT_AUTHORIZED' };
  if (input.declared_operation_key !== null && !input.declared_operation_key.startsWith(`:${method} `)
    && !new RegExp(`^[A-Za-z][A-Za-z0-9_-]*:${method} `).test(input.declared_operation_key)) {
    return { allowed: false, reason: 'OPERATION_METHOD_MISMATCH' };
  }
  if (!input.path.startsWith('/') || input.path.includes('//')) return { allowed: false, reason: 'PATH_INVALID' };
  if (/[?\u0000-\u001f\u007f]/.test(input.path)) return { allowed: false, reason: 'PATH_QUERY_OR_CONTROL_CHARS_FORBIDDEN' };
  if (input.policy.max_response_bytes < 1 || input.policy.max_response_bytes > 1024 * 1024) return { allowed: false, reason: 'RESPONSE_BUDGET_OUT_OF_RANGE' };
  if (input.policy.deadline_ms < 1 || input.policy.deadline_ms > 60000) return { allowed: false, reason: 'DEADLINE_OUT_OF_RANGE' };
  return { allowed: true };
}

/** Redirect targets are re-authorized instead of followed. */
export function authorizeRedirect(policy: HttpRequestPolicy, from: string, to: string): RequestDecision {
  if (policy.allow_redirects !== false) return { allowed: false, reason: 'POLICY_REDIRECT_FOLLOWING_UNSUPPORTED' };
  const target = normalizeOrigin(to);
  if (!target.ok) return { allowed: false, reason: target.reason };
  const source = normalizeOrigin(from);
  if (!source.ok) return { allowed: false, reason: source.reason };
  if (source.value.origin !== target.value.origin) return { allowed: false, reason: 'REDIRECT_CROSSES_AUTHORIZED_ORIGIN' };
  return { allowed: false, reason: 'REDIRECT_NOT_FOLLOWED' };
}
