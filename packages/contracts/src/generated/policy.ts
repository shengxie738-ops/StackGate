/* Generated from JSON Schema; do not edit. */

/**
 * Merge direction: union required_set/protected_inputs; intersect allowed_origins/allowed_paths; maximum minimum_provenance. Structural validation does not authenticate source.
 */
export type EffectivePolicy = {
  [k: string]: unknown;
} & {
  schema_version: "0.1";
  policy_id: string;
  policy_hash: string;
  /**
   * @minItems 1
   */
  required_set: [string, ...string[]];
  /**
   * @minItems 0
   */
  allowed_origins: string[];
  /**
   * @minItems 0
   */
  allowed_paths: string[];
  /**
   * @minItems 1
   */
  protected_inputs: [string, ...string[]];
  minimum_provenance: "DECLARED" | "OBSERVED" | "CONTROLLED";
  /**
   * @minItems 0
   */
  approved_change_records: {
    operation_key: string;
    rule_id: string;
    baseline_hash: string;
    target_hash: string;
    reason: string;
  }[];
  flaky_policy: "incomplete";
  source: "local-review" | "trusted-ci";
  trusted_source_ref?: string;
};
