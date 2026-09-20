/* Generated from JSON Schema; do not edit. */

export interface GateEvaluationDocument {
  schema_version: "0.1";
  verdict: "PASS" | "FAIL" | "INCOMPLETE" | "ERROR";
  freshness: "FRESH" | "STALE" | "UNVERIFIED";
  decision: "ALLOW" | "DENY";
  exit_code: 0 | 1 | 2 | 3 | 4 | 64;
  /**
   * @minItems 0
   */
  reasons: string[];
  run_id: string;
  policy_hash: string;
  evaluated_at: string;
}
