/* Generated from JSON Schema; do not edit. */

export interface Finding {
  schema_version: "0.1";
  finding_id: string;
  rule_id: string;
  category: "contract" | "consumer" | "runtime" | "evidence" | "policy" | "environment" | "tool";
  severity: "info" | "warning" | "error";
  message: string;
  observed_facts: {
    [k: string]: unknown;
  };
  suggested_cause: string | null;
  recommended_action: string;
  /**
   * @minItems 0
   */
  locations: {
    source: "baseline" | "target" | "candidate" | "workspace" | "runtime";
    relative_path: string;
    pointer: string;
  }[];
  /**
   * @minItems 0
   */
  evidence_refs: string[];
}
