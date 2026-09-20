import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateStageManifest, validateToolRequirements, runRegisteredChecks } from '../../scripts/verify-stage.mjs';
const manifest = {schema_version:'0.1',stage:'M0',checks:['source','tasks','schemas','boundaries','build','typecheck','unit','lint','contract'],required_tools:['node','pnpm','typescript','ajv','vitest','esbuild']};
test('M1 requires every M0 check, actual integration checks and the real oasdiff capability',()=>{
  assert.ok(validateStageManifest(manifest,'M1').length,'a renamed M0 manifest must never satisfy a requested M1 stage');
  const m1={...manifest,stage:'M1',checks:[...manifest.checks,'integration'],required_tools:[...manifest.required_tools,'oasdiff']};
  assert.deepEqual(validateStageManifest(m1),[]);
  for(const check of m1.checks)assert.ok(validateStageManifest({...m1,checks:m1.checks.filter(id=>id!==check)}).length);
  assert.ok(validateStageManifest({...m1,required_tools:manifest.required_tools}).length);
  assert.ok(validateToolRequirements(m1,{tools:[]}).some(e=>e.includes('oasdiff')));
});
test('M2 registers every execution, evidence and Gate check without allowing omissions',()=>{
 const m2={...manifest,stage:'M2',checks:[...manifest.checks,'integration','m2-runner','m2-evidence','m2-gate'],required_tools:[...manifest.required_tools,'oasdiff','saxes']};
 assert.deepEqual(validateStageManifest(m2),[]);
 for(const check of m2.checks)assert.ok(validateStageManifest({...m2,checks:m2.checks.filter(id=>id!==check)}).length,'missing '+check);
 for(const tool of ['oasdiff','saxes'])assert.ok(validateStageManifest({...m2,required_tools:m2.required_tools.filter(id=>id!==tool)}).length);
});
test('M0 rejects removed, duplicate and arbitrary shell checks', () => {
  assert.deepEqual(validateStageManifest(manifest), []);
  for(const checks of [[],manifest.checks.slice(1),[...manifest.checks,'unit'],[...manifest.checks,'echo PASS']]) assert.ok(validateStageManifest({...manifest,checks}).length);
});
test('unknown tools block any stage requiring them', () => {
  const tools=manifest.required_tools.map(name=>({name,status:'VERIFIED',version:'1.0.0',tested_capabilities:['test'],verified_at:'2026-09-20T00:00:00Z',checksum_or_lock_integrity:'sha256:'+ 'a'.repeat(64)}));
  assert.deepEqual(validateToolRequirements(manifest,{tools}),[]);
  tools[0].status='UNKNOWN';
  assert.ok(validateToolRequirements(manifest,{tools}).some(error=>error.includes('node')));
  assert.ok(validateToolRequirements({...manifest,required_tools:['oasdiff']},{tools}).some(error=>error.includes('oasdiff')));
});
test('a real failed child command propagates its exit and retains its identity', async () => {
  const directory=await mkdtemp(join(tmpdir(),'stackgate-stage-'));
  try {
    const result=await runRegisteredChecks(['source'],{cwd:directory,quiet:true});
    assert.equal(result.exit_code,1);
    assert.equal(result.checks[0].id,'source');
    assert.match(result.checks[0].command,/verify-source/);
    assert.match(result.checks[0].output,/MODULE_NOT_FOUND/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
