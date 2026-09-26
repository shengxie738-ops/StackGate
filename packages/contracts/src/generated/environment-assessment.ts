/* Generated from JSON Schema; do not edit. */

export interface EnvironmentAssessment {
  schema_version: "0.1";
  run_id: string;
  input_hash: string;
  required_by_task: boolean;
  data_revision: string;
  provenance: "DECLARED" | "OBSERVED" | "CONTROLLED";
  satisfied: boolean;
  prepare_ref: string;
  finalization_ref: string;
  cleanup_ref: string;
  /**
   * @minItems 1
   */
  observation_refs: [string, ...string[]];
  /**
   * @minItems 0
   */
  reasons: string[];
}
