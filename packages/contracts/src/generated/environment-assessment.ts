/* Generated from JSON Schema; do not edit. */

export interface EnvironmentAssessment {
  schema_version: "0.1";
  run_id: string;
  input_hash: string;
  required_by_task: boolean;
  data_revision: string;
  provenance: "DECLARED" | "OBSERVED" | "CONTROLLED";
  satisfied: boolean;
  environment_required?: boolean;
  prepare_ref: string | null;
  finalization_ref: string | null;
  cleanup_ref: string | null;
  /**
   * @minItems 0
   */
  observation_refs: string[];
  /**
   * @minItems 0
   */
  reasons: string[];
}
