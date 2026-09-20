import { expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTestDirectory } from '../../support/test-paths.js';
import { loadConfiguration, parseConfiguration } from '../../../packages/core/src/services/config-service.js';
const sample=JSON.parse(await readFile('tests/fixtures/config/original.json','utf8'));
it('loads the retained config without mutation',async()=>withTestDirectory(async root=>{
  const file=join(root,'.stackgate.yaml');await writeFile(file,JSON.stringify(sample));expect(await loadConfiguration(file)).toEqual(sample);
}));
it.each(['timeout: 1\ntimeout: 2','{"schema_version":"0.1","schema_version":"0.1"}','x: !!js/function "function(){return 1}"','x: &a [*a]'])('rejects duplicate keys, executable tags and aliases %#',source=>{
  expect(()=>parseConfiguration(Buffer.from(source),'.stackgate.yaml')).toThrowError(expect.objectContaining({exit_code:64}));
});
it('rejects unknown references and dependency cycles',()=>{
  const unknown=structuredClone(sample);unknown.commands.web_unit.workspace='absent';
  expect(()=>parseConfiguration(Buffer.from(JSON.stringify(unknown)),'.stackgate.yaml')).toThrowError(expect.objectContaining({exit_code:64}));
  const cycle=structuredClone(sample);cycle.extensions={stackgate_v0_1:{check_dependencies:{unit:['e2e'],e2e:['unit']}}};
  expect(()=>parseConfiguration(Buffer.from(JSON.stringify(cycle)),'.stackgate.yaml')).toThrowError(expect.objectContaining({exit_code:64}));
  const bad=structuredClone(sample);bad.profiles.integration.required_checks=['unknown'];expect(()=>parseConfiguration(Buffer.from(JSON.stringify(bad)),'.stackgate.yaml')).toThrow();
});
it('rejects oversized and excessively nested documents',()=>{
  expect(()=>parseConfiguration(Buffer.alloc(1048577,32),'config')).toThrow();
  expect(()=>parseConfiguration(Buffer.from('['.repeat(100)+'0'+']'.repeat(100)),'config')).toThrow();
});
