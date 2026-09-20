/* Generated from JSON Schema; do not edit. */

export type InputManifest = {
  [k: string]: unknown;
} & {
  schema_version: "0.1";
  repo_id: string;
  worktree_id: string;
  platform_id: string;
  base_oid: string;
  head_oid: string;
  target_tip_oid: string;
  git_object_format: "sha1" | "sha256";
  /**
   * @minItems 0
   */
  files: (
    | {
        relative_path: string;
        kind: "file";
        digest: string;
        mode: "100644" | "100755";
        tracked: boolean;
        staged: boolean;
        unstaged: boolean;
      }
    | {
        relative_path: string;
        kind: "deleted";
        digest: null;
        mode: string | null;
        tracked: boolean;
        staged: boolean;
        unstaged: boolean;
      }
    | {
        relative_path: string;
        kind: "symlink";
        digest: string;
        mode: "120000";
        link_target: string;
        tracked: boolean;
        staged: boolean;
        unstaged: boolean;
      }
  )[];
  /**
   * @minItems 0
   */
  exclusions: {
    relative_path: string;
    reason: string;
  }[];
  /**
   * @minItems 0
   */
  staged_changes: string[];
  /**
   * @minItems 0
   */
  unstaged_changes: string[];
  completeness: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
  /**
   * @minItems 0
   */
  diagnostics: string[];
  input_hash: string;
};

export interface PlanContext {
  schema_version: "0.1";
  task_file: string;
  base_ref: string;
  profile: string;
  config: ProjectConfig;
  task: TaskPayload;
  input_manifest: InputManifest;
  configuration_hash: string;
  confirmation_digest: string;
  execution_digest: string;
  policy_hash: string;
  toolchain_hash: string;
  tool_versions: {
    [k: string]: string;
  };
  target_contract_hashes: {
    [k: string]: string;
  };
  environment_requirements:
    | {
        required: false;
      }
    | {
        required: true;
        environment_id: string;
        configuration:
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
        minimum_provenance: "DECLARED" | "OBSERVED" | "CONTROLLED";
      };
  /**
   * @minItems 1
   */
  required_check_ids: [string, ...string[]];
  test_assignments: {
    [k: string]: string[];
  };
  selection_sources: {
    /**
     * @minItems 1
     */
    [k: string]: [string, ...string[]];
  };
  analysis_gaps: {
    workspace: string;
    reference: string;
    reason: string;
    origin: string;
  }[];
  workspace_resource_ids: {
    [k: string]: string;
  };
  blockers: {
    code:
      | "CONFIG_INVALID"
      | "TASK_UNCONFIRMED"
      | "EXECUTION_UNTRUSTED"
      | "BASELINE_UNAVAILABLE"
      | "PLAN_STALE"
      | "INPUT_STALE"
      | "UNSUPPORTED_SCHEMA"
      | "CONTRACT_MISMATCH"
      | "UNRESOLVED_IMPACT"
      | "PROTECTED_INPUT_CHANGED"
      | "NO_TESTS"
      | "REQUIRED_TEST_MISSING"
      | "MISSING_REPORT"
      | "REPORT_INVALID"
      | "ENV_PROVENANCE_INSUFFICIENT"
      | "ENV_INSTANCE_MISMATCH"
      | "FLAKY_REQUIRED_TEST"
      | "ARTIFACT_BUDGET_EXCEEDED"
      | "RESOURCE_OWNERSHIP_UNVERIFIED"
      | "POLICY_WEAKEN_ATTEMPT"
      | "UNSUPPORTED_CAPABILITY"
      | "TOOL_FAILURE"
      | "RUN_CANCELED"
      | "DEPENDENCY_BLOCKED";
    message: string;
    check_id: string | null;
  }[];
}
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
      environment: string | null;
      minimum_provenance: "DECLARED" | "OBSERVED" | "CONTROLLED";
      unknown_impact: "workspace-regression" | "incomplete";
      workspace_regression?: {
        /**
         * @minItems 1
         */
        [k: string]: [string, ...string[]];
      };
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
    required_ignored_inputs?: string[];
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
      check_dependencies?: {
        [k: string]: string[];
      };
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
export interface TaskPayload {
  schema_version: "0.1";
  task_id: string;
  revision: number;
  status: "DRAFT" | "CONFIRMED";
  goal: string;
  target_contract: string;
  /**
   * @minItems 1
   */
  required_operations: [string, ...string[]];
  /**
   * @minItems 1
   */
  required_checks: [string, ...string[]];
  /**
   * @minItems 1
   */
  required_test_ids: [string, ...string[]];
  /**
   * @minItems 1
   */
  allowed_change_paths: [string, ...string[]];
  constraints: {
    preserve_target_contract: true;
    allow_test_deletion: false;
    require_backend_observation: boolean;
    allow_production_targets: false;
  };
  /**
   * @minItems 1
   */
  expected_behavior: [string, ...string[]];
  compatibility: {
    mode: "preserve" | "approved-changes";
    /**
     * @minItems 0
     */
    approved_breaking_rules: {
      operation_key: string;
      rule_id: string;
      baseline_hash: string;
      target_hash: string;
      reason: string;
    }[];
  };
  extensions?: {
    [k: string]: unknown;
  };
}
