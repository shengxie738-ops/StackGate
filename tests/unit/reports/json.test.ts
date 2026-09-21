import {expect,it} from 'vitest';
import {buildReportView} from '../../../packages/reporters/src/report-view.js';
import {renderJson} from '../../../packages/reporters/src/json.js';
import {reportFixture} from '../../support/report-view.js';
it('keeps current denial, historical result and complete required/missing facts separately',()=>{
 const {source,evaluation}=reportFixture(),before=JSON.stringify(source),view=JSON.parse(renderJson(buildReportView(source,evaluation)));
 expect(view).toMatchObject({decision:'DENY',verdict:'FAIL',freshness:'STALE',exit_code:4,required_checks:['unit','missing'],missing_checks:['missing']});expect(view.historical_verdict).toBe(source.manifest.verdict);expect(view.failures[0].check_id).toBe('unit');expect(JSON.stringify(source)).toBe(before);expect(view.next_action).toContain('stackgate');
});
it('retains both business failures and tool errors without reporting missing checks as passed',()=>{
 const {source,evaluation}=reportFixture();source.manifest.checks.push({...source.manifest.checks[0]!,check_id:'tool',status:'ERROR',reasons:['TOOL_FAILURE']});const view=JSON.parse(renderJson(buildReportView(source,evaluation)));expect(view.failures.map((c:{status:string})=>c.status)).toEqual(['FAIL','ERROR']);expect(view.not_verified).toContain('missing');
});
it('reports an interrupted prefix without inventing a known required set',()=>{
 const {source,evaluation}=reportFixture();const view=JSON.parse(renderJson(buildReportView({...source,plan:null},evaluation)));expect(view.required_checks_known).toBe(false);expect(view.not_verified).toContain('PLAN_UNVERIFIED');expect(view.decision).toBe('DENY');
});
