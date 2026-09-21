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

export interface RunSeal {
  schema_version: "0.1";
  run_id: string;
  input_hash: string;
  sealed_at: string;
  manifest_hash: string;
  event_log_digest: string;
  artifact_index_digest: string;
  required_artifact_ids: string[];
  artifacts: Artifact[];
  /**
   * @minItems 3
   */
  files: [
    {
      relative_path: string;
      digest: string;
      size: number;
    },
    {
      relative_path: string;
      digest: string;
      size: number;
    },
    {
      relative_path: string;
      digest: string;
      size: number;
    },
    ...{
      relative_path: string;
      digest: string;
      size: number;
    }[]
  ];
}
