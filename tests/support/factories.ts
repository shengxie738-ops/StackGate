import type { CheckFact, GateInput } from '../../packages/contracts/src/index.js';

export function createCheckFact(
  overrides: Partial<CheckFact> = {},
): CheckFact {
  return {
    check_id: 'unit',
    required: true,
    status: 'PASS',
    result_kind: 'junit',
    exit_code: 0,
    expected_test_ids: ['unit-001'],
    executed_test_ids: ['unit-001'],
    discovered_tests: 1,
    executed_tests: 1,
    skipped_tests: 0,
    flaky_tests: 0,
    reasons: [],
    evidence_refs: ['ev-unit-001'],
    ...structuredClone(overrides),
  };
}

export function createGateInput(
  overrides: Partial<GateInput> = {},
): GateInput {
  return {
    checks: [createCheckFact()],
    required_check_ids: ['unit'],
    configuration_valid: true,
    report_integrity: 'VALID',
    freshness: 'FRESH',
    inputs_complete: true,
    task_confirmed: true,
    policy_confirmed: true,
    environment_satisfied: true,
    acceptance_inputs_approved: true,
    canceled: false,
    fatal_error: false,
    deterministic_denials: [],
    ...structuredClone(overrides),
  };
}
