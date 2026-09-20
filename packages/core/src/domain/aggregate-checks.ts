import type { CheckFact } from '../../../contracts/src/index.js';
export interface CheckAggregation { error: boolean; failed: boolean; incomplete: boolean; reasons: string[] }
export function aggregateChecks(checks: readonly CheckFact[], requiredIds: readonly string[]): CheckAggregation {
  const result: CheckAggregation = { error: false, failed: false, incomplete: false, reasons: [] };
  const add = (kind: 'error' | 'failed' | 'incomplete', reason: string) => { result[kind] = true; result.reasons.push(reason); };
  const required = new Set(requiredIds);
  if (requiredIds.length === 0) add('incomplete', 'EMPTY_REQUIRED_SET');
  if (required.size !== requiredIds.length) add('error', 'DUPLICATE_REQUIRED_CHECK_ID');
  const seen = new Set<string>();
  for (const check of checks) {
    const id = check.check_id;
    result.reasons.push(...check.reasons.map(reason => id + ':' + reason));
    if (seen.has(id)) add('error', 'DUPLICATE_CHECK_ID:' + id);
    seen.add(id);
    if (required.has(id) !== check.required) add('error', 'REQUIRED_SET_CONFLICT:' + id);
    if (!required.has(id)) {
      if (check.status !== 'PASS') result.reasons.push('OPTIONAL_CHECK_' + check.status + ':' + id);
      continue;
    }
    if ([check.discovered_tests,check.executed_tests,check.skipped_tests,check.flaky_tests].some(count => !Number.isInteger(count) || count < 0) ||
        new Set(check.executed_test_ids).size !== check.executed_test_ids.length ||
        new Set(check.expected_test_ids).size !== check.expected_test_ids.length ||
        check.executed_test_ids.length > check.executed_tests || check.executed_tests > check.discovered_tests) {
      add('error', 'INVALID_TEST_COUNTS:' + id);
    }
    if (check.status === 'FAIL') add('failed', 'CHECK_FAILED:' + id);
    else if (check.status === 'ERROR') add('error', 'CHECK_ERROR:' + id);
    else if (check.status === 'BLOCKED' || check.status === 'SKIPPED') add('incomplete', 'CHECK_' + check.status + ':' + id);
    else if (check.status !== 'PASS') add('error', 'UNKNOWN_CHECK_STATUS:' + id);
    if (check.status === 'PASS' && check.exit_code !== 0 && check.exit_code !== null) add('error', 'INCONSISTENT_EXIT_CODE:' + id);
    if (check.status === 'PASS' && check.exit_code === null && check.result_kind !== 'contract') add('incomplete', 'PROCESS_COMPLETION_MISSING:' + id);
    if (check.evidence_refs.length === 0) add('incomplete', 'MISSING_REPORT:' + id);
    if (check.result_kind === 'exit-code') {
      if (check.expected_test_ids.length || check.executed_test_ids.length || check.discovered_tests || check.executed_tests || check.skipped_tests || check.flaky_tests) add('error', 'RESULT_KIND_CONFLICT:' + id);
    } else if (['junit', 'probe', 'playwright', 'contract'].includes(check.result_kind)) {
      if (check.result_kind !== 'contract' && (check.executed_tests === 0 || check.discovered_tests === 0)) add('incomplete', 'NO_TESTS:' + id);
      if (check.expected_test_ids.some(test => !check.executed_test_ids.includes(test))) add('incomplete', 'REQUIRED_TEST_MISSING:' + id);
      if (check.skipped_tests > 0) add('incomplete', 'REQUIRED_TEST_SKIPPED:' + id);
      if (check.flaky_tests > 0) add('incomplete', 'FLAKY_REQUIRED_TEST:' + id);
    } else add('error', 'UNKNOWN_RESULT_KIND:' + id);
  }
  for (const id of required) if (!seen.has(id)) add('incomplete', 'REQUIRED_CHECK_MISSING:' + id);
  return result;
}
