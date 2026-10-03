import type {ProbeDeclaration} from '../../../contracts/src/index.js';
import {parseStrictDocument} from './strict-document.js';
import {ServiceError} from './service-error.js';

export interface ProbeAssertionOutcome {
  assertion_id: string;
  passed: boolean;
  reason: string | null;
}

export interface DeclarationEvaluation {
  status_ok: boolean;
  media_type_ok: boolean;
  body_parseable: boolean;
  /** The JSON type of the document root, or 'absent' when the value is not a JSON document at all. */
  root_kind: JsonRootKind;
  outcomes: ProbeAssertionOutcome[];
  failed: number;
  diagnostics: string[];
}

/** 'absent' says "this value is not a JSON document"; it is not a claim about whether the bytes were JSON. */
export type JsonRootKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'absent';

/** The single pointer grammar shared with `probe_helpers.py`; see tests/fixtures/v2-regressions/assertions.json. */
export type PointerReason = 'POINTER_INVALID' | 'POINTER_ESCAPE_INVALID' | 'POINTER_INDEX_INVALID' | 'POINTER_NOT_FOUND';

/** Machine-readable refusals of `parseJsonResponse`; `parse_json_response` in Python reports the same set. */
export type JsonResponseReason =
  | 'RESPONSE_BODY_OVER_BUDGET' | 'RESPONSE_BODY_NOT_UTF8' | 'RESPONSE_BODY_NOT_JSON'
  | 'JSON_DUPLICATE_KEY' | 'JSON_NESTING_OVER_LIMIT' | 'JSON_NUMBER_NOT_FINITE'
  | 'JSON_NUMBER_NOT_LOSSLESS' | 'JSON_STRICTNESS_REFUSED';

export class JsonResponseError extends Error {
  constructor(readonly reason: JsonResponseReason, readonly detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'JsonResponseError';
  }
}

/** The bounds every response body is read under: the same 1 MiB the declaration schema allows and the same depth the strict document boundary uses. */
export const RESPONSE_PARSE_LIMITS = {max_bytes: 1024 * 1024, max_depth: 64} as const;

export type PointerAssertion = ProbeDeclaration['assertions'][number];

const KIND_NAMES = ['string', 'number', 'boolean', 'null'] as const;

/** Membership is decided by the closed list, so no response value can reach an inherited prototype member. */
const isKindName = (candidate: unknown): candidate is (typeof KIND_NAMES)[number] =>
  typeof candidate === 'string' && (KIND_NAMES as readonly string[]).includes(candidate);

const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;

/**
 * RFC 6901 with the two decisions this repository makes explicitly: the whole-document pointer `""` is not
 * accepted (the declaration schema requires a leading `/`), and an empty segment is the empty key, so `/`
 * addresses `""` and `//x` addresses `""` then `x`. A `~` that is not `~0` or `~1` is diagnosed here, before
 * any token reaches the document, so a malformed pointer is never evaluated as if it were a key.
 */
export function parsePointer(pointer: string): {ok: true; tokens: string[]} | {ok: false; reason: PointerReason} {
  if (!pointer.startsWith('/')) return {ok: false, reason: 'POINTER_INVALID'};
  const tokens: string[] = [];
  for (const segment of pointer.slice(1).split('/')) {
    let token = '';
    for (let index = 0; index < segment.length; index++) {
      const character = segment.charAt(index);
      if (character !== '~') {
        token += character;
        continue;
      }
      const escape = segment.charAt(index + 1);
      if (escape === '0') { token += '~'; index++; continue; }
      if (escape === '1') { token += '/'; index++; continue; }
      return {ok: false, reason: 'POINTER_ESCAPE_INVALID'};
    }
    tokens.push(token);
  }
  return {ok: true, tokens};
}

type Resolution = {status: 'found'; value: unknown} | {status: 'missing'} | {status: 'invalid'; reason: PointerReason};

/**
 * Own properties only. `Object.hasOwn` is what makes an inherited `constructor`, `__proto__` or `toString`
 * invisible: nothing inherited can satisfy an assertion, while a real own member with one of those names is
 * read like any other key. There is no keyword blacklist, and an array index is only canonical decimal -
 `01` and `-` are malformed rather than a silently resolved position or a plain absence.
 */
function resolveTokens(tokens: readonly string[], document: unknown): Resolution {
  let current: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!CANONICAL_INDEX.test(token)) return {status: 'invalid', reason: 'POINTER_INDEX_INVALID'};
      const index = Number(token);
      if (index >= current.length) return {status: 'missing'};
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === 'object') {
      if (!Object.hasOwn(current, token)) return {status: 'missing'};
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return {status: 'missing'};
  }
  return {status: 'found', value: current};
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A comparison or equality operand has to be one of the four JSON scalar types; a container is never compared. */
const isScalar = (value: unknown): boolean =>
  value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number';

/** Restricted, deterministic evaluation. No expression, no user code, no model judgement. */
export function evaluateAssertion(document: unknown, assertion: PointerAssertion): ProbeAssertionOutcome {
  const fail = (reason: PointerReason | string): ProbeAssertionOutcome =>
    ({assertion_id: assertion.assertion_id, passed: false, reason});
  const parsed = parsePointer(assertion.pointer);
  if (!parsed.ok) return fail(parsed.reason);
  const resolution = resolveTokens(parsed.tokens, document);
  if (resolution.status === 'invalid') return fail(resolution.reason);
  const found = resolution.status === 'found';
  const value = found ? resolution.value : undefined;
  const expected = (assertion as {expected?: unknown}).expected;
  switch (assertion.operator) {
    case 'exists':
      return {assertion_id: assertion.assertion_id, passed: found, reason: found ? null : 'POINTER_NOT_FOUND'};
    case 'type': {
      if (!found) return fail('POINTER_NOT_FOUND');
      // The kind must be named as one of the four strings: a missing `expected`, a JSON null or a number is
      // not the `null` kind, it is an unusable assertion.
      if (!isKindName(expected)) return fail('TYPE_EXPECTED_UNKNOWN');
      const checks: Record<(typeof KIND_NAMES)[number], (candidate: unknown) => boolean> = {
        string: candidate => typeof candidate === 'string',
        // A non-finite number is not a number for an assertion: whatever produced it, it cannot be a fact
        // about a JSON response because the parse gate refuses it.
        number: candidate => isFiniteNumber(candidate),
        boolean: candidate => typeof candidate === 'boolean',
        null: candidate => candidate === null,
      };
      const passed = checks[expected](value);
      return {assertion_id: assertion.assertion_id, passed, reason: passed ? null : 'TYPE_MISMATCH'};
    }
    case 'equals': {
      if (!found) return fail('POINTER_NOT_FOUND');
      const passed = isScalar(value) && isScalar(expected) && value === expected;
      return {assertion_id: assertion.assertion_id, passed, reason: passed ? null : 'VALUE_MISMATCH'};
    }
    default: {
      if (!found) return fail('POINTER_NOT_FOUND');
      const comparisons: Record<string, (left: number, right: number) => boolean> = {
        number_lt: (left, right) => left < right,
        number_lte: (left, right) => left <= right,
        number_gt: (left, right) => left > right,
        number_gte: (left, right) => left >= right,
      };
      const compare = comparisons[assertion.operator];
      if (!compare) return fail('OPERATOR_UNSUPPORTED');
      if (!isFiniteNumber(value) || !isFiniteNumber(expected)) return fail('NUMBER_OPERAND_REQUIRED');
      const passed = compare(value, expected);
      return {assertion_id: assertion.assertion_id, passed, reason: passed ? null : 'NUMBER_COMPARISON_FAILED'};
    }
  }
}

/**
 * Walks a parsed document once and reports the first number the two languages cannot agree about, or `null`
 * when every number is finite and exactly representable. `1e400` is what a response can literally contain,
 * and both `JSON.parse` and `json.loads` turn it into an infinity, so it is refused here rather than typed.
 */
export function findRefusedNumber(value: unknown, maxDepth: number = RESPONSE_PARSE_LIMITS.max_depth): JsonResponseReason | null {
  const stack: {value: unknown; depth: number}[] = [{value, depth: 0}];
  while (stack.length) {
    const frame = stack.pop() as {value: unknown; depth: number};
    if (frame.depth > maxDepth) return 'JSON_NESTING_OVER_LIMIT';
    const candidate = frame.value;
    if (candidate === null || typeof candidate !== 'object') {
      if (typeof candidate !== 'number') continue;
      if (!Number.isFinite(candidate)) return 'JSON_NUMBER_NOT_FINITE';
      // Integral values beyond 2^53-1 are rounded by JavaScript and kept exactly by Python, so the same bytes
      // would give two different documents. Refusing beats picking a winner.
      if (Number.isInteger(candidate) && !Number.isSafeInteger(candidate)) return 'JSON_NUMBER_NOT_LOSSLESS';
      continue;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) stack.push({value: item, depth: frame.depth + 1});
      continue;
    }
    for (const key of Object.keys(candidate)) stack.push({value: (candidate as Record<string, unknown>)[key], depth: frame.depth + 1});
  }
  return null;
}

export function jsonRootKind(document: unknown): JsonRootKind {
  if (document === null) return 'null';
  if (Array.isArray(document)) return 'array';
  switch (typeof document) {
    case 'object': return 'object';
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    default: return 'absent';
  }
}

/**
 * The strict read of one response body, from the bytes that actually arrived.
 *
 * Three layers, in the order that keeps each verdict honest: the byte budget and the UTF-8 decode say what the
 * transport gave us; `JSON.parse` decides JSON grammar (no comments, no trailing comma, no bare `NaN` or
 * `Infinity`, no leading-zero number); and the repository's existing bounded strict document boundary adds what
 * `JSON.parse` is silent about - repeated member names, depth and alias expansion - which is the same pair
 * `collectProbe` already applies to `probe.json`. The returned value is the `JSON.parse` one, because JSON
 * semantics are what the response claims; the strict layer is a gate, not a second interpreter.
 *
 * A JSON `null`, scalar or array root parses: it is a fact about the body, never "not JSON".
 */
export function parseJsonResponse(bytes: Uint8Array, limits: {max_bytes?: number; max_depth?: number} = {}): unknown {
  const maxBytes = limits.max_bytes ?? RESPONSE_PARSE_LIMITS.max_bytes;
  const maxDepth = limits.max_depth ?? RESPONSE_PARSE_LIMITS.max_depth;
  if (bytes.byteLength > maxBytes) throw new JsonResponseError('RESPONSE_BODY_OVER_BUDGET', `${bytes.byteLength} of ${maxBytes} bytes`);
  let text: string;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { throw new JsonResponseError('RESPONSE_BODY_NOT_UTF8', `${bytes.byteLength} bytes`); }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new JsonResponseError('RESPONSE_BODY_NOT_JSON', text.slice(0, 80)); }
  try {
    parseStrictDocument(bytes, 'probe-response.json', {maxBytes, maxDepth, maxAliases: 0});
  } catch (error) {
    throw new JsonResponseError(strictLayerReason(error), String(errorMessage(error)).slice(0, 120));
  }
  const refused = findRefusedNumber(value, maxDepth);
  if (refused) throw new JsonResponseError(refused, text.slice(0, 80));
  return value;
}

const errorMessage = (error: unknown): string =>
  error instanceof ServiceError ? (error.diagnostics.map(item => `${item.code} ${item.message}`).join(' ') || 'refused')
    : error instanceof Error ? error.message : String(error);

/**
 * The strict document boundary only ever reports a text description, so the refusal it caused has to be named
 * from that description. Anything not recognised keeps its own code instead of being called "not JSON", which
 * would blame the body for a strictness rule the body did not break.
 */
function strictLayerReason(error: unknown): JsonResponseReason {
  const message = errorMessage(error);
  if (message.includes('DUPLICATE_KEY')) return 'JSON_DUPLICATE_KEY';
  if (message.includes('exceeds size limit')) return 'RESPONSE_BODY_OVER_BUDGET';
  if (message.includes('not valid UTF-8')) return 'RESPONSE_BODY_NOT_UTF8';
  if (message.includes('nesting or node limit')) return 'JSON_NESTING_OVER_LIMIT';
  if (message.includes('finite plain JSON')) return 'JSON_NUMBER_NOT_FINITE';
  return 'JSON_STRICTNESS_REFUSED';
}

/**
 * The core's own reading of one declaration against one response. The probe's self-reported `passed` and
 * `schema_valid` are never consulted here: they are recomputed from the document and the observed status and
 * media type, so a probe that certifies its own answer cannot make a failed assertion pass.
 *
 * Body shapes the declaration path can address: an object or an array root, because every assertion pointer
 * starts with `/` and therefore selects a member. A scalar or `null` root is valid JSON and stays parseable -
 * it gets `RESPONSE_BODY_ROOT_UNSUPPORTED`, which says no member is addressable, and not "this was not JSON".
 */
export function evaluateDeclaration(declaration: ProbeDeclaration, document: unknown, observed: {
  status_code: number; media_type: string; truncated: boolean;
}): DeclarationEvaluation {
  const diagnostics: string[] = [];
  if (declaration.follow_redirects !== false) diagnostics.push('POLICY_REDIRECT_FOLLOWING_UNSUPPORTED');
  if (declaration.max_response_bytes < 1 || declaration.max_response_bytes > 1024 * 1024) diagnostics.push('RESPONSE_BUDGET_OUT_OF_RANGE');
  if (observed.truncated) diagnostics.push('ARTIFACT_BUDGET_EXCEEDED');
  const status_ok = observed.status_code === declaration.expected_status;
  const media_type_ok = declaration.expected_media_type === undefined || observed.media_type === declaration.expected_media_type;
  const root_kind = jsonRootKind(document);
  const body_parseable = root_kind !== 'absent';
  if (!status_ok) diagnostics.push('STATUS_MISMATCH');
  if (!media_type_ok) diagnostics.push('MEDIA_TYPE_MISMATCH');
  if (!body_parseable) diagnostics.push('RESPONSE_BODY_NOT_JSON');
  else if (root_kind !== 'object' && root_kind !== 'array') diagnostics.push('RESPONSE_BODY_ROOT_UNSUPPORTED');
  // A document holding a non-finite number never came through `parseJsonResponse`; say so instead of letting
  // the assertions below be the only trace of it.
  const refused = findRefusedNumber(document);
  if (refused) diagnostics.push(refused);
  const outcomes = declaration.assertions.map(assertion => evaluateAssertion(document, assertion));
  return {status_ok, media_type_ok, body_parseable, root_kind, outcomes, failed: outcomes.filter(item => !item.passed).length, diagnostics};
}
