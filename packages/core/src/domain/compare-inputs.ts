export const identityFields = ['repo_id','worktree_id','platform_id','git_object_format','base_oid','head_oid','input_hash','task_id','task_revision','configuration_hash','target_contract_hash','policy_hash','plan_hash','toolchain_hash','environment_requirements_hash','environment_provenance_hash','test_data_revision'] as const;
export type IdentityField = typeof identityFields[number];
export type EvidenceIdentity = Partial<Record<IdentityField,string>> & {target_tip_oid?:string; captured_at?:string; completeness?:'COMPLETE'|'INCOMPLETE'|'UNKNOWN'; environment_live?:boolean};
export interface FreshnessReason {field:string;code:'CHANGED'|'MISSING'|'UNVERIFIED'|'EXPIRED'|'INVALID_TIME'|'INPUT_CHANGED_DURING_RUN'}
export function compareInputs(recorded: EvidenceIdentity,current:EvidenceIdentity): FreshnessReason[] {
  const reasons: FreshnessReason[] = [];
  for (const field of identityFields) {
    const before = recorded[field], after = current[field];
    if (typeof before !== 'string' || !before.trim() || typeof after !== 'string' || !after.trim()) reasons.push({field,code:'MISSING'});
    else if (before !== after) reasons.push({field,code:'CHANGED'});
  }
  return reasons;
}
