/* Generated from JSON Schema; do not edit. */

export interface TaskPayload {
  schema_version: "0.1";
  task_id: string;
  revision: number;
  status: "DRAFT" | "CONFIRMED";
  goal: string;
  target_contract: string;
  /**
   * @minItems 1
   */
  required_operations: [string, ...string[]];
  /**
   * @minItems 1
   */
  required_checks: [string, ...string[]];
  /**
   * @minItems 1
   */
  required_test_ids: [string, ...string[]];
  /**
   * @minItems 1
   */
  allowed_change_paths: [string, ...string[]];
  constraints: {
    preserve_target_contract: true;
    allow_test_deletion: false;
    require_backend_observation: boolean;
    allow_production_targets: false;
  };
  /**
   * @minItems 1
   */
  expected_behavior: [string, ...string[]];
  compatibility: {
    mode: "preserve" | "approved-changes";
    /**
     * @minItems 0
     */
    approved_breaking_rules: {
      operation_key: string;
      rule_id: string;
      baseline_hash: string;
      target_hash: string;
      reason: string;
    }[];
  };
  extensions?: {
    [k: string]: unknown;
  };
}
