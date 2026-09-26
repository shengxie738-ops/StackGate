/* Generated from JSON Schema; do not edit. */

export interface EnvironmentFinalization {
  schema_version: "0.1";
  run_id: string;
  phase: "finalize";
  observed_at: string;
  provenance: "DECLARED" | "OBSERVED" | "CONTROLLED";
  instance_id: string | null;
  input_hash: string;
  data_revision: string;
  frontend_origin: string | null;
  backend_origin: string | null;
  requests_observed: number;
  instance_changed: boolean;
  /**
   * @minItems 1
   */
  evidence_refs: [string, ...string[]];
  /**
   * @minItems 0
   */
  reasons: string[];
}
