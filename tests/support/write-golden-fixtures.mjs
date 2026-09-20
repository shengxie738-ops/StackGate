import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { protocolFixture, hash, at } from './protocol-fixtures.ts';
import { createGateInput, createCheckFact } from './factories.ts';
// Hand-specified expectations: never derive expected evaluations with evaluateGate.
const cases = {
  pass: {input:createGateInput(),verdict:'PASS',freshness:'FRESH',exit_code:0,reasons:[]},
  fail: {input:createGateInput({checks:[createCheckFact({status:'FAIL',exit_code:1})]}),verdict:'FAIL',freshness:'FRESH',exit_code:1,reasons:['CHECK_FAILED:unit']},
  incomplete: {input:createGateInput({checks:[createCheckFact({status:'BLOCKED',exit_code:null,executed_tests:0,discovered_tests:0,executed_test_ids:[],reasons:['NO_TESTS'],evidence_refs:[]})]}),verdict:'INCOMPLETE',freshness:'FRESH',exit_code:2,reasons:['unit:NO_TESTS','CHECK_BLOCKED:unit','MISSING_REPORT:unit','NO_TESTS:unit','REQUIRED_TEST_MISSING:unit']},
  error: {input:createGateInput({report_integrity:'INVALID'}),verdict:'ERROR',freshness:'FRESH',exit_code:3,reasons:['REPORT_INVALID']},
  stale: {input:createGateInput({freshness:'STALE'}),verdict:'PASS',freshness:'STALE',exit_code:4,reasons:['INPUT_STALE']},
};
const manifest=JSON.parse(fs.readFileSync('schemas/fixtures.json','utf8'));
fs.mkdirSync('tests/fixtures/gate',{recursive:true});
for(const [name,{input,verdict,freshness,exit_code,reasons}] of Object.entries(cases)) {
  const run=protocolFixture('run');
  const evaluation={schema_version:'0.1',run_id:'run_fixture',policy_hash:hash,evaluated_at:at,verdict,freshness,exit_code,reasons,decision:exit_code===0?'ALLOW':'DENY'};
  run.checks[0]={...run.checks[0],...input.checks[0]};
  run.checks[0].attempts[0].status=run.checks[0].status;
  run.checks[0].attempts[0].raw_exit_code=run.checks[0].exit_code;
  run.checks[0].attempts[0].evidence_refs=run.checks[0].evidence_refs;
  run.verdict=name==='error'?'PASS':verdict;
  const path='tests/fixtures/gate/'+name+'.json';
  fs.writeFileSync(path,JSON.stringify({fixture_only:true,run,input,evaluation},null,2)+'\n');
  manifest.push({schema:'gate-fixture',path,valid:true});
}
const task=JSON.parse(fs.readFileSync('tests/fixtures/tasks/draft.json','utf8'));
task.compatibility={mode:'approved-changes',approved_breaking_rules:[{
  operation_key:'api:GET /api/performance',rule_id:'response-required-property-removed',
  baseline_hash:createHash('sha256').update(fs.readFileSync('tests/fixtures/contracts/upgrade-baseline.json')).digest('hex'),
  target_hash:createHash('sha256').update(fs.readFileSync('tests/fixtures/contracts/upgrade-target.json')).digest('hex'),
  reason:'Synthetic approval fixture: migrate the old data.total_return consumer to data.performance.total_return.'
}]};
task.allowed_change_paths.push('apps/web/tests/performance.test.ts');
fs.writeFileSync('tests/fixtures/tasks/approved-upgrade.json',JSON.stringify(task,null,2)+'\n');
manifest.push({schema:'task',path:'tests/fixtures/tasks/approved-upgrade.json',valid:true});
const unique=[...new Map(manifest.map(item=>[item.path,item])).values()];
fs.writeFileSync('schemas/fixtures.json',JSON.stringify(unique,null,2)+'\n');
