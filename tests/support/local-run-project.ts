import fs from 'node:fs/promises';
import path from 'node:path';
import {localPlanProject} from './local-plan-project.js';
import {PlanService} from '../../packages/core/src/services/plan-service.js';
export type LocalRunMode='pass'|'fail'|'zero'|'missing'|'malformed'|'skipped'|'timeout'|'mutate-input';
/** Modes are immutable source inputs written before task confirmation and execution trust. */
export async function localRunProject(mode:LocalRunMode='pass',options:{confirmed?:boolean}={}){
 if(!['pass','fail','zero','missing','malformed','skipped','timeout','mutate-input'].includes(mode))throw new Error('Unknown local run fixture mode');
 const repo=await localPlanProject(options.confirmed??true,async project=>{
  project.config.commands.smoke.args=['run.js','smoke'];project.config.commands.unit.args=['run.js','unit'];
  project.config.commands.unit.timeout_seconds=mode==='timeout'?1:10;
  project.config.profiles.local.required_checks=['smoke','unit'];project.task.required_checks=['smoke','unit'];
  project.config.extensions={...project.config.extensions,stackgate_v0_1:{...project.config.extensions?.stackgate_v0_1,check_dependencies:{smoke:[],unit:['smoke']}}};
  project.config.security.protected_inputs=[...new Set([...project.config.security.protected_inputs,'apps/web/input.json'])];
  await fs.writeFile(path.join(project.root,'apps/web/input.json'),JSON.stringify({numbers:mode==='fail'?[2,4]:[2,3],expected:5}));
  await fs.writeFile(path.join(project.root,'apps/web/run.js'),`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mode = ${JSON.stringify(mode)};
const escapeXml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function main() {
  const inputFile = path.join(__dirname,'input.json');
  const input = JSON.parse(fs.readFileSync(inputFile,'utf8'));
  if (process.argv[2] === 'smoke') {
    assert.ok(Array.isArray(input.numbers) && input.numbers.every(Number.isFinite));
    assert.equal(typeof input.expected,'number');
    console.log('Input shape verified');
    return;
  }
  if (process.argv[2] !== 'unit') throw new Error('Unknown fixture command');
  const output = process.env.STACKGATE_OUTPUT_DIR;
  if (!output || !path.isAbsolute(output)) throw new Error('Explicit absolute owned output directory required');
  if (mode === 'timeout') { fs.writeFileSync(path.join(output,'started.marker'),'business process started'); console.log('Fixture is waiting for cancellation'); setInterval(()=>{},1000); return; }
  fs.mkdirSync(output,{recursive:true});
  const report = path.join(output,'junit.xml');
  if (mode === 'zero') { fs.writeFileSync(report,'<testsuite name="local" tests="0" failures="0" errors="0" skipped="0"/>'); return; }
  const properties = '<properties><property name="stackgate-id" value="local-case"/></properties>';
  if (mode === 'skipped') { fs.writeFileSync(report,'<testsuite name="local" tests="1" failures="0" errors="0" skipped="1"><testcase classname="local" name="local-case">'+properties+'<skipped message="fixture requested skip"/></testcase></testsuite>'); return; }
  let failure = null;
  try { assert.equal(input.numbers.reduce((sum,value)=>sum+value,0),input.expected,'Calculated total matches the expected value'); }
  catch (error) { failure = error; }
  if (mode === 'mutate-input') fs.writeFileSync(inputFile,JSON.stringify({...input,expected:input.expected+1}));
  if (mode !== 'missing') fs.writeFileSync(report,mode === 'malformed' ? '<testsuite><testcase' : '<testsuite name="local" tests="1" failures="'+(failure?1:0)+'" errors="0" skipped="0"><testcase classname="local" name="local-case">'+properties+(failure?'<failure message="'+escapeXml(failure.message)+'">'+escapeXml(failure.message)+'</failure>':'')+'</testcase></testsuite>');
  process.exitCode = failure ? 1 : 0;
}
main();
`);
 });
 const planService=new PlanService(repo.root,{trustStoreRoot:repo.store});
 return {...repo,mode,profile:'local' as const,script:path.join(repo.root,'apps/web/run.js'),input:path.join(repo.root,'apps/web/input.json'),planService,
  createPlan:()=>planService.create({task:repo.taskFile,profile:'local',base:'HEAD'}),
  cleanup:()=>repo.close(),
 };
}
