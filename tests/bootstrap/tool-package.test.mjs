import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packageTool} from '../../scripts/package-tool.mjs';
test('missing source removes only previously packaged exact tool, preserving unrelated files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stackgate-package-tool-'));
 try{
 const sourceRoot=path.join(root,'source'),destinationRoot=path.join(root,'dist'),relativePath='tools/bin/tool.exe',expectedDigest=createHash('sha256').update('reviewed').digest('hex');
 await fs.mkdir(path.join(sourceRoot,'tools/bin'),{recursive:true});await fs.writeFile(path.join(sourceRoot,relativePath),'reviewed');
 assert.equal(await packageTool({sourceRoot,destinationRoot,relativePath,expectedDigest}),'PACKAGED');
 await fs.writeFile(path.join(destinationRoot,'unrelated.txt'),'keep');await fs.unlink(path.join(sourceRoot,relativePath));
 assert.equal(await packageTool({sourceRoot,destinationRoot,relativePath,expectedDigest}),'NOT_INSTALLED');
 await assert.rejects(fs.access(path.join(destinationRoot,relativePath)),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(destinationRoot,'unrelated.txt'),'utf8'),'keep');
 }finally{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'stackgate-package-tool-'))throw new Error('Unsafe cleanup');await fs.rm(root,{recursive:true,force:true});}
});
