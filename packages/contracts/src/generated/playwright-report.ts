/* Generated from JSON Schema; do not edit. */

export interface PlaywrightReport {
  schema_version: "0.1";
  kind: "stackgate-playwright";
  run_id: string;
  check_id: string;
  attempt_id: string;
  started_at: string;
  ended_at: string | null;
  completed: boolean;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  /**
   * @minItems 0
   */
  inventory: {
    test_id: string;
    title: string;
    file: string;
    line: number;
    /**
     * @minItems 0
     */
    annotations: {
      type: string;
      description: string;
    }[];
    only: boolean;
  }[];
  /**
   * @minItems 0
   */
  attempts: {
    test_id: string;
    retry: number;
    expected_status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
    actual_status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
    duration_ms: number;
    /**
     * @minItems 0
     */
    attachments: {
      name: string;
      relative_path: string;
      media_type: string;
      sensitivity: "regular" | "restricted";
    }[];
    /**
     * @minItems 0
     */
    errors: string[];
  }[];
  /**
   * @minItems 0
   */
  requests: {
    test_id: string;
    request_id: string;
    instance_id: string;
    operation_key: string;
    url: string;
    status_code: number;
    backend_observation_ref: string;
  }[];
  /**
   * @minItems 0
   */
  console: {
    test_id: string;
    level: "log" | "info" | "warning" | "error";
    message: string;
    redaction_state: "REDACTED" | "NOT_REQUIRED";
  }[];
}
