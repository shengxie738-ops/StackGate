import {expect,it} from 'vitest';
import {buildReportView} from '../../../packages/reporters/src/report-view.js';
import {renderMarkdown} from '../../../packages/reporters/src/markdown.js';
import {reportFixture} from '../../support/report-view.js';
it('keeps incomplete and stale decisions visible and escapes untrusted content',()=>{
 const {source,evaluation}=reportFixture(),text=renderMarkdown(buildReportView(source,evaluation));expect(text).toContain('DENY');expect(text).toContain('STALE');expect(text).toContain('Not verified != Passed');expect(text).not.toContain('<failure>');for(const title of ['Summary','Scope','Code identity','Task identity','Gate decision','Required checks','Failures','Incomplete coverage','Artifacts','Reproduction','Not verified'])expect(text).toContain('## '+title);expect(text).toContain('gate exit code');
});
