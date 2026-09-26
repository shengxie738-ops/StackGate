/* Generated from JSON Schema; do not edit. */

export interface BackendObservation {
  schema_version: "0.1";
  run_id: string;
  check_id: string;
  attempt_id: string;
  request_id: string;
  instance_id: string;
  operation_key: string;
  status_code: number;
  media_type: string;
  started_at: string;
  finished_at: string;
  response_bytes: number;
  response_digest: string;
  digest_input_form: "UNCOMPRESSED_UTF8_BODY_BYTES";
  observation_path: string;
  /**
   * @minItems 3
   */
  excluded_fields: [
    "Authorization" | "Cookie" | "Set-Cookie",
    "Authorization" | "Cookie" | "Set-Cookie",
    "Authorization" | "Cookie" | "Set-Cookie",
    ...("Authorization" | "Cookie" | "Set-Cookie")[]
  ];
}
