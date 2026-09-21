import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {JunitAdapter} from '../../../packages/adapter-junit/src/junit-adapter.js';
import {commandExecution,commandStep} from '../../support/command-execution.js';
import {withTestDirectory} from '../../support/test-paths.js';
import {validateSchema,type CheckStep} from '../../../packages/contracts/src/index.js';
vi.setConfig({testTimeout:45000});
const step:CheckStep={...commandStep,adapter_id:'junit',expected_artifacts:['junit.xml'],min_tests:1,parameters:{adapter_id:'junit',report_name:'junit.xml'}};
const producer=(xml:string|null,exit=0)=>`${xml===null?'':`require('fs').writeFileSync(require('path').join(process.env.STACKGATE_OUTPUT_DIR,'junit.xml'),${JSON.stringify(xml)});`}process.exit(${exit});`;
it.each([
 ['<testsuite><testcase name="one"/></testsuite>',0,'PASS',1],
 ['<testsuite tests="999"/>',0,'BLOCKED',0],
 [null,0,'BLOCKED',0],
 [null,7,'ERROR',0],
 ['<testsuite><testcase name="one"><skipped/></testcase></testsuite>',0,'BLOCKED',0],
 ['<testsuite><testcase name="one"><failure>bad</failure></testcase></testsuite>',0,'FAIL',1],
 ['<testsuite><testcase name="one"><failure/></testcase></testsuite>',7,'FAIL',1],
 ['<testsuite><testcase name="one"/></testsuite>',7,'ERROR',1],
 ['<testsuite>',0,'ERROR',0],
 ['<!DOCTYPE testsuite SYSTEM "file:///secret"><testsuite/>',0,'ERROR',0],
 ['<testsuite><testcase name="one"><flakyFailure/></testcase></testsuite>',0,'BLOCKED',1],
 ] as const)('collects real report %s exit %s as %s', (xml,exit,status,executed)=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,producer(xml,exit)),adapter=new JunitAdapter();for await(const event of adapter.execute(step,harness.context)){void event;}
 const result=await adapter.collect(step,{...harness.collection,artifacts:harness.artifacts});expect(validateSchema('check-result',result).ok).toBe(true);expect(result.status).toBe(status);expect(result.executed_tests).toBe(executed);expect(result.exit_code).toBe(exit);
 if(xml!==null){const raw=harness.artifacts.find(a=>a.relative_path.endsWith('/junit.xml'))!;expect(raw.sensitivity).toBe('restricted');const saved=await harness.store.read({run_id:raw.run_id,relative_path:raw.relative_path,expected_digest:raw.digest,max_bytes:9*1024*1024});expect(saved.status==='FOUND'&&Buffer.from(saved.bytes).toString()).toBe(xml);}
}));
it('requires declared IDs and minimum executed cases',()=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,producer('<testsuite><testcase name="one"/></testsuite>')),adapter=new JunitAdapter();for await(const event of adapter.execute(step,harness.context)){void event;}
 const result=await adapter.collect({...step,min_tests:2,expected_test_ids:['missing']},{...harness.collection,artifacts:harness.artifacts});expect(result.status).toBe('BLOCKED');expect(result.reasons).toContain('MISSING_REQUIRED_TEST');expect(result.reasons).toContain('MIN_TESTS_NOT_MET');
}));
it('refuses a prior report before executing and preserves user bytes',()=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,`require('fs').writeFileSync('launched','yes')`),adapter=new JunitAdapter();await fs.writeFile(path.join(root,'junit.xml'),'old');
 await expect(async()=>{for await(const event of adapter.execute(step,harness.context)){void event;}}).rejects.toThrow();expect(await fs.readFile(path.join(root,'junit.xml'),'utf8')).toBe('old');await expect(fs.stat(path.join(root,'launched'))).rejects.toThrow();
}));
it('rejects a producer hard link to another report and preserves source bytes',()=>withTestDirectory(async root=>{
 const source=path.join(root,'old.xml'),xml='<testsuite><testcase name="old"/></testsuite>';await fs.writeFile(source,xml);
 const harness=await commandExecution(root,`require('fs').linkSync(${JSON.stringify(source)},require('path').join(process.env.STACKGATE_OUTPUT_DIR,'junit.xml'))`),adapter=new JunitAdapter();
 await expect(async()=>{for await(const event of adapter.execute(step,harness.context)){void event;}}).rejects.toThrow('Unsafe');expect(await fs.readFile(source,'utf8')).toBe(xml);
}));
it('collects only stored current-scope evidence and rejects tampered metadata',()=>withTestDirectory(async root=>{
 const harness=await commandExecution(root,producer('<testsuite><testcase name="one"/></testsuite>')),adapter=new JunitAdapter();for await(const event of adapter.execute(step,harness.context)){void event;}
 await fs.writeFile(path.join(root,'junit.xml'),'<testsuite/>');const context={...harness.collection,artifacts:harness.artifacts};expect((await adapter.collect(step,context)).status).toBe('PASS');
 const tampered=harness.artifacts.map(a=>a.relative_path.endsWith('/junit.xml')?{...a,artifact_id:'artifact_forged'}:a);expect((await adapter.collect(step,{...context,artifacts:tampered})).status).toBe('ERROR');
 const prior=harness.artifacts.map(a=>a.relative_path.endsWith('/junit.xml')?{...a,attempt_id:'attempt_old'}:a);expect((await adapter.collect(step,{...context,artifacts:prior})).status).toBe('ERROR');
}));
it('retains no credential messages in regular result facts',()=>withTestDirectory(async root=>{
 const secret='canary_password_8573',xml=`<testsuite><testcase name="one"><failure>password=${secret}</failure></testcase></testsuite>`,harness=await commandExecution(root,producer(xml)),adapter=new JunitAdapter();for await(const event of adapter.execute(step,harness.context)){void event;}
 const result=await adapter.collect(step,{...harness.collection,artifacts:harness.artifacts});expect(JSON.stringify(result)).not.toContain(secret);expect(result.status).toBe('FAIL');
}));
it('refuses a junction to a prior output directory before launching',()=>withTestDirectory(async root=>{
 const old=path.join(root,'old-output'),linked=path.join(root,'linked-output');await fs.mkdir(old);await fs.writeFile(path.join(old,'junit.xml'),'<testsuite><testcase name="old"/></testsuite>');await fs.symlink(old,linked,'junction');
 const harness=await commandExecution(root,'process.exit(0)'),adapter=new JunitAdapter();harness.context.environment={STACKGATE_OUTPUT_DIR:linked};harness.context.allowed_paths=[linked];
 await expect(async()=>{for await(const event of adapter.execute(step,harness.context)){void event;}}).rejects.toThrow('Unsafe');expect(harness.artifacts).toEqual([]);
}));
