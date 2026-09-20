import {safeText,type ReportView} from './report-view.js';
export function renderTerminal(view:ReportView):string{return safeText([
 `Decision: ${view.decision}`,`Verdict: ${view.verdict} (historical: ${view.historical_verdict})`,`Freshness: ${view.freshness}`,`Task: ${view.task.id} revision ${view.task.revision}`,`Run: ${view.run}`,`Required checks: ${view.required_checks.join(', ')}`,
 'Failures:',...view.failures.map(check=>`  ${check.check_id}: ${check.status} ${check.reasons.join('; ')} [${check.evidence_refs.join(', ')}]`),
 'Incomplete items:',...view.not_verified.map(item=>'  '+item),...view.reasons.map(reason=>'  '+reason),
 `Next reproducible action: ${view.next_action}`,view.interpretation,
 ].join('\n'))+'\n';}
