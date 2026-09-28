/**
 * Operation authorization shared with `presets/fastapi-react/scripts/probe_helpers.py`.
 *
 * `tests/fixtures/v2-regressions/http-policy.json` is the contract both languages are measured against,
 * including the order the rules fire in: a case introduces exactly one defect so a divergence names the
 * rule that moved instead of leaving two candidate causes.
 */
export interface DeclaredOperation {
  service_id: string;
  method: string;
  path: string;
}

const SERVICE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE']);
const CONTROL_OR_DEL = /[\u0000-\u001f\u007f]/;
const WHITESPACE = /\s/;

export type PathRule = 'PATH_INVALID' | 'PATH_CONTROL_CHARS_FORBIDDEN' | 'PATH_QUERY_FORBIDDEN'
  | 'PATH_FRAGMENT_FORBIDDEN' | 'PATH_BACKSLASH_FORBIDDEN' | 'PATH_ENCODING_UNSUPPORTED'
  | 'PATH_TEMPLATE_UNSUPPORTED' | 'PATH_DUPLICATE_SEPARATOR_FORBIDDEN' | 'PATH_AMBIGUOUS_SEGMENT_FORBIDDEN';

/**
 * The first release sends only an exact literal path. Everything that could make the bytes on the wire
 * differ from the confirmed declaration — query, fragment, escapes, dot segments, templates — is refused
 * by name rather than silently normalized into some other operation.
 */
export function pathRuleViolation(path: string): PathRule | null {
  if (typeof path !== 'string' || path.length === 0 || path[0] !== '/') return 'PATH_INVALID';
  if (CONTROL_OR_DEL.test(path)) return 'PATH_CONTROL_CHARS_FORBIDDEN';
  if (WHITESPACE.test(path)) return 'PATH_CONTROL_CHARS_FORBIDDEN';
  if (path.includes('?')) return 'PATH_QUERY_FORBIDDEN';
  if (path.includes('#')) return 'PATH_FRAGMENT_FORBIDDEN';
  if (path.includes('\\')) return 'PATH_BACKSLASH_FORBIDDEN';
  if (path.includes('%')) return 'PATH_ENCODING_UNSUPPORTED';
  if (path.includes('{') || path.includes('}')) return 'PATH_TEMPLATE_UNSUPPORTED';
  if (path.includes('//')) return 'PATH_DUPLICATE_SEPARATOR_FORBIDDEN';
  if (path.split('/').some(segment => segment === '.' || segment === '..')) return 'PATH_AMBIGUOUS_SEGMENT_FORBIDDEN';
  return null;
}

/**
 * Validates the operation key grammar only, matching `OperationKey` in
 * `schemas/0.1/common.schema.json`. A key can be grammatically valid and still unsupported
 * (`api:GET /a#b`); that distinction is decided by the caller, never by silently editing the path.
 */
export function parseDeclaredOperation(key: string): DeclaredOperation {
  if (typeof key !== 'string') throw new Error('OPERATION_KEY_INVALID');
  const separator = key.indexOf(':');
  if (separator < 0) throw new Error(`OPERATION_KEY_INVALID:${key}`);
  const service_id = key.slice(0, separator);
  const rest = key.slice(separator + 1);
  const space = rest.indexOf(' ');
  if (space < 0) throw new Error(`OPERATION_KEY_INVALID:${key}`);
  const method = rest.slice(0, space);
  const path = rest.slice(space + 1);
  if (!SERVICE_ID.test(service_id)) throw new Error(`OPERATION_KEY_INVALID:${key}`);
  if (!METHODS.has(method)) throw new Error(`OPERATION_KEY_INVALID:${key}`);
  if (path.length === 0 || path[0] !== '/' || CONTROL_OR_DEL.test(path) || WHITESPACE.test(path)) {
    throw new Error(`OPERATION_KEY_INVALID:${key}`);
  }
  return {service_id, method, path};
}

/** A declared operation only exists for the service that registered it; never infer one from a URL. */
export function operationFromDeclaration(declared_operation_key: string | null): {ok: true; value: DeclaredOperation} | {ok: false; reason: string} {
  if (declared_operation_key === null || declared_operation_key === undefined) {
    return {ok: false, reason: 'DECLARATION_MISSING'};
  }
  try {
    return {ok: true, value: parseDeclaredOperation(declared_operation_key)};
  } catch {
    return {ok: false, reason: 'OPERATION_KEY_INVALID'};
  }
}

/** Positive safe integers only: NaN, infinities, fractions, booleans and strings never become a budget. */
export function isPositiveSafeInteger(value: unknown, maximum: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}
