/* Generated from JSON Schema; do not edit. */

export interface HandoffBundle {
  schema_version: "0.1";
  handoff_id: string;
  facts_digest: string;
  target: "codex" | "claude" | "manual";
  entry: string;
  facts: {
    run_id: string;
    plan_id: string;
    task_id: string;
    task_revision: number;
    repo_id: string;
    worktree_id: string;
    base_oid: string;
    input_hash: string;
    plan_hash: string;
    target_contract_hashes: {
      [k: string]: string;
    };
    decision: "ALLOW" | "DENY";
    verdict: "PASS" | "FAIL" | "INCOMPLETE" | "ERROR";
    freshness: "FRESH" | "STALE" | "UNVERIFIED";
    gate_reasons: string[];
    constraints: Constraints;
    allowed_change_paths: string[];
    protected_inputs: string[];
    failed_facts: {
      check_id: string;
      required: boolean;
      status: "PASS" | "FAIL" | "BLOCKED" | "SKIPPED" | "ERROR";
      reason_codes: string[];
      missing_test_ids: string[];
    }[];
    missing_checks: string[];
    coverage_gaps: string[];
    minimal_related_paths: string[];
    evidence: {
      artifact_id: string;
      relative_path: string;
      digest: string;
      size: number;
    }[];
    reproduction: string;
    next_verification: string[];
    restrictions: string[];
  };
  truncated: boolean;
  omitted_items: number;
  budget_bytes: 32768;
}
export interface Constraints {
  preserve_target_contract: true;
  allow_test_deletion: false;
  require_backend_observation: boolean;
  allow_production_targets: false;
}
