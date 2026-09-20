import { spawnSync } from 'node:child_process';
for (const args of [['node_modules/vitest/vitest.mjs','run','tests/unit'],['--test','tests/bootstrap/ledger.test.mjs','tests/bootstrap/cli.test.mjs','tests/bootstrap/stage.test.mjs']]) {
  const result=spawnSync(process.execPath,args,{stdio:'inherit'});
  if(result.error) { console.error(result.error.message); process.exit(3); }
  if(result.status !== 0) process.exit(result.status ?? 3);
}
