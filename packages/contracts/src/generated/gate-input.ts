/* Generated from JSON Schema; do not edit. */

export interface GateInput {
  /**
   * @minItems 0
   */
  checks: CheckFact[];
  /**
   * @minItems 0
   */
  required_check_ids: string[];
  configuration_valid: boolean;
  report_integrity: "VALID" | "INVALID" | "UNVERIFIED";
  freshness: "FRESH" | "STALE" | "UNVERIFIED";
  inputs_complete: boolean;
  task_confirmed: boolean;
  policy_confirmed: boolean;
  environment_satisfied: boolean;
  acceptance_inputs_approved: boolean;
  canceled: boolean;
  fatal_error: boolean;
  /**
   * @minItems 0
   */
  deterministic_denials: string[];
}
export interface CheckFact {
  check_id: string;
  required: boolean;
  status: "PASS" | "FAIL" | "BLOCKED" | "SKIPPED" | "ERROR";
  result_kind: "exit-code" | "junit" | "probe" | "playwright" | "contract";
  exit_code: number | null;
  /**
   * @minItems 0
   */
  expected_test_ids: string[];
  /**
   * @minItems 0
   */
  executed_test_ids: string[];
  discovered_tests: number;
  executed_tests: number;
  skipped_tests: number;
  flaky_tests: number;
  /**
   * @minItems 0
   */
  reasons: string[];
  /**
   * @minItems 0
   */
  evidence_refs: string[];
}
