export interface ProtectedAcceptanceInput { relative_path:string; digest:string|null; content?:string }
export interface AcceptanceCheck { adapter:string; result_kind?:string; min_tests?:number }
export interface ApprovedAcceptanceChange { task_id:string;revision:number;relative_path:string;before_digest:string|null;after_digest:string|null }
export interface AcceptanceSnapshot {
  task_id:string;revision:number;protected_inputs:readonly ProtectedAcceptanceInput[];
  required_checks:readonly string[];required_test_ids:readonly string[];checks:Readonly<Record<string,AcceptanceCheck>>;
  target_configuration_hash:string;approved_changes?:readonly ApprovedAcceptanceChange[];
  runtime_inventory?:{executed_test_ids:readonly string[];complete:boolean};
}
export interface DriftFinding {code:string;reference:string;category:'KNOWN'|'REVIEW_REQUIRED'|'RUNTIME';decision:'DENY'|'NOT_EXECUTED';message:string}
export function detectAcceptanceDrift(confirmed:AcceptanceSnapshot,current:AcceptanceSnapshot):DriftFinding[]{
  const findings:DriftFinding[]=detectTestInventoryDrift(confirmed,current);
  const deny=(code:string,reference:string,message:string,category:DriftFinding['category']='KNOWN')=>findings.push({code,reference,category,decision:'DENY',message});
  const sameIdentity=confirmed.task_id===current.task_id&&confirmed.revision===current.revision;
  if(!sameIdentity)deny('TASK_IDENTITY_CHANGED','task','Task ID or confirmed revision changed');
  if(confirmed.target_configuration_hash!==current.target_configuration_hash)deny('TARGET_CONFIGURATION_CHANGED','target_configuration','Target configuration digest changed');
  const index=(inputs:readonly ProtectedAcceptanceInput[],source:string)=>{
    const map=new Map<string,ProtectedAcceptanceInput>();
    for(const input of inputs){if(map.has(input.relative_path))deny('INPUT_INVENTORY_INVALID',input.relative_path,source+' has duplicate protected paths');map.set(input.relative_path,input);}
    return map;
  };
  const before=index(confirmed.protected_inputs,'Confirmed inventory'),after=index(current.protected_inputs,'Current inventory');
  const approved=(relative_path:string,before_digest:string|null,after_digest:string|null)=>sameIdentity&&(confirmed.approved_changes??[]).some(change=>change.task_id===confirmed.task_id&&change.revision===confirmed.revision&&change.relative_path===relative_path&&change.before_digest===before_digest&&change.after_digest===after_digest);
  const patterns:[string,RegExp][]=[['TEST_SKIP_INTRODUCED',/\b(?:test|it|describe)\s*\.\s*(?:skip|skipIf|todo)\s*\(|\b(?:pytest\s*\.\s*mark|unittest)\s*\.\s*(?:skip|skipif)\b/g],['TEST_ONLY_INTRODUCED',/\b(?:test|it|describe)\s*\.\s*only\s*\(/g],['MOCK_INTRODUCED',/\b(?:vi|jest)\s*\.\s*(?:mock|spyOn)\s*\(|\b(?:page|context)\s*\.\s*route\s*\(|\broute\s*\.\s*fulfill\s*\(/g]];
  for(const relative_path of new Set([...before.keys(),...after.keys()])){
    const old=before.get(relative_path),now=after.get(relative_path);
    if(old&&now&&old.digest===now.digest){
      if(old.content!==undefined&&now.content!==undefined&&old.content!==now.content)deny('INPUT_INVENTORY_INVALID',relative_path,'Equal supplied digests have inconsistent supplied contents');
      continue;
    }
    if(approved(relative_path,old?.digest??null,now?.digest??null))continue;
    if(old&&(!now||now.digest===null)){deny('PROTECTED_INPUT_DELETED',relative_path,'Confirmed protected input is missing');continue;}
    let known=false;
    if(old?.content!==undefined&&now?.content!==undefined)for(const [code,pattern] of patterns){
      if([...now.content.matchAll(pattern)].length>[...old.content.matchAll(pattern)].length){deny(code,relative_path,'Source contains an additional skip/only/mock pattern; actual execution is not inferred');known=true;}
    }
    if(!known)deny('REVIEW_REQUIRED',relative_path,'Protected input changed; semantic preservation cannot be established automatically','REVIEW_REQUIRED');
  }
  return findings;
}
import { detectTestInventoryDrift } from './test-inventory-drift.js';
