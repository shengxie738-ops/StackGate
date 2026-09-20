/* Generated from JSON Schema; do not edit. */

export type RunManifest = {
  [k: string]: unknown;
} & {
  schema_version: "0.1";
  run_id: string;
  plan_id: string;
  phase: "CREATED" | "PLANNED" | "RUNNING" | "FINALIZING" | "COMPLETED" | "CANCELED" | "ABORTED";
  verdict: "PASS" | "FAIL" | "INCOMPLETE" | "ERROR";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  task_id: string;
  task_revision: number;
  repo_id: string;
  worktree_id: string;
  base_oid: string;
  git_object_format: "sha1" | "sha256";
  input_hash: string;
  plan_hash: string;
  policy_hash: string;
  target_contract_hashes: {
    [k: string]: string;
  };
  tool_versions: {
    [k: string]: string;
  };
  environment_ref: string | null;
  data_revision: string;
  /**
   * @minItems 0
   */
  checks: CheckResult[];
  /**
   * @minItems 0
   */
  artifact_refs: string[];
  /**
   * @minItems 0
   */
  coverage_gaps: string[];
  canceled: boolean;
  previous_run_id?: string;
};

export interface CheckResult {
  schema_version: "0.1";
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
  run_id: string;
  step_id: string;
  attempt_id: string;
  /**
   * @minItems 0
   */
  attempts: {
    attempt_id: string;
    started_at: string;
    finished_at: string | null;
    raw_exit_code: number | null;
    status: "PASS" | "FAIL" | "BLOCKED" | "SKIPPED" | "ERROR";
    /**
     * @minItems 0
     */
    evidence_refs: string[];
  }[];
}
