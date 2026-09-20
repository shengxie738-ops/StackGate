import {safeText,type ReportView} from './report-view.js';
export const markdownText=(text:string)=>safeText(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/[\\`*_{}[\]()#+!|]/g,'\\$&');
export function renderMarkdown(view:ReportView):string{
 const section=(title:string,lines:string[])=>`## ${title}\n\n${lines.length?lines.join('\n\n'):'None recorded.'}\n`;
 return '# StackGate report\n\n'+[
 section('Summary',[`Decision: **${view.decision}** · Verdict: ${view.verdict} · Freshness: ${view.freshness}`]),
 section('Scope',[`Run: ${markdownText(view.run)}; historical verdict: ${view.historical_verdict}`,`Required: ${view.required_checks.map(markdownText).join(', ')}`]),
 section('Code identity',Object.entries(view.code_identity).map(([key,value])=>`${key}: ${markdownText(value)}`)),
 section('Task identity',[`${markdownText(view.task.id)} revision ${view.task.revision}`]),
 section('Gate decision',[`Exit code: ${view.exit_code}`,...view.reasons.map(markdownText)]),
 section('Required checks',view.checks.map(check=>`${markdownText(check.check_id)}: **${check.status}**, executed ${check.executed_tests}, skipped ${check.skipped_tests}, missing IDs: ${check.missing_test_ids.map(markdownText).join(', ')||'none'}`)),
 section('Failures',view.failures.map(check=>`${markdownText(check.check_id)}: ${check.reasons.map(markdownText).join('; ')}. Evidence: ${check.evidence_refs.map(markdownText).join(', ')}`)),
 section('Incomplete coverage',[...view.not_verified.map(markdownText)]),
 section('Artifacts',view.artifacts.map(artifact=>`[${markdownText(artifact.artifact_id)}](${artifact.relative_path.split('/').map(encodeURIComponent).join('/')}) — SHA-256 ${artifact.digest}`)),
 section('Reproduction',[markdownText(view.reproduction),markdownText(view.next_action)]),
 section('Not verified',[view.interpretation,markdownText(view.environment.provenance)]),
 ].join('\n');
}
