import fs from 'node:fs/promises';
import type {CheckResult,GateEvaluation,PlanContext,RunCompletion} from '../../../contracts/src/index.js';
import {evaluateGate} from '../domain/evaluate-gate.js';
import {canonicalJson} from '../storage/canonical-json.js';
import {hashBytes} from '../storage/hash.js';
import {inspectPathWithin} from '../storage/safe-path.js';
import {inspectToolProvenance} from '../domain/tool-provenance.js';
export const contextIdentity=(context:PlanContext)=>hashBytes(Buffer.from(canonicalJson({...context,blockers:[]})));
/** A positive byte mismatch proves drift even when changed task inputs prevent full recapture. */
export async function knownInputChanged(root:string,context:PlanContext):Promise<boolean>{
 for(const file of context.input_manifest.files){
  try{
   const inspected=await inspectPathWithin(root,file.relative_path),stat=await fs.lstat(inspected.path);
   if(file.kind==='deleted')return true;
   if(file.kind==='symlink'){if(!stat.isSymbolicLink()||await fs.readlink(inspected.path)!==file.link_target)return true;continue;}
   if(inspected.links.length||!stat.isFile()||stat.isSymbolicLink())return true;
   if(stat.size>100*1024*1024)continue;
   if(hashBytes(await fs.readFile(inspected.path))!==file.digest)return true;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&file.kind!=='deleted')return true;}
 }
 return false;
}
export function evaluateRunFacts(context:PlanContext,checks:CheckResult[],completion:Pick<RunCompletion,'post_task_confirmed'|'post_trust_valid'|'canceled'|'fatal_error'>,integrity:'VALID'|'INVALID'|'UNVERIFIED',freshness:GateEvaluation['freshness'],extra_reasons:string[]=[]):GateEvaluation{
 const denialCodes=new Set(['CONTRACT_MISMATCH','PROTECTED_INPUT_CHANGED','POLICY_WEAKEN_ATTEMPT']);
 const globalGaps=context.blockers.filter(b=>b.check_id===null&&!denialCodes.has(b.code));
 const tools=context.required_check_ids.flatMap(id=>{const check=context.config.checks[id];return check?[check.adapter==='openapi'?check.candidate_command:check.command]:[];});
 const provenance=inspectToolProvenance(context.tool_versions,tools),unknown=Object.keys(provenance.versions).filter(name=>provenance.versions[name]==='UNKNOWN');
 const result=evaluateGate({checks,required_check_ids:context.required_check_ids,configuration_valid:true,report_integrity:integrity,freshness,
  inputs_complete:context.input_manifest.completeness==='COMPLETE'&&!globalGaps.length&&!unknown.length,
  task_confirmed:completion.post_task_confirmed,policy_confirmed:completion.post_trust_valid,
  environment_satisfied:!context.environment_requirements.required&&!context.task.constraints.require_backend_observation,
  acceptance_inputs_approved:!context.blockers.some(b=>b.code==='PROTECTED_INPUT_CHANGED'),canceled:completion.canceled,fatal_error:completion.fatal_error,
  deterministic_denials:context.blockers.filter(b=>denialCodes.has(b.code)).map(b=>b.code),
 });
 return {...result,reasons:[...new Set([...result.reasons,...globalGaps.map(b=>b.code),...unknown.map(name=>'UNKNOWN_REQUIRED_TOOL:'+name),...extra_reasons])]};
}
