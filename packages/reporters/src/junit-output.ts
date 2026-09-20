import type {ReportView} from './report-view.js';
const xml=(text:string)=>text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
/** Presentation only. CI must preserve the original run/gate exit code. */
export function renderJunit(view:ReportView):string{
 const cases=view.checks.map(check=>({name:'check.'+check.check_id,status:check.status,message:check.reasons.join('; ')}));
 for(const id of view.missing_checks)cases.push({name:'missing.'+id,status:'BLOCKED',message:'Required check was not verified'});
 cases.push({name:'stackgate.gate',status:view.decision==='ALLOW'?'PASS':view.verdict==='ERROR'?'ERROR':'FAIL',message:`${view.decision}: ${view.verdict}/${view.freshness}; exit ${view.exit_code}. ${view.reasons.join('; ')}`});
 const count=(statuses:string[])=>cases.filter(item=>statuses.includes(item.status)).length;
 return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="StackGate" tests="${cases.length}" failures="${count(['FAIL'])}" errors="${count(['ERROR'])}" skipped="${count(['BLOCKED','SKIPPED'])}">\n`+cases.map(item=>{
  const tag=item.status==='FAIL'?'failure':item.status==='ERROR'?'error':['BLOCKED','SKIPPED'].includes(item.status)?'skipped':null;
  return `<testcase classname="StackGate" name="${xml(item.name)}">${tag?`<${tag} message="${xml(item.message)}"/>`:''}</testcase>`;
 }).join('\n')+'\n</testsuite>\n';
}
