import {expect,it} from 'vitest';
import {SaxesParser} from 'saxes';
import {buildReportView} from '../../../packages/reporters/src/report-view.js';
import {renderJson} from '../../../packages/reporters/src/json.js';
import {renderTerminal} from '../../../packages/reporters/src/terminal.js';
import {renderMarkdown} from '../../../packages/reporters/src/markdown.js';
import {renderJunit} from '../../../packages/reporters/src/junit-output.js';
import {reportFixture} from '../../support/report-view.js';

/** SG-042 and SG-050 require one projected conclusion: no renderer may soften the gate or become a second decision. */
it('projects an identical decision, verdict, freshness, exit code and reasons across all four renderers',()=>{
 const {source,evaluation}=reportFixture(),view=buildReportView(source,evaluation);
 const texts={json:renderJson(view),terminal:renderTerminal(view),markdown:renderMarkdown(view),junit:renderJunit(view)};
 const gate=JSON.parse(texts.json);
 expect(gate).toMatchObject({decision:'DENY',verdict:'FAIL',freshness:'STALE',exit_code:4});
 expect(gate.reasons).toContain('INPUT_STALE');
 expect(texts.terminal).toContain('Decision: DENY');expect(texts.terminal).toContain('Verdict: FAIL');expect(texts.terminal).toContain('Freshness: STALE');
 expect(texts.markdown).toContain('Decision: **DENY** · Verdict: FAIL · Freshness: STALE');expect(texts.markdown).toContain('Exit code: 4');
 let current:string|null=null;const messages:Record<string,string>={};let summary:{failures:number;errors:number;skipped:number}|null=null;
 const parser=new SaxesParser({xmlns:false});
 parser.on('opentag',tag=>{
  if(tag.name==='testsuite')summary={failures:Number(tag.attributes.failures),errors:Number(tag.attributes.errors),skipped:Number(tag.attributes.skipped)};
  if(tag.name==='testcase'){current=String(tag.attributes.name);messages[current]='';}
  else if(current&&['failure','error','skipped'].includes(tag.name))messages[current]=String(tag.attributes.message??'');
 });
 parser.write(texts.junit).close();
 expect(summary).toEqual({failures:2,errors:0,skipped:1});
 expect(messages['check.unit']).toContain('Observed');
 expect(messages['missing.missing']).toContain('Required check was not verified');
 expect(messages['stackgate.gate']).toContain('DENY: FAIL/STALE; exit 4');
 for(const [name,text] of Object.entries(texts))expect(text,name).not.toMatch(/\bALLOW\b/);
});
