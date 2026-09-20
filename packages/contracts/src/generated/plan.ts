/* Generated from JSON Schema; do not edit. */

export type CheckStep = {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  step_id: string;
  check_id: string;
  adapter_id: "command" | "junit" | "openapi" | "stackgate-probe" | "playwright" | "environment";
  command_id: string | null;
  /**
   * @minItems 0
   */
  depends_on: string[];
  required: boolean;
  timeout_ms: number;
  /**
   * @minItems 0
   */
  resource_locks: string[];
  /**
   * @minItems 0
   */
  expected_artifacts: string[];
  /**
   * @minItems 0
   */
  expected_test_ids: string[];
  min_tests: number | null;
  parameters:
    | {
        adapter_id: "command";
        result_kind: "exit-code";
      }
    | {
        adapter_id: "junit";
        report_name: "junit.xml";
      }
    | {
        adapter_id: "openapi";
        service: string;
        candidate_artifact: "candidate-openapi.json";
      }
    | {
        adapter_id: "stackgate-probe";
        /**
         * @minItems 1
         */
        required_operations: [string, ...string[]];
      }
    | {
        adapter_id: "playwright";
        /**
         * @minItems 1
         */
        required_test_ids: [string, ...string[]];
        require_real_backend: boolean;
      }
    | {
        adapter_id: "environment";
        environment_id: string;
      };
} & {
  step_id: string;
  check_id: string;
  adapter_id: "command" | "junit" | "openapi" | "stackgate-probe" | "playwright" | "environment";
  command_id: string | null;
  /**
   * @minItems 0
   */
  depends_on: string[];
  required: boolean;
  timeout_ms: number;
  /**
   * @minItems 0
   */
  resource_locks: string[];
  /**
   * @minItems 0
   */
  expected_artifacts: string[];
  /**
   * @minItems 0
   */
  expected_test_ids: string[];
  min_tests: number | null;
  parameters:
    | {
        adapter_id: "command";
        result_kind: "exit-code";
      }
    | {
        adapter_id: "junit";
        report_name: "junit.xml";
      }
    | {
        adapter_id: "openapi";
        service: string;
        candidate_artifact: "candidate-openapi.json";
      }
    | {
        adapter_id: "stackgate-probe";
        /**
         * @minItems 1
         */
        required_operations: [string, ...string[]];
      }
    | {
        adapter_id: "playwright";
        /**
         * @minItems 1
         */
        required_test_ids: [string, ...string[]];
        require_real_backend: boolean;
      }
    | {
        adapter_id: "environment";
        environment_id: string;
      };
};

export interface CheckPlan {
  schema_version: "0.1";
  plan_id: string;
  task_id: string;
  task_revision: number;
  profile: string;
  input_hash: string;
  policy_hash: string;
  target_contract_hashes: {
    [k: string]: string;
  };
  toolchain_hash: string;
  environment_requirements_hash: string;
  /**
   * @minItems 1
   */
  required_check_ids: [string, ...string[]];
  /**
   * @minItems 1
   */
  steps: [CheckStep, ...CheckStep[]];
  plan_hash: string;
}
