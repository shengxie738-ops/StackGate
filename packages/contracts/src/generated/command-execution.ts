/* Generated from JSON Schema; do not edit. */

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

export interface CommandExecution {
  schema_version: "0.1";
  kind: "stackgate-command-execution";
  run_id: string;
  check_id: string;
  step_id: string;
  attempt_id: string;
  command_id: string;
  started_at: string;
  finished_at: string;
  result: {
    status: "EXITED" | "TIMED_OUT" | "CANCELED" | "ERROR";
    raw_exit_code: number | null;
    signal: string | null;
    process: null | {
      pid: number;
      creation_identity: string;
      owner_token: string;
    };
    artifacts: Artifact[];
    diagnostics: {
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
    execution?: {
      command_id: string;
      command_hash: string;
      authorization_hash: string;
      executable_digest: string;
    };
    output?: {
      original_bytes: number;
      retained_bytes: number;
      truncated: boolean;
      reason: null | "ARTIFACT_BUDGET_EXCEEDED" | "REDACTION_LINE_LIMIT";
      streams?: {
        stdout: StreamRetention;
        stderr: StreamRetention;
      };
    };
    provenance?: {
      mechanism: string;
      broker_version?: string;
      cleanup: "VERIFIED" | "UNVERIFIED";
    };
  };
}
export interface StreamRetention {
  original_bytes: number;
  retained_bytes: number;
  truncated: boolean;
  reason: null | "ARTIFACT_BUDGET_EXCEEDED" | "REDACTION_LINE_LIMIT";
}
