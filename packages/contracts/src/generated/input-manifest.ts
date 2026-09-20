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
