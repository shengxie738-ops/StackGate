/* Generated from JSON Schema; do not edit. */

export type ConfirmationRecord = {
  [k: string]: unknown;
} & {
  schema_version: "0.1";
  task_id: string;
  revision: number;
  payload_hash: string;
  target_hashes: {
    [k: string]: string;
  };
  protected_input_hash: string;
  confirmed_at: string;
  confirmation_source: "local-review" | "trusted-ci";
  trusted_source_ref?: string;
};
