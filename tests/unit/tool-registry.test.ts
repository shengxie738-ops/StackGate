import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {withTestDirectory} from '../support/test-paths.js';
import {ToolRegistryService} from '../../packages/core/src/services/tool-registry-service.js';
const binary=path.resolve('tools/bin/oasdiff-1.32.1/oasdiff.exe');
const relative='tools/bin/oasdiff-1.32.1/oasdiff.exe';
it('resolves copied verified bytes in Chinese and space installation paths',()=>withTestDirectory(async parent=>{
 const root=path.join(parent,'中文 安装');await fs.mkdir(path.dirname(path.join(root,relative)),{recursive:true});await fs.copyFile(binary,path.join(root,relative));
 const result=await new ToolRegistryService({installationRoot:root}).resolveOasdiff();expect(result.status).toBe('VERIFIED');if(result.status==='VERIFIED')expect(result.tool.executable).toBe(path.join(root,relative));
}));
it('blocks missing and same-name wrong bytes without trusting PATH',()=>withTestDirectory(async root=>{
 await fs.writeFile(path.join(root,'oasdiff.exe'),'malicious PATH binary');vi.stubEnv('PATH',root);
 try{expect((await new ToolRegistryService({installationRoot:root}).resolveOasdiff()).status).toBe('BLOCKED');await fs.mkdir(path.dirname(path.join(root,relative)),{recursive:true});await fs.writeFile(path.join(root,relative),'oasdiff version 1.32.1');expect(await new ToolRegistryService({installationRoot:root}).resolveOasdiff()).toMatchObject({status:'BLOCKED',reason:'DIGEST_MISMATCH'});}finally{vi.unstubAllEnvs();}
}));
it('does not inherit Windows verification on Linux or another architecture',async()=>{
 expect(await new ToolRegistryService({platform:'linux-x64'}).resolveOasdiff()).toMatchObject({status:'BLOCKED',reason:'PLATFORM_UNVERIFIED',platform:'linux-x64'});
 expect(await new ToolRegistryService({platform:'win32-arm64'}).resolveOasdiff()).toMatchObject({status:'BLOCKED',reason:'PLATFORM_UNVERIFIED'});
});
it('rejects a linked tool directory even when its target holds reviewed bytes',()=>withTestDirectory(async root=>{
 await fs.mkdir(path.join(root,'tools/bin'),{recursive:true});
 await fs.symlink(path.dirname(binary),path.join(root,'tools/bin/oasdiff-1.32.1'),'junction');
 expect(await new ToolRegistryService({installationRoot:root}).resolveOasdiff()).toMatchObject({status:'BLOCKED',reason:'UNSAFE_INSTALLATION'});
}));
