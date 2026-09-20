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
