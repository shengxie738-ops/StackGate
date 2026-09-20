/* Generated from JSON Schema; do not edit. */

/**
 * Execution authorization is separate from business confirmation. Only a trusted loader can authenticate this record's origin.
 */
export type TrustRecord = {
  [k: string]: unknown;
} & {
  schema_version: "0.1";
  trust_id: string;
  repo_id: string;
  input_hash: string;
  command_hash: string;
  /**
   * @minItems 1
   */
  allowed_command_ids: [string, ...string[]];
  /**
   * @minItems 0
   */
  allowed_origins: string[];
  /**
   * @minItems 0
   */
  allowed_paths: string[];
  granted_at: string;
  expires_at: string;
  trust_source: "local-execution" | "trusted-ci";
  trusted_source_ref?: string;
};
