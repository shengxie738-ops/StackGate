/* Generated from JSON Schema; do not edit. */

export type Diagnostics = {
  code:
    | "CONFIG_INVALID"
    | "TASK_UNCONFIRMED"
    | "EXECUTION_UNTRUSTED"
    | "BASELINE_UNAVAILABLE"
    | "PLAN_STALE"
    | "INPUT_STALE"
    | "UNSUPPORTED_SCHEMA"
    | "CONTRACT_MISMATCH"
    | "UNRESOLVED_IMPACT"
    | "PROTECTED_INPUT_CHANGED"
    | "NO_TESTS"
    | "REQUIRED_TEST_MISSING"
    | "MISSING_REPORT"
    | "REPORT_INVALID"
    | "ENV_PROVENANCE_INSUFFICIENT"
    | "ENV_INSTANCE_MISMATCH"
    | "FLAKY_REQUIRED_TEST"
    | "ARTIFACT_BUDGET_EXCEEDED"
    | "RESOURCE_OWNERSHIP_UNVERIFIED"
    | "POLICY_WEAKEN_ATTEMPT"
    | "UNSUPPORTED_CAPABILITY"
    | "TOOL_FAILURE"
    | "RUN_CANCELED"
    | "DEPENDENCY_BLOCKED";
  rule_id?: string;
  message: string;
  location: string;
  observed_facts: {
    [k: string]: unknown;
  };
  recommended_action: string;
  source: string;
}[];

export interface RunCompletion {
  schema_version: "0.1";
  run_id: string;
  plan_id: string;
  recorded_at: string;
  pre_context_hash: string;
  post_context_hash: string | null;
  post_input_hash: string | null;
  post_freshness: "FRESH" | "STALE" | "UNVERIFIED";
  post_task_confirmed: boolean;
  post_trust_valid: boolean;
  canceled: boolean;
  fatal_error: boolean;
  diagnostics: Diagnostics;
  scheduler_timings: {
    [k: string]: {
      queued_at: string;
      started_at: string | null;
      finished_at: string | null;
      waiting_ms: number;
      execution_ms: number;
    };
  };
}
