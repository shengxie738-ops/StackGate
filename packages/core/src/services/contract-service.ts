import type { ConfirmationRecord, Diagnostic, TaskPayload } from '../../../contracts/src/index.js';
import type { LoadedContract } from '../../../adapter-oasdiff/src/load-contract.js';
import type { CompatibilityFinding, ContractToolResult, ToolEvidence } from '../../../adapter-oasdiff/src/tool.js';
import { getContractSnapshot,loadContract } from '../../../adapter-oasdiff/src/load-contract.js';
import { inspectSupportedSchema } from '../../../adapter-oasdiff/src/supported-schema.js';
import { validateSchema,isSafeId } from '../../../contracts/src/index.js';
import { hashBytes } from '../storage/hash.js';
import { canonicalJson } from '../storage/canonical-json.js';
import { approveBreakingChanges,bareContractHash } from '../domain/contract-policy.js';
import { compareContractBehavior } from '../domain/contract-projection.js';
export interface ContractComparisonRequest {
  baseline:LoadedContract;target:LoadedContract;candidate:LoadedContract|null;
  task:{payload:TaskPayload;confirmation:ConfirmationRecord|null}|null;
  policy:{service_id:string;require_confirmation?:boolean;expected_target_hash?:string};candidate_error?:string;
}
export interface ContractAssessment {
  compatibility:{status:'PASS'|'FAIL'|'BLOCKED'|'ERROR';findings:(CompatibilityFinding & {approved:boolean})[];diagnostics:Diagnostic[];evidence:ToolEvidence[]};
  implementation_alignment:{status:'PASS'|'FAIL'|'NOT_EXECUTED'|'ERROR'|'BLOCKED';changed_operations:string[];diagnostics:Diagnostic[]};
  runtime_validation:{status:'NOT_EXECUTED'};
  target_authorization:'CONFIRMED'|'UNCONFIRMED'|'CHANGED'|'NOT_REQUIRED';
  source_hashes:{baseline:string;target:string;candidate:string|null};
}
export interface ContractCompatibilityTool {breaking(base:LoadedContract,target:LoadedContract,operation_scope?:readonly string[]):Promise<ContractToolResult<CompatibilityFinding[]>>}
export class ContractService {
  constructor(readonly tool:ContractCompatibilityTool) {}
  async compareThreeWay(request:ContractComparisonRequest):Promise<ContractAssessment>{
    const diagnostic=(code:Diagnostic['code'],message:string):Diagnostic=>({code,rule_id:'SG-CONTRACT-THREE_WAY',message,location:'',source:'contract-service',observed_facts:{},recommended_action:'Review retained contract bytes, confirmation identity and supported schema capabilities.'});
    const report:ContractAssessment={compatibility:{status:'BLOCKED',findings:[],diagnostics:[],evidence:[]},implementation_alignment:{status:request.candidate_error?'ERROR':'NOT_EXECUTED',changed_operations:[],diagnostics:[]},runtime_validation:{status:'NOT_EXECUTED'},target_authorization:request.policy.require_confirmation?'UNCONFIRMED':'NOT_REQUIRED',source_hashes:{baseline:request.baseline.raw_hash,target:request.target.raw_hash,candidate:request.candidate?.raw_hash??null}};
    if(request.candidate_error)report.implementation_alignment.diagnostics.push(diagnostic('REPORT_INVALID','Candidate contract export failed'));
    const rejected=[request.baseline,request.target].filter(input=>!input.supported||!input.document);
    if(rejected.length){
      report.compatibility.diagnostics=rejected.flatMap(input=>input.diagnostics);
      if(!report.compatibility.diagnostics.length)report.compatibility.diagnostics.push(diagnostic('UNSUPPORTED_SCHEMA','Contract loader rejected an input'));
      if(request.candidate&&!request.candidate_error)report.implementation_alignment={status:'BLOCKED',changed_operations:[],diagnostics:[...report.compatibility.diagnostics]};
      return report;
    }
    try {
      if(!isSafeId(request.policy.service_id))throw new Error('Invalid service identity');
      // Pin both raw source identity and owned document projections before the first await.
      const owned=(input:LoadedContract)=>{const snapshot=getContractSnapshot(input);if(!snapshot)throw new Error('Contract source snapshot changed or is unverified');return loadContract(Buffer.from(snapshot.canonical_json),input.source);};
      const baseline=owned(request.baseline),target=owned(request.target),candidate=request.candidate?owned(request.candidate):null;
      const policy=JSON.parse(canonicalJson(request.policy)) as ContractComparisonRequest['policy'];
      const taskContext=request.task?JSON.parse(canonicalJson(request.task)) as NonNullable<ContractComparisonRequest['task']>:null;
      let confirmed=false;
      if(policy.expected_target_hash&&bareContractHash(policy.expected_target_hash)!==bareContractHash(report.source_hashes.target))report.target_authorization='CHANGED';
      if(taskContext?.confirmation) {
        const task=validateSchema<TaskPayload>('task',taskContext.payload),confirmation=validateSchema<ConfirmationRecord>('confirmation',taskContext.confirmation);
        if(task.ok&&confirmation.ok&&confirmation.value.task_id===task.value.task_id&&confirmation.value.revision===task.value.revision&&confirmation.value.payload_hash===hashBytes(Buffer.from(canonicalJson(task.value)))) {
          if(confirmation.value.target_hashes[policy.service_id]!==bareContractHash(report.source_hashes.target))report.target_authorization='CHANGED';
          else if(report.target_authorization!=='CHANGED'){confirmed=true;report.target_authorization='CONFIRMED';}
        } else if(report.target_authorization!=='CHANGED')report.target_authorization='UNCONFIRMED';
      }
      const capabilities=[inspectSupportedSchema(baseline),inspectSupportedSchema(target)];
      if(capabilities.some(result=>!result.supported)) {
        report.compatibility.diagnostics=capabilities.flatMap(result=>result.diagnostics);
        if(candidate) {report.implementation_alignment.status='BLOCKED';report.implementation_alignment.diagnostics=[...report.compatibility.diagnostics];}
        return report;
      }
      const result=await this.tool.breaking(request.baseline,request.target);
      const findings=approveBreakingChanges(result.value??[],{service_id:policy.service_id,baseline_hash:report.source_hashes.baseline,target_hash:report.source_hashes.target,confirmed,task:taskContext?.payload??null});
      report.compatibility={status:result.status==='FAIL'&&findings.length>0&&findings.every(finding=>finding.approved)?'PASS':result.status,findings,diagnostics:result.diagnostics,evidence:result.evidence};
      if(!candidate||request.candidate_error)return report;
      if(report.target_authorization==='CHANGED'||policy.require_confirmation&&report.target_authorization!=='CONFIRMED') {
        report.implementation_alignment={status:'BLOCKED',changed_operations:[],diagnostics:[diagnostic(report.target_authorization==='CHANGED'?'INPUT_STALE':'TASK_UNCONFIRMED','Target has no matching current confirmation')]};return report;
      }
      const candidateCapabilities=inspectSupportedSchema(candidate);
      if(!candidateCapabilities.supported){report.implementation_alignment={status:'BLOCKED',changed_operations:[],diagnostics:candidateCapabilities.diagnostics};return report;}
      const alignment=compareContractBehavior(target.document!,candidate.document!);
      report.implementation_alignment={status:alignment.aligned?'PASS':'FAIL',changed_operations:alignment.changed_operations,diagnostics:alignment.aligned?[]:[diagnostic('CONTRACT_MISMATCH','Candidate behavior does not exactly match the supported target projection')]};
      return report;
    }catch{
      report.compatibility.status='BLOCKED';report.compatibility.diagnostics.push(diagnostic('INPUT_STALE','Contract inputs or source identities could not be safely verified'));
      if(request.candidate&&!request.candidate_error)report.implementation_alignment={status:'BLOCKED',changed_operations:[],diagnostics:[diagnostic('INPUT_STALE','Candidate or target identity could not be safely verified')]};
      return report;
    }
  }
}
