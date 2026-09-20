/* Generated from JSON Schema; do not edit. */

export type RunEvent =
  | {
      schema_version: "0.1";
      event_id: string;
      run_id: string;
      seq: number;
      at: string;
      type: "run.started";
      payload: {
        payload_version: "0.1";
        plan_id: string;
        input_hash: string;
      };
    }
  | {
      schema_version: "0.1";
      event_id: string;
      run_id: string;
      seq: number;
      at: string;
      type: "check.started";
      payload: {
        payload_version: "0.1";
        check_id: string;
        step_id: string;
        attempt_id: string;
      };
    }
  | {
      schema_version: "0.1";
      event_id: string;
      run_id: string;
      seq: number;
      at: string;
      type: "check.finished";
      payload: {
        payload_version: "0.1";
        check_result: CheckResult;
      };
    }
  | {
      schema_version: "0.1";
      event_id: string;
      run_id: string;
      seq: number;
      at: string;
      type: "artifact.saved";
      payload: {
        payload_version: "0.1";
        artifact: Artifact;
      };
    }
  | {
      schema_version: "0.1";
      event_id: string;
      run_id: string;
      seq: number;
      at: string;
      type: "run.finalized";
      payload: {
        payload_version: "0.1";
        phase: "COMPLETED" | "CANCELED" | "ABORTED";
        verdict: "PASS" | "FAIL" | "INCOMPLETE" | "ERROR";
      };
    }
  | {
      schema_version: "0.1";
      event_id: string;
      run_id: string;
      seq: number;
      at: string;
      type: "run.canceled";
      payload: {
        payload_version: "0.1";
        reason: string;
      };
    }
  | {
      schema_version: "0.1";
      event_id: string;
      run_id: string;
      seq: number;
      at: string;
      type: "run.aborted";
      payload: {
        payload_version: "0.1";
        reason: string;
      };
    }
  | {
      schema_version: "0.1";
      event_id: string;
      run_id: string;
      seq: number;
      at: string;
      type: "run.phase_changed";
      payload: {
        payload_version: "0.1";
        from: ("CREATED" | "PLANNED" | "RUNNING" | "FINALIZING" | "COMPLETED" | "CANCELED" | "ABORTED") | null;
        to: "CREATED" | "PLANNED" | "RUNNING" | "FINALIZING" | "COMPLETED" | "CANCELED" | "ABORTED";
      };
    };
export type Artifact = {
  [k: string]: unknown;
} & {
  schema_version: "0.1";
  artifact_id: string;
  run_id: string;
  check_id: string | null;
  attempt_id: string | null;
  relative_path: string;
  media_type: string;
  size: number;
  digest: string;
  sensitivity: "regular" | "restricted";
  redaction_state: "REDACTED" | "NOT_REQUIRED" | "UNREDACTED" | "UNKNOWN";
  retention?: {
    original_bytes: number;
    retained_bytes: number;
    truncated: boolean;
    reason: null | "ARTIFACT_BUDGET_EXCEEDED" | "REDACTION_LINE_LIMIT";
    critical: boolean;
  };
  artifact_kind: "log" | "report" | "contract" | "trace" | "screenshot" | "observation";
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
