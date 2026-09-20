import type {Artifact,RunManifest,RunEvent,Diagnostic} from '../../../contracts/src/index.js';
import {canonicalJson} from './canonical-json.js';
import {evidenceDiagnostic} from './event-log.js';
/** Consistency is independent of business success: a failed run can have valid evidence. */
export function validateRunConsistency(manifest:RunManifest,events:readonly RunEvent[],artifacts:readonly Artifact[]):Diagnostic[]{
 const errors:Diagnostic[]=[],fail=(text:string)=>errors.push(evidenceDiagnostic(text));
 if(!['COMPLETED','CANCELED','ABORTED'].includes(manifest.phase)||!manifest.finished_at)fail('Run does not have final manifest facts');
 const last=events.at(-1);if(last?.type!=='run.finalized'||last.payload.phase!==manifest.phase||last.payload.verdict!==manifest.verdict)fail('Final event does not match final manifest');
 const phase=events.filter(event=>event.type==='run.phase_changed').at(-1);if(phase&&phase.payload.to!==manifest.phase)fail('Last phase event does not match final manifest');
 const first=events[0];if(first?.type!=='run.started'||first.payload.plan_id!==manifest.plan_id||first.payload.input_hash!==manifest.input_hash)fail('Run start identity does not match manifest');
 if(manifest.canceled!==(manifest.phase==='CANCELED'||events.some(e=>e.type==='run.canceled')))fail('Cancellation facts conflict with manifest');
 const byId=new Map(artifacts.map(a=>[a.artifact_id,a]));if(byId.size!==artifacts.length||new Set(artifacts.map(a=>a.relative_path)).size!==artifacts.length)fail('Artifact index contains duplicate identities or paths');
 for(const id of manifest.artifact_refs)if(!byId.has(id))fail('Manifest references a missing artifact');
 const saved=new Map<string,Artifact>(),finished=new Map<string,Extract<RunEvent,{type:'check.finished'}>['payload']['check_result']>();
 for(const event of events){if(event.type==='artifact.saved'){const artifact=byId.get(event.payload.artifact.artifact_id);if(!artifact||canonicalJson(artifact)!==canonicalJson(event.payload.artifact))fail('Artifact event differs from index');saved.set(event.payload.artifact.artifact_id,event.payload.artifact);}if(event.type==='check.finished')finished.set(event.payload.check_result.check_id,event.payload.check_result);}
 if(saved.size!==artifacts.length)fail('Artifact index has no corresponding saved event');
 if(new Set(manifest.checks.map(c=>c.check_id)).size!==manifest.checks.length||finished.size!==manifest.checks.length)fail('Manifest check identities differ from final check events');
 for(const check of manifest.checks){
  const recorded=finished.get(check.check_id);if(!recorded||canonicalJson(recorded)!==canonicalJson(check))fail('Manifest check facts differ from execution events');
  if(check.run_id!==manifest.run_id||check.status==='PASS'&&check.evidence_refs.length===0)fail('Check has wrong run identity or PASS without evidence');
  for(const [attempt,refs] of [[check.attempt_id,check.evidence_refs],...check.attempts.map(a=>[a.attempt_id,a.evidence_refs])] as [string,string[]][]){for(const id of refs){const artifact=byId.get(id);if(!artifact||artifact.run_id!==manifest.run_id||artifact.check_id!==null&&artifact.check_id!==check.check_id||artifact.attempt_id!==null&&artifact.attempt_id!==attempt)fail('Check evidence reference does not resolve to its run/check/attempt');}}
 }
 return errors;
}
