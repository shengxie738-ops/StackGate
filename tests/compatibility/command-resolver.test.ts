import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {taskProject} from '../support/task-project.js';
import {TrustService} from '../../packages/core/src/services/trust-service.js';
import {CommandResolver} from '../../packages/core/src/services/command-resolver.js';
import {filterEnvironment} from '../../packages/core/src/domain/environment-filter.js';
import {resolveReviewedTool,reviewedPathDirectories} from '../../packages/core/src/services/reviewed-tool.js';
import {createRunWorkspace} from '../../packages/runner-local/src/workspace.js';
import {withTestDirectory} from '../support/test-paths.js';
vi.setConfig({testTimeout:180000});
async function fixture(exec=process.execPath,args=['argv.cjs','中文 空格','a&b','a;b']){
 const repo=await taskProject(),store=await fs.mkdtemp(path.join(os.tmpdir(),'stackgate-resolver-'));
 const cwd=path.join(repo.root,'apps/web');await fs.mkdir(cwd,{recursive:true});await fs.mkdir(path.join(repo.root,'apps/api'),{recursive:true});
 repo.config.commands={test:{workspace:'web',exec,args,timeout_seconds:15}};repo.config.checks={test:{adapter:'command',command:'test',result_kind:'exit-code'}};repo.config.profiles.integration.required_checks=['test'];
 await fs.writeFile(path.join(cwd,'argv.cjs'),'console.log(JSON.stringify({argv:process.argv.slice(2),environment:process.env}));');await fs.writeFile(path.join(repo.root,'.stackgate.yaml'),JSON.stringify(repo.config));
 const trust=new TrustService(repo.root,{storeRoot:store}),resolver=new CommandResolver(repo.root,{trustStoreRoot:store});
 const context={execution_digest:'',run_id:'run_resolver',check_id:'test',attempt_id:'attempt_1',output_dir:path.join(repo.root,repo.config.state_dir,'work/run_resolver/test/attempt_1'),allowed_origins:[] as string[],owner_token:randomUUID()};await fs.mkdir(context.output_dir,{recursive:true});
 return {...repo,cwd,trust,resolver,context,async authorize(){const preview=await trust.review();await trust.confirm(preview.execution_digest,{authorized:true});context.execution_digest=preview.execution_digest;await createRunWorkspace(path.join(repo.root,repo.config.state_dir),{schema_version:'0.1',run_id:context.run_id,repo_id:preview.execution_preview.repo_id,worktree_id:preview.execution_preview.worktree_id,owner_token:context.owner_token,created_at:new Date().toISOString()});return preview;},async close(){await repo.cleanup();if(path.dirname(store)!==path.resolve(os.tmpdir())||!path.basename(store).startsWith('stackgate-resolver-'))throw Error('unsafe');await fs.rm(store,{recursive:true,force:true});}};
}
it('requires current explicit grant then preserves Unicode and shell metacharacters as argv',async()=>{
 const f=await fixture();try{
  f.context.execution_digest=(await f.trust.review()).execution_digest;await expect(f.resolver.resolve('test',f.context)).rejects.toThrow();
  vi.stubEnv('STACKGATE_TEST_TOKEN','known-secret');vi.stubEnv('UNRELATED_SECRET','must-not-inherit');vi.stubEnv('NODE_OPTIONS','--require missing-untrusted-preload');
  const preview=await f.authorize();expect(JSON.stringify(preview)).not.toContain('known-secret');const command=await f.resolver.resolve('test',f.context);
  const result=spawnSync(command.identity.executable,[...command.args],{cwd:command.cwd,env:command.environment,encoding:'utf8',shell:false});expect(result.status,result.stderr).toBe(0);
  const observed=JSON.parse(result.stdout);expect(observed.argv).toEqual(['中文 空格','a&b','a;b']);expect(observed.environment.STACKGATE_TEST_TOKEN).toBe('known-secret');expect(observed.environment).not.toHaveProperty('UNRELATED_SECRET');expect(observed.environment).not.toHaveProperty('NODE_OPTIONS');expect(observed.environment.STACKGATE_RUN_ID).toBe('run_resolver');
  expect(command.identity.version).toBe(process.version.slice(1));expect(command.verified_inputs?.some(input=>input.path.endsWith('argv.cjs'))).toBe(true);
  await fs.appendFile(path.join(f.cwd,'argv.cjs'),'\n// changed');await expect(f.resolver.resolve('test',f.context)).rejects.toThrow();
 }finally{vi.unstubAllEnvs();await f.close();}
});
it('resolves reviewed npm.cmd to Node and fixed JS entry, then runs actual npm script without shell fallback',async()=>{
 const npm=path.join(path.dirname(process.execPath),'npm.cmd'),f=await fixture(npm,['run','typecheck']);
 try{await fs.writeFile(path.join(f.cwd,'package.json'),JSON.stringify({scripts:{typecheck:'node -e "console.log(12345)"'}}));await f.authorize();const command=await f.resolver.resolve('test',f.context);expect(command.identity.executable).toBe(process.execPath);expect(command.args[0]).toMatch(/npm-cli\.js$/);expect(command.verified_inputs?.some(input=>input.path===npm)).toBe(true);const result=spawnSync(command.identity.executable,[...command.args],{cwd:command.cwd,env:command.environment,shell:false,encoding:'utf8'});expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('12345');}finally{await f.close();}
});
it('blocks unknown batch commands and repository PATH tool substitution',async()=>{
 const f=await fixture();try{const fake=path.join(f.root,'evil.cmd');await fs.writeFile(fake,'@echo PASS\r\n');f.config.commands.test.exec=fake;await fs.writeFile(path.join(f.root,'.stackgate.yaml'),JSON.stringify(f.config));await expect(f.trust.review()).rejects.toThrow();f.config.commands.test.exec='npm';await fs.writeFile(path.join(f.root,'.stackgate.yaml'),JSON.stringify(f.config));await fs.writeFile(path.join(f.root,'npm.cmd'),'@echo hijacked');vi.stubEnv('PATH',f.root);await expect(f.trust.review()).rejects.toThrow();}finally{vi.unstubAllEnvs();await f.close();}
});
it('rejects output outside exact run scope and origins outside the reviewed permission',async()=>{
 const f=await fixture();try{await f.authorize();await expect(f.resolver.resolve('test',{...f.context,output_dir:f.cwd})).rejects.toThrow();await expect(f.resolver.resolve('test',{...f.context,allowed_origins:['https://unreviewed.invalid']})).rejects.toThrow();await expect(f.resolver.resolve('test',{...f.context,owner_token:randomUUID()})).rejects.toThrow();}finally{await f.close();}
});
it('normalizes Windows environment names and rejects ambiguous duplicate values',()=>{
 expect(filterEnvironment({Path:'A',PATH:'A',NODE_OPTIONS:'bad',TOKEN:'ok'},['TOKEN'],'win32')).toEqual({PATH:'A',TOKEN:'ok'});
 expect(()=>filterEnvironment({Path:'A',PATH:'B'},[],'win32')).toThrow();
});
it('resolves the actually installed pnpm wrapper and binds its CRLF wrapper bytes and JavaScript entry',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stackgate-pnpm-'));
 try{const tool=await resolveReviewedTool('pnpm',root,root,await reviewedPathDirectories(root));expect(tool.invocation?.verified_inputs.some(input=>input.path.endsWith('pnpm.cmd'))).toBe(true);const invocation=tool.invocation!;const result=spawnSync(invocation.identity.executable,[...invocation.args_prefix,'--version'],{cwd:root,env:filterEnvironment(process.env,[],process.platform),encoding:'utf8',shell:false});expect(result.status,result.stderr).toBe(0);expect(result.stdout.trim()).toBe(invocation.package_version);}finally{await fs.rmdir(root);}
});
it('executes a reviewed native binary from an installation path containing spaces and Chinese',()=>withTestDirectory(async parent=>{
 const directory=path.join(parent,'Program Files 中文');await fs.mkdir(directory);const executable=path.join(directory,'node.exe');await fs.copyFile(process.execPath,executable);
 const f=await fixture(executable);try{await f.authorize();const command=await f.resolver.resolve('test',f.context);const result=spawnSync(command.identity.executable,[...command.args],{cwd:command.cwd,env:command.environment,shell:false,encoding:'utf8'});expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).argv[0]).toBe('中文 空格');}finally{await f.close();}
}));
it('invalidates the grant when a reviewed wrapper JavaScript entry changes',()=>withTestDirectory(async parent=>{
 const installation=path.join(parent,'npm-install');await fs.mkdir(path.join(installation,'node_modules/npm/bin'),{recursive:true});const source=path.dirname(process.execPath);
 for(const relative of ['npm.cmd','node_modules/npm/package.json','node_modules/npm/bin/npm-cli.js'])await fs.copyFile(path.join(source,relative),path.join(installation,relative));
 const f=await fixture(path.join(installation,'npm.cmd'),['--version']);try{await f.authorize();await fs.appendFile(path.join(installation,'node_modules/npm/bin/npm-cli.js'),'\n// changed after review');await expect(f.resolver.resolve('test',f.context)).rejects.toThrow();expect((await f.trust.review()).already_trusted).toBe(false);}finally{await f.close();}
}));
