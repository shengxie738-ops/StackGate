/* Generated from JSON Schema; do not edit. */

export interface ProjectConfig {
  schema_version: "0.1";
  project_id: string;
  state_dir: string;
  workspaces: {
    [k: string]: {
      path: string;
      kind: "typescript" | "fastapi";
    };
  };
  contracts: {
    [k: string]: {
      baseline_file: string;
      target_file: string;
      candidate_artifact: string;
      version: "3.1";
      external_refs: "deny";
    };
  };
  commands: {
    [k: string]: {
      workspace: string;
      exec: string;
      /**
       * @minItems 0
       */
      args: string[];
      timeout_seconds: number;
      extensions?: {
        [k: string]: unknown;
      };
    };
  };
  checks: {
    [k: string]:
      | {
          adapter: "openapi";
          service: string;
          candidate_command: string;
        }
      | {
          adapter: "command";
          command: string;
          result_kind: "exit-code";
        }
      | {
          adapter: "junit";
          command: string;
          min_tests: number;
        }
      | {
          adapter: "stackgate-probe";
          command: string;
          /**
           * @minItems 1
           */
          required_operations: [string, ...string[]];
        }
      | {
          adapter: "playwright";
          command: string;
          /**
           * @minItems 1
           */
          required_test_ids: [string, ...string[]];
          require_real_backend: boolean;
        };
  };
  profiles: {
    [k: string]: {
      /**
       * @minItems 1
       */
      required_checks: [string, ...string[]];
      environment: string;
      minimum_provenance: "DECLARED" | "OBSERVED" | "CONTROLLED";
      unknown_impact: "workspace-regression" | "incomplete";
      flaky_policy: "incomplete";
    };
  };
  environments: {
    [k: string]:
      | {
          mode: "attach";
          frontend_origin: string;
          backend_origin: string;
          health_path: string;
          provenance_file: string;
        }
      | {
          mode: "compose";
          compose_file: string;
          /**
           * @minItems 1
           */
          services: [string, ...string[]];
          health_path?: string;
          data_revision: string;
        };
  };
  security: {
    /**
     * @minItems 0
     */
    env_allowlist: string[];
    /**
     * @minItems 0
     */
    allow_origins: string[];
    /**
     * @minItems 1
     */
    protected_inputs: [string, ...string[]];
    telemetry: "off";
    extensions?: {
      stackgate_v0_1?: {
        /**
         * @minItems 1
         */
        allowed_environment_bindings: [string, ...string[]];
      };
      [k: string]: unknown;
    };
  };
  extensions?: {
    stackgate_v0_1?: {
      environment_bindings?: {
        [k: string]: {
          [k: string]: {
            service: string;
            container_port: number;
            protocol: "http" | "https";
            publish_host: "127.0.0.1";
          };
        };
      };
    };
    [k: string]: unknown;
  };
}
