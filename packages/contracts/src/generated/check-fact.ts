/* Generated from JSON Schema; do not edit. */

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
