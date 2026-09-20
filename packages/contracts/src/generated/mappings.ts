/* Generated from JSON Schema; do not edit. */

export interface ConsumerMappings {
  schema_version: "0.1";
  mappings: {
    operation_key: string;
    /**
     * @minItems 1
     */
    consumer_paths: [string, ...string[]];
    check_ids: string[];
    test_ids: string[];
    workspace: string;
    generated_client?: {
      path: string;
      metadata_source: string;
    };
  }[];
}
