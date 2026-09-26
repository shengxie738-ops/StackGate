/* Generated from JSON Schema; do not edit. */

export interface EnvironmentCleanup {
  schema_version: "0.1";
  run_id: string;
  cleaned_at: string;
  status: "CLEANED" | "PARTIAL" | "PRESERVED" | "FAILED" | "UNKNOWN";
  trigger: "COMPLETED" | "FAILED" | "CANCELED" | "ERROR";
  /**
   * @minItems 0
   */
  resources: {
    resource_type: "process" | "container" | "network" | "volume";
    native_id: string;
    owner_token: string;
    run_id: string;
    created_by_stackgate: boolean;
    cleanup_status: "PENDING" | "CLEANED" | "PRESERVED" | "FAILED" | "UNKNOWN";
    ownership_basis: string;
  }[];
  /**
   * @minItems 1
   */
  evidence_refs: [string, ...string[]];
  /**
   * @minItems 0
   */
  reasons: string[];
}
