import type {ProbeDeclaration} from '../../../contracts/src/index.js';

export interface ProbeAssertionOutcome {
  assertion_id: string;
  passed: boolean;
  reason: string | null;
}

export interface DeclarationEvaluation {
  status_ok: boolean;
  media_type_ok: boolean;
  body_parseable: boolean;
  outcomes: ProbeAssertionOutcome[];
  failed: number;
  diagnostics: string[];
}

function pointerTokens(pointer: string): string[] | null {
  if (!pointer.startsWith('/') || pointer.includes('//')) return null;
  return pointer.slice(1).split('/').map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function resolve(document: unknown, tokens: readonly string[]): {found: boolean; value: unknown} {
  let current: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(token) || Number(token) >= current.length) return {found: false, value: undefined};
      current = current[Number(token)];
      continue;
    }
    if (current !== null && typeof current === 'object' && token in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return {found: false, value: undefined};
  }
  return {found: true, value: current};
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Restricted, deterministic evaluation. No expression, no user code, no model judgement. */
export function evaluateAssertion(document: unknown, assertion: ProbeDeclaration['assertions'][number]): ProbeAssertionOutcome {
  const tokens = pointerTokens(assertion.pointer);
  if (tokens === null) return {assertion_id: assertion.assertion_id, passed: false, reason: 'POINTER_INVALID'};
  const {found, value} = resolve(document, tokens);
  const expected = (assertion as {expected?: unknown}).expected;
  switch (assertion.operator) {
    case 'exists':
      return {assertion_id: assertion.assertion_id, passed: found, reason: found ? null : 'POINTER_NOT_FOUND'};
    case 'type': {
      if (!found) return {assertion_id: assertion.assertion_id, passed: false, reason: 'POINTER_NOT_FOUND'};
      const kinds: Record<string, (candidate: unknown) => boolean> = {
        string: candidate => typeof candidate === 'string',
        number: candidate => isFiniteNumber(candidate) || candidate === Infinity || candidate === -Infinity,
        boolean: candidate => typeof candidate === 'boolean',
        null: candidate => candidate === null,
      };
      const check = kinds[String(expected)];
      if (!check) return {assertion_id: assertion.assertion_id, passed: false, reason: 'TYPE_EXPECTED_UNKNOWN'};
      return {assertion_id: assertion.assertion_id, passed: check(value), reason: check(value) ? null : 'TYPE_MISMATCH'};
    }
    case 'equals': {
      if (!found) return {assertion_id: assertion.assertion_id, passed: false, reason: 'POINTER_NOT_FOUND'};
      const strict = typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null;
      const passed = strict && value === expected;
      return {assertion_id: assertion.assertion_id, passed, reason: passed ? null : 'VALUE_MISMATCH'};
    }
    default: {
      if (!found) return {assertion_id: assertion.assertion_id, passed: false, reason: 'POINTER_NOT_FOUND'};
      const comparisons: Record<string, (left: number, right: number) => boolean> = {
        number_lt: (left, right) => left < right,
        number_lte: (left, right) => left <= right,
        number_gt: (left, right) => left > right,
        number_gte: (left, right) => left >= right,
      };
      const compare = comparisons[assertion.operator];
      if (!compare) return {assertion_id: assertion.assertion_id, passed: false, reason: 'OPERATOR_UNSUPPORTED'};
      if (!isFiniteNumber(value) || !isFiniteNumber(expected)) {
        return {assertion_id: assertion.assertion_id, passed: false, reason: 'NUMBER_OPERAND_REQUIRED'};
      }
      const passed = compare(value, expected);
      return {assertion_id: assertion.assertion_id, passed, reason: passed ? null : 'NUMBER_COMPARISON_FAILED'};
    }
  }
}

export function evaluateDeclaration(declaration: ProbeDeclaration, document: unknown, observed: {
  status_code: number; media_type: string; truncated: boolean;
}): DeclarationEvaluation {
  const diagnostics: string[] = [];
  if (declaration.follow_redirects !== false) diagnostics.push('POLICY_REDIRECT_FOLLOWING_UNSUPPORTED');
  if (declaration.max_response_bytes < 1 || declaration.max_response_bytes > 1024 * 1024) diagnostics.push('RESPONSE_BUDGET_OUT_OF_RANGE');
  if (observed.truncated) diagnostics.push('ARTIFACT_BUDGET_EXCEEDED');
  const status_ok = observed.status_code === declaration.expected_status;
  const media_type_ok = declaration.expected_media_type === undefined || observed.media_type === declaration.expected_media_type;
  const body_parseable = document !== null && typeof document === 'object';
  if (!status_ok) diagnostics.push('STATUS_MISMATCH');
  if (!media_type_ok) diagnostics.push('MEDIA_TYPE_MISMATCH');
  if (!body_parseable) diagnostics.push('RESPONSE_BODY_NOT_JSON');
  const outcomes = declaration.assertions.map(assertion => evaluateAssertion(document, assertion));
  return {status_ok, media_type_ok, body_parseable, outcomes, failed: outcomes.filter(item => !item.passed).length, diagnostics};
}
