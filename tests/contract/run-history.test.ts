import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import {validateSchema} from '../../packages/contracts/src/index.js';
it('accepts an optional explicit previous run reference without requiring or weakening old manifests',async()=>{
 const run=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8'));
 expect(validateSchema('run',run).ok).toBe(true);expect(validateSchema('run',{...run,previous_run_id:'run_previous'}).ok).toBe(true);
 expect(validateSchema('run',{...run,previous_run_id:'../other'}).ok).toBe(false);expect(validateSchema('run',{...run,previous_run_id:null}).ok).toBe(false);
});
