import {expect,it} from 'vitest';
import type {PlanContext} from '../../packages/contracts/src/index.js';
import {evaluateRunFacts} from '../../packages/core/src/services/run-evaluation.js';
import {reportFixture} from '../support/report-view.js';
it('does not allow UNKNOWN recorded tool identities to differ from GateService policy',()=>{
 const {source}=reportFixture(),check={...source.manifest.checks[0]!,status:'PASS' as const,reasons:[]};
 const context={blockers:[],required_check_ids:['unit'],config:{checks:{unit:{adapter:'junit',command:'unit'}}},tool_versions:{node:'24.11.1',stackgate:'0.1.0',typescript:'5.9.3',oasdiff:'1.11.7',command_unit:'24.11.1',command_unused:'UNKNOWN'},input_manifest:{completeness:'COMPLETE'},environment_requirements:{required:false},task:{constraints:{require_backend_observation:false}}} as unknown as PlanContext;
 const result=evaluateRunFacts(context,[check],{post_task_confirmed:true,post_trust_valid:true,canceled:false,fatal_error:false},'VALID','FRESH');expect(result).toMatchObject({verdict:'INCOMPLETE',decision:'DENY',exit_code:2});expect(result.reasons.join(' ')).toContain('UNKNOWN');
});
