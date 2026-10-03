import {expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {PointerAssertion} from '../../packages/core/src/services/probe-assertions.js';
import {JsonResponseError, jsonRootKind, parseJsonResponse} from '../../packages/core/src/services/probe-assertions.js';
import {evaluateAssertion} from '../../packages/core/src/services/probe-assertions.js';

/**
 * V2-R04 closes V2-F06 by making one rule set apply in both languages. A TypeScript-only test can prove the
 * TypeScript side is self-consistent, which is exactly how an inherited-property or non-finite-number rule
 * can pass here and still disagree with the Python helper that performs the real request. So every case in
 * `tests/fixtures/v2-regressions/assertions.json` is run twice - once through the core evaluator, once
 * through `probe_helpers.py` in a real interpreter - and the two observations must agree with each other and
 * with the fixture. A case missing from either side fails, because an unrun comparison proves nothing.
 */
const fixturePath = path.resolve('tests/fixtures/v2-regressions/assertions.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  assertion_cases: {name: string; body: string; body_hex?: string; pointer: string; operator: string;
    expected?: unknown; expected_passed: boolean; expected_reason: string | null}[];
  parse_cases: {name: string; body?: string; body_hex?: string; max_bytes?: number; max_depth?: number;
    expected_status: 'parsed' | 'refused'; expected_reason: string | null; expected_root: string | null}[];
};

type AssertionRow = {name: string; passed: boolean; reason: string | null};
type ParseRow = {name: string; status: string; reason: string | null; root: string | null};

/** A plain string body is compared as the agreed uncompressed UTF-8 bytes; `body_hex` carries bytes that no
 *  UTF-8 text could express, such as a truncated multi-byte sequence. */
const bodyBytes = (case_: {body?: string; body_hex?: string}): Uint8Array =>
  new Uint8Array(Buffer.from(case_.body_hex !== undefined ? case_.body_hex : case_.body ?? '',
    case_.body_hex !== undefined ? 'hex' : 'utf8'));

function pythonRows(): {assertion: AssertionRow[]; parse: ParseRow[]} {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, ['-B', '-E', path.resolve('tests/support/v2_assertion_cases.py'), fixturePath],
    {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
  if (result.error) throw result.error;
  expect(result.status, `python parity harness exited ${result.status}: ${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as {assertion: AssertionRow[]; parse: ParseRow[]};
}

const observed = pythonRows();

it('runs every fixture case on both sides, with no case dropped by either', () => {
  expect(observed.assertion.map(row => row.name).sort()).toEqual(fixture.assertion_cases.map(item => item.name).sort());
  expect(observed.parse.map(row => row.name).sort()).toEqual(fixture.parse_cases.map(item => item.name).sort());
});

it.each(fixture.assertion_cases)('assertion $name', case_ => {
  const document = JSON.parse(case_.body) as unknown;
  const assertion = {assertion_id: case_.name, pointer: case_.pointer, operator: case_.operator,
    ...('expected' in case_ ? {expected: case_.expected} : {})} as unknown as PointerAssertion;
  const outcome = evaluateAssertion(document, assertion);
  // The evaluator's own refusal must match the table it is claimed to implement...
  expect({passed: outcome.passed, reason: outcome.reason ?? null}, case_.name)
    .toEqual({passed: case_.expected_passed, reason: case_.expected_reason});
  // ...and match what the interpreter that performs the request decided for the same bytes.
  const pythonRow = observed.assertion.find(row => row.name === case_.name);
  expect(pythonRow, `python harness reported no row for ${case_.name}`).toBeTruthy();
  expect({passed: pythonRow!.passed, reason: pythonRow!.reason}, `${case_.name} disagrees between languages`)
    .toEqual({passed: outcome.passed, reason: outcome.reason ?? null});
});

it.each(fixture.parse_cases)('parse $name', case_ => {
  const limits: {max_bytes?: number; max_depth?: number} = {};
  if (case_.max_bytes !== undefined) limits.max_bytes = case_.max_bytes;
  if (case_.max_depth !== undefined) limits.max_depth = case_.max_depth;
  const bytes = bodyBytes(case_);
  let tsRow: ParseRow;
  try {
    const document = parseJsonResponse(bytes, limits);
    tsRow = {name: case_.name, status: 'parsed', reason: null, root: jsonRootKind(document)};
  } catch (error) {
    if (!(error instanceof JsonResponseError)) throw error;
    tsRow = {name: case_.name, status: 'refused', reason: error.reason, root: null};
  }
  expect({status: tsRow.status, reason: tsRow.reason, root: tsRow.root}, case_.name)
    .toEqual({status: case_.expected_status, reason: case_.expected_reason, root: case_.expected_root});
  const pythonRow = observed.parse.find(row => row.name === case_.name);
  expect(pythonRow, `python harness reported no row for ${case_.name}`).toBeTruthy();
  expect(pythonRow, `${case_.name} disagrees between languages`)
    .toEqual({name: case_.name, status: tsRow.status, reason: tsRow.reason, root: tsRow.root});
});
