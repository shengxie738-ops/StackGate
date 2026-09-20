import type {Diagnostic} from '../../../contracts/src/index.js';
import type {RunnerResult} from '../ports/runner.js';
export interface ExpectedCommandProvenance {command_id:string;authorization_hash:string;platform_id:string;executable_digest?:string}
/** Failed startup has no completion identity; EXITED facts must carry the owned runner's observations. */
export function validateCommandProvenance(result:Pick<RunnerResult,'status'|'execution'|'provenance'|'process'>,expected:ExpectedCommandProvenance):Diagnostic[]{
 const failures:string[]=[],execution=result.execution,provenance=result.provenance;
 if(execution&&(execution.command_id!==expected.command_id||execution.authorization_hash!==expected.authorization_hash))failures.push('Observed command authorization differs from the reviewed plan');
 if(execution&&(!/^[a-f0-9]{64}$/.test(execution.command_hash)||!/^[a-f0-9]{64}$/.test(execution.executable_digest)))failures.push('Observed command digest is invalid');
 if(execution&&expected.executable_digest&&execution.executable_digest!==expected.executable_digest)failures.push('Observed executable differs from the unchanged reviewed tool');
 if(result.status==='EXITED'){
  if(!execution)failures.push('Completed command has no reviewed execution binding');
  if(!result.process||!Number.isSafeInteger(result.process.pid)||result.process.pid<1||!result.process.creation_identity.trim()||!result.process.owner_token.trim())failures.push('Completed command has no observed process ownership identity');
  if(!expected.platform_id.startsWith('win32-')||provenance?.mechanism!=='WINDOWS_JOB_OBJECT'||provenance.cleanup!=='VERIFIED'||!provenance.broker_version?.trim())failures.push('Completed command has no verified supported process cleanup provenance');
 }
 return failures.map(message=>({code:'REPORT_INVALID',message,location:'',source:'gate-service',observed_facts:{},recommended_action:'Preserve the evidence and execute a new verified run.'}));
}

