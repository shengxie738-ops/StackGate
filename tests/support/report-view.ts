import fs from 'node:fs';
import type {CheckPlan,RunManifest,GateEvaluation} from '../../packages/contracts/src/index.js';
export function reportFixture(){
 const manifest=JSON.parse(fs.readFileSync('tests/fixtures/protocols/run.json','utf8')) as RunManifest;
 const plan=JSON.parse(fs.readFileSync('tests/fixtures/protocols/plan.json','utf8')) as CheckPlan;
 plan.required_check_ids=['unit','missing'];manifest.checks[0]!.status='FAIL';manifest.checks[0]!.reasons=['Observed <failure> & detail\u001b[31m'];
 const evaluation:GateEvaluation={schema_version:'0.1',verdict:'FAIL',freshness:'STALE',decision:'DENY',exit_code:4,reasons:['INPUT_STALE']};
 return {source:{manifest,plan,artifacts:[]},evaluation};
}
