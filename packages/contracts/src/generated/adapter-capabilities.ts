/* Generated from JSON Schema; do not edit. */

export interface AdapterCapabilities {
  schema_version: "0.1";
  adapter_id: string;
  version: string;
  /**
   * @minItems 1
   */
  platforms: ["win32" | "linux" | "darwin", ...("win32" | "linux" | "darwin")[]];
  /**
   * @minItems 0
   */
  schema_dialects: string[];
  /**
   * @minItems 0
   */
  schema_features: string[];
  /**
   * @minItems 0
   */
  evidence_formats: string[];
  /**
   * @minItems 0
   */
  provenance_levels: ("DECLARED" | "OBSERVED" | "CONTROLLED")[];
  status: "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";
  /**
   * @minItems 0
   */
  limitations: string[];
}
