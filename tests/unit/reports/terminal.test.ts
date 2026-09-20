import {expect,it} from 'vitest';
import {buildReportView} from '../../../packages/reporters/src/report-view.js';
import {renderTerminal} from '../../../packages/reporters/src/terminal.js';
import {reportFixture} from '../../support/report-view.js';
it('shows denial before checks and strips terminal control sequences',()=>{
 const {source,evaluation}=reportFixture(),text=renderTerminal(buildReportView(source,evaluation));expect(text.indexOf('Decision: DENY')).toBeLessThan(text.indexOf('Required checks:'));for(const title of ['Verdict:','Freshness: STALE','Task:','Run:','Failures:','Incomplete items:','Next reproducible action:'])expect(text).toContain(title);expect(text).not.toContain('\u001b');expect(text).toContain('Not verified');
});
