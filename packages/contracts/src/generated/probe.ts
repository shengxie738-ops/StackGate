/* Generated from JSON Schema; do not edit. */

export interface ProbeReport {
  schema_version: "0.1";
  kind: "stackgate-probe";
  run_id: string;
  check_id: string;
  attempt_id: string;
  instance_id: string;
  /**
   * @minItems 0
   */
  operations: {
    operation_key: string;
    request_id: string;
    status_code: number;
    media_type: string;
    schema_valid: boolean;
    response_body?: unknown;
    /**
     * @minItems 0
     */
    assertions: {
      assertion_id: string;
      passed: boolean;
    }[];
    backend_observation_ref: string;
  }[];
  completed: boolean;
}
