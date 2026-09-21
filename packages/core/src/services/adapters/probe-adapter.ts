import {validateSchema,type Artifact,type CheckStep,type CheckResult,type ProbeReport} from '../../../../contracts/src/index.js';
import {getContractSnapshot,type LoadedContract} from '../../../../adapter-oasdiff/src/load-contract.js';
import {validatePayload} from '../../../../adapter-oasdiff/src/runtime-validator.js';
import type {CollectionContext} from '../../ports/adapter.js';
import {parseStrictDocument} from '../strict-document.js';
import {canonicalJson} from '../../storage/canonical-json.js';
import {hashBytes} from '../../storage/hash.js';
export interface ProbeCollectionRequest {
 step:CheckStep;context:CollectionContext;report:Artifact|null;
 targets:Readonly<Record<string,LoadedContract>>;target_hashes:Readonly<Record<string,string>>;
 started_at:string;finished_at:string|null;raw_exit_code:number|null;
}
/** M2 collector only. It never starts processes, requests a URL, or certifies backend provenance. */
export async function collectProbe(request:ProbeCollectionRequest):Promise<CheckResult>{
 const {step,context}=request,reasons=new Set<string>(),evidence:string[]=[],assertions=new Set<string>();let failed=false,error=false;
 const finish=():CheckResult=>{
  const status:CheckResult['status']=error?'ERROR':failed?'FAIL':'BLOCKED';
  const result:CheckResult={schema_version:'0.1',run_id:context.run_id,check_id:context.check_id,step_id:step.step_id,attempt_id:context.attempt_id,required:step.required,status,result_kind:'probe',exit_code:request.raw_exit_code,expected_test_ids:[...step.expected_test_ids],executed_test_ids:[],discovered_tests:assertions.size,executed_tests:0,skipped_tests:0,flaky_tests:0,reasons:[...reasons].sort(),evidence_refs:evidence,attempts:[{attempt_id:context.attempt_id,started_at:request.started_at,finished_at:request.finished_at,raw_exit_code:request.raw_exit_code,status,evidence_refs:[...evidence]}]};
  if(!validateSchema('check-result',result).ok)throw new Error('Invalid caller-provided probe collection identity or timing');return result;
 };
 try{
  if(!validateSchema('check-step',step).ok||step.adapter_id!=='stackgate-probe'||step.parameters.adapter_id!=='stackgate-probe'||step.check_id!==context.check_id){error=true;reasons.add('REPORT_INVALID');return finish();}
  if(context.signal.aborted){reasons.add('CANCELED');return finish();}
  const report=request.report;
  if(!report){reasons.add('MISSING_REPORT');return finish();}
  if(!validateSchema('artifact',report).ok||report.run_id!==context.run_id||report.check_id!==context.check_id||report.attempt_id!==context.attempt_id||report.artifact_kind!=='report'||report.media_type!=='application/json'||!report.relative_path.endsWith('/probe.json')||!context.expected_artifacts.includes('probe.json')||!step.expected_artifacts.includes('probe.json')){error=true;reasons.add('REPORT_IDENTITY_MISMATCH');return finish();}
  if(report.retention?.truncated){reasons.add('ARTIFACT_BUDGET_EXCEEDED');return finish();}
  const read=await context.evidence.read({run_id:context.run_id,relative_path:report.relative_path,expected_digest:report.digest,max_bytes:1024*1024});
  if(read.status!=='FOUND'){if(read.status==='INVALID')error=true;reasons.add(read.status==='MISSING'?'MISSING_REPORT':'REPORT_INVALID');return finish();}
  if(canonicalJson(read.artifact)!==canonicalJson(report)||read.bytes.length!==report.size||hashBytes(read.bytes)!==report.digest){error=true;reasons.add('REPORT_INVALID');return finish();}
  evidence.push(report.artifact_id);
  // JSON-only envelope with strict duplicate-key/depth/size checks, without loading user code.
  JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(read.bytes));const parsed=parseStrictDocument(read.bytes,'probe.json',{maxBytes:1024*1024,maxDepth:64});
  const checked=validateSchema<ProbeReport>('probe',parsed);if(!checked.ok){error=true;reasons.add('REPORT_INVALID');return finish();}
  const document=checked.value;
  if(document.run_id!==context.run_id||document.check_id!==context.check_id||document.attempt_id!==context.attempt_id){error=true;reasons.add('REPORT_IDENTITY_MISMATCH');return finish();}
  if(!document.completed)reasons.add('REPORT_INCOMPLETE');
  if(request.finished_at===null||request.raw_exit_code===null)reasons.add('PROCESS_NOT_COMPLETED');
  const operations=new Set<string>(),requests=new Set<string>();
  for(const operation of document.operations){
   if(requests.has(operation.request_id)){error=true;reasons.add('REQUEST_IDENTITY_CONFLICT');}requests.add(operation.request_id);operations.add(operation.operation_key);
   for(const assertion of operation.assertions){if(assertions.has(assertion.assertion_id)){error=true;reasons.add('ASSERTION_IDENTITY_CONFLICT');}assertions.add(assertion.assertion_id);if(!assertion.passed){failed=true;reasons.add('ASSERTION_FAILED:'+assertion.assertion_id);}}
   if(operation.assertions.length===0)reasons.add('ASSERTIONS_MISSING:'+operation.operation_key);
   const separator=operation.operation_key.indexOf(':'),service=operation.operation_key.slice(0,separator),key=operation.operation_key.slice(separator+1),target=request.targets[service];
   if(!target){reasons.add('TARGET_CONTRACT_MISSING:'+service);continue;}
   const expected=request.target_hashes[service];if(!expected||!/^[a-f0-9]{64}$/.test(expected)||target.raw_hash!=='sha256:'+expected||!getContractSnapshot(target)){error=true;reasons.add('TARGET_IDENTITY_MISMATCH');continue;}
   if(!Object.hasOwn(operation,'response_body')){reasons.add('RESPONSE_BODY_MISSING:'+operation.operation_key);continue;}
   const validation=validatePayload({contract:target,operation_key:key,direction:'response',status_code:operation.status_code,media_type:operation.media_type,payload:operation.response_body});
   if(validation.status==='FAIL'){failed=true;reasons.add('CONTRACT_MISMATCH');}else if(validation.status==='INCOMPLETE')reasons.add('UNSUPPORTED_SCHEMA');
   // The self-reported schema_valid flag neither grants a pass nor substitutes for the check above.
  }
  for(const operation of step.parameters.required_operations)if(!operations.has(operation))reasons.add('REQUIRED_OPERATION_MISSING:'+operation);
  for(const id of step.expected_test_ids)if(!assertions.has(id))reasons.add('REQUIRED_TEST_MISSING:'+id);
  if(assertions.size<(step.min_tests??1))reasons.add('NO_TESTS');
  if(request.raw_exit_code!==null&&request.raw_exit_code!==0&&!failed){error=true;reasons.add('TOOL_FAILURE');}
  if(context.signal.aborted)reasons.add('CANCELED');
  // Backend pointers remain in the retained report. M3 must authenticate their independent source;
  // a local self-reported request_id/instance_id/reference cannot establish observed execution.
  reasons.add('ENV_PROVENANCE_INSUFFICIENT');reasons.add('DECLARED_ASSERTIONS_NOT_AUTHENTICATED');
  return finish();
 }catch{error=true;reasons.add('REPORT_INVALID');return finish();}
}
