import { spawnSync } from 'node:child_process';
for (const args of [['node_modules/vitest/vitest.mjs','run','tests/unit'],['--test','tests/bootstrap/ledger.test.mjs','tests/bootstrap/cli.test.mjs','tests/bootstrap/stage.test.mjs','tests/bootstrap/audit-record.test.mjs','tests/bootstrap/tool-package.test.mjs','tests/bootstrap/audit-m3-ledger.test.mjs','tests/bootstrap/record-identity.test.mjs']]) {
  const result=spawnSync(process.execPath,args,{stdio:'inherit'});
  if(result.error) { console.error(result.error.message); process.exit(3); }
  if(result.status !== 0) process.exit(result.status ?? 3);
}
