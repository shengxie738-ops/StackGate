import {expect,it} from 'vitest';
import {SaxesParser} from 'saxes';
import {buildReportView} from '../../../packages/reporters/src/report-view.js';
import {renderJunit} from '../../../packages/reporters/src/junit-output.js';
import {reportFixture} from '../../support/report-view.js';
it('emits XML-safe unique checks and a denying gate testcase without equating blocked with passed',()=>{
 const {source,evaluation}=reportFixture();source.manifest.checks.push({...source.manifest.checks[0]!,check_id:'second',status:'ERROR'});const xml=renderJunit(buildReportView(source,evaluation)),names:string[]=[],tags:string[]=[];const parser=new SaxesParser({xmlns:false});parser.on('opentag',tag=>{tags.push(tag.name);if(tag.name==='testcase')names.push(String(tag.attributes.name));});expect(()=>parser.write(xml).close()).not.toThrow();expect(new Set(names).size).toBe(names.length);expect(names).toContain('stackgate.gate');expect(tags).toContain('failure');expect(tags).toContain('error');expect(tags).toContain('skipped');expect(xml).not.toContain('<failure> &');expect(xml).not.toContain('<!DOCTYPE');
});
