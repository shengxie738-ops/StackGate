import type { TaskPayload } from '../../../contracts/src/index.js';
export interface ContractIssue {rule_id:string;operation_key:string}
export interface ContractApprovalContext {service_id:string;baseline_hash:string;target_hash:string;confirmed:boolean;task:TaskPayload|null}
export function bareContractHash(hash:string):string|null {const bare=hash.replace(/^sha256:/,'');return /^[a-f0-9]{64}$/.test(bare)?bare:null;}
export function approveBreakingChanges<T extends ContractIssue>(findings:readonly T[],context:ContractApprovalContext):(T & {approved:boolean})[] {
  const base=bareContractHash(context.baseline_hash),target=bareContractHash(context.target_hash);
  return findings.map(finding=>({...finding,approved:!!(context.confirmed&&base&&target&&finding.rule_id!=='SG-CONTRACT-UNMAPPED'&&context.task?.compatibility.mode==='approved-changes'&&context.task.compatibility.approved_breaking_rules.some(approval=>approval.operation_key===`${context.service_id}:${finding.operation_key}`&&approval.rule_id===finding.rule_id&&approval.baseline_hash===base&&approval.target_hash===target&&approval.reason.trim().length>0))}));
}
