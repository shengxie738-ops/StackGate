import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
test('audit records retain actual child failure and repository identity',()=>{
  const result=spawnSync(process.execPath,['scripts/record.mjs','M1-R00','recorder-counterexample','--','node','-e','process.exit(7)'],{encoding:'utf8'});
  assert.equal(result.status,7,result.stderr);
  const filename=result.stderr.match(/Evidence: ([^;]+);/)?.[1];
  assert.ok(filename,result.stderr);
  const record=JSON.parse(readFileSync(filename,'utf8'));
  assert.equal(record.task_id,'M1-R00');
  assert.equal(record.exit_code,7);
  assert.match(record.repository.head,/^[a-f0-9]{40,64}$/);
  assert.match(record.repository.worktree_digest,/^[a-f0-9]{64}$/);
  assert.equal(record.repository.identity_status,'VERIFIED');
});
