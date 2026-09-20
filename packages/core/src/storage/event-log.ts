import {validateSchema,type RunEvent,type Diagnostic,type Phase} from '../../../contracts/src/index.js';
import {reduceEvents} from '../domain/reduce-events.js';
export const evidenceDiagnostic=(message:string):Diagnostic=>({code:'REPORT_INVALID',rule_id:'SG-EVIDENCE-INTEGRITY',message,location:'',observed_facts:{},recommended_action:'Preserve existing evidence; diagnose or create a new run.',source:'evidence-store'});
export function readEventLog(bytes:Uint8Array,run_id:string):{events:RunEvent[];diagnostics:Diagnostic[]}{
 const events:RunEvent[]=[],diagnostics:Diagnostic[]=[];let text:string;
 try{text=new TextDecoder('utf8',{fatal:true}).decode(bytes);}catch{return {events,diagnostics:[evidenceDiagnostic('Event log contains invalid UTF-8')]};}
 const lines=text.split('\n');if(lines.at(-1)!=='')diagnostics.push(evidenceDiagnostic('Event log has an incomplete final line'));lines.pop();
 for(const line of lines){try{const parsed:unknown=JSON.parse(line),valid=validateSchema<RunEvent>('event',parsed);if(!valid.ok||valid.value.run_id!==run_id)throw new Error();events.push(valid.value);}catch{diagnostics.push(evidenceDiagnostic('Event record is malformed or belongs to another run'));break;}}
 const reduced=reduceEvents(events);diagnostics.push(...reduced.diagnostics,...validateLifecycle(reduced.events));return {events:reduced.events,diagnostics};
}
export function validateLifecycle(events:readonly RunEvent[]):Diagnostic[]{
 let started=false,terminal=false,canceled=false,aborted=false;let phase:Phase|null=null;const attempts=new Map<string,string>(),finished=new Set<string>();
 const transitions:Record<Phase,Phase[]>={CREATED:['PLANNED','CANCELED','ABORTED'],PLANNED:['RUNNING','CANCELED','ABORTED'],RUNNING:['FINALIZING','CANCELED','ABORTED'],FINALIZING:['COMPLETED','CANCELED','ABORTED'],COMPLETED:[],CANCELED:[],ABORTED:[]};
 for(const event of events){if(terminal)return [evidenceDiagnostic('Event follows finalization')];
  if(event.type==='run.started'){if(started)return [evidenceDiagnostic('Run started twice')];started=true;continue;}
  if(!started)return [evidenceDiagnostic('Run must start before execution facts')];
  if(event.type==='run.phase_changed'){if(event.payload.from!==phase||(phase===null?event.payload.to!=='CREATED':!transitions[phase].includes(event.payload.to)))return [evidenceDiagnostic('Run phase transition is not continuous or legal')];phase=event.payload.to;}
  if(event.type==='check.started'){const key=event.payload.check_id+'/'+event.payload.attempt_id;if(canceled||attempts.has(key))return [evidenceDiagnostic('Check attempt started twice or after cancellation')];attempts.set(key,event.payload.step_id);}
  if(event.type==='check.finished'){const result=event.payload.check_result,key=result.check_id+'/'+result.attempt_id;if(result.run_id!==event.run_id||attempts.get(key)!==result.step_id||finished.has(key))return [evidenceDiagnostic('Check finish has no matching unique run/check/step/attempt start')];finished.add(key);}
  if(event.type==='artifact.saved'&&event.payload.artifact.run_id!==event.run_id)return [evidenceDiagnostic('Artifact belongs to another run')];
  if(event.type==='run.canceled'||event.type==='run.aborted')canceled=true;
  if(event.type==='run.aborted')aborted=true;
  if(event.type==='run.finalized'){if(phase!==null&&phase!==event.payload.phase)return [evidenceDiagnostic('Finalization contradicts the last phase event')];if(canceled&&(event.payload.phase==='COMPLETED'||event.payload.verdict==='PASS')||aborted&&event.payload.phase!=='ABORTED'||event.payload.phase==='COMPLETED'&&attempts.size!==finished.size)return [evidenceDiagnostic('Finalization contradicts cancellation or unfinished attempts')];terminal=true;}
 }
 return [];
}
