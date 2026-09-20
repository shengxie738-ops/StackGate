/* Generated from JSON Schema; do not edit. */

export type Common =
  | Phase
  | CheckStatus
  | Verdict
  | Freshness
  | Decision
  | ExitCode
  | ProvenanceLevel
  | ResultKind
  | SafeId
  | RelativePath
  | Sha256
  | UtcTimestamp
  | OperationKey
  | OperationRef
  | Origin
  | ReasonCode;
export type Phase = "CREATED" | "PLANNED" | "RUNNING" | "FINALIZING" | "COMPLETED" | "CANCELED" | "ABORTED";
export type CheckStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED" | "ERROR";
export type Verdict = "PASS" | "FAIL" | "INCOMPLETE" | "ERROR";
export type Freshness = "FRESH" | "STALE" | "UNVERIFIED";
export type Decision = "ALLOW" | "DENY";
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 64;
export type ProvenanceLevel = "DECLARED" | "OBSERVED" | "CONTROLLED";
export type ResultKind = "exit-code" | "junit" | "probe" | "playwright" | "contract";
export type SafeId = string;
export type RelativePath = string;
export type Sha256 = string;
export type UtcTimestamp = string;
export type OperationKey = string;
export type OperationRef = string;
export type Origin = string;
export type ReasonCode =
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
