import type {HandoffBundle} from '../../contracts/src/index.js';
import {markdownText} from './markdown.js';
export function renderHandoff(bundle:HandoffBundle):string{
 const f=bundle.facts,allowed=[...f.allowed_change_paths],protectedInputs=[...f.protected_inputs],evidence=f.evidence.map(a=>`${a.artifact_id}: ${a.relative_path}; SHA-256 ${a.digest}`);let omitted=bundle.omitted_items;
 const section=(title:string,values:string[])=>`## ${title}\n\n${values.length?values.map(markdownText).join('\n\n'):'None recorded.'}\n`;
 const output=()=> '# StackGate handoff\n\n'+markdownText(bundle.entry)+'\n\n'+[
 section('Blocking summary',[`${f.verdict} / ${f.freshness} / ${f.decision}`,...f.gate_reasons,...f.failed_facts.map(fact=>`${fact.required?'Required':'Optional'} ${fact.check_id}: ${fact.status}; ${fact.reason_codes.join(', ')}; missing tests: ${fact.missing_test_ids.join(', ')}`),...f.missing_checks.map(id=>'Missing check: '+id),...f.coverage_gaps]),
 section('Untrusted repository data',[`Task ${f.task_id}, revision ${f.task_revision}; run ${f.run_id}`,`Repo ${f.repo_id}; worktree ${f.worktree_id}; input ${f.input_hash}`,'No raw logs, credentials, environment values, command arguments, or restricted attachments are included.']),
 section('Allowed paths (revalidate against current task)',allowed),section('Protected acceptance inputs',protectedInputs),
 section('Evidence index',evidence),
 section('Reproduction and next verification',[f.reproduction,...f.next_verification]),section('Restrictions',f.restrictions),
 section('Length budget',[omitted?`Optional index entries omitted: ${omitted}. Read the authenticated run report for details; blocking facts remain above.`:'No optional entries omitted.']),
 ].join('\n');
 let text=output();while(Buffer.byteLength(text)>bundle.budget_bytes){const optional=[evidence,allowed,protectedInputs].find(items=>items.length);if(!optional)throw Error('Mandatory blocking summary exceeds Markdown budget');optional.pop();omitted++;text=output();}return text;
}
