/* Generated from JSON Schema; do not edit. */

export interface ProbeDeclaration {
  schema_version: "0.1";
  declaration_id: string;
  operation_key: string;
  expected_status: number;
  expected_media_type?: string;
  deadline_ms: number;
  max_response_bytes: number;
  follow_redirects: false;
  /**
   * @minItems 1
   */
  assertions: [
    {
      assertion_id: string;
      pointer: string;
      operator: "exists" | "type" | "equals" | "number_lt" | "number_lte" | "number_gt" | "number_gte";
      expected?: string | number | boolean | null;
    },
    ...{
      assertion_id: string;
      pointer: string;
      operator: "exists" | "type" | "equals" | "number_lt" | "number_lte" | "number_gt" | "number_gte";
      expected?: string | number | boolean | null;
    }[]
  ];
}
