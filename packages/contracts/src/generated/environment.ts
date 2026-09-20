/* Generated from JSON Schema; do not edit. */

export interface EnvironmentManifest {
  schema_version: "0.1";
  run_id: string;
  mode: "attach" | "compose";
  status: "READY" | "BLOCKED" | "ERROR" | "CLEANED" | "UNKNOWN";
  frontend_origin: string | null;
  backend_origin: string | null;
  instance_id: string | null;
  provenance: "DECLARED" | "OBSERVED" | "CONTROLLED";
  input_hash: string;
  /**
   * @minItems 0
   */
  image_ids: string[];
  /**
   * @minItems 0
   */
  resources: {
    run_id: string;
    owner_token: string;
    resource_type: "process" | "container" | "network" | "volume";
    native_id: string;
    created_at: string;
    creation_identity: string;
    created_by_stackgate: boolean;
    cleanup_status: "PENDING" | "CLEANED" | "PRESERVED" | "FAILED" | "UNKNOWN";
  }[];
  data_revision: string;
  /**
   * @minItems 0
   */
  observations: string[];
  /**
   * @minItems 0
   */
  reasons: string[];
  bindings?: {
    [k: string]: {
      service: string;
      container_port: number;
      host_port: number;
      protocol: "http" | "https";
      publish_host: "127.0.0.1";
      container_id: string;
      origin: string;
    };
  };
}
