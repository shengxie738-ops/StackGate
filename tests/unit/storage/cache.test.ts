import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ParseCache,type CacheIdentity} from '../../../packages/core/src/storage/parse-cache.js';
import {withTestDirectory} from '../../support/test-paths.js';
const identity:CacheIdentity={content_digest:'a'.repeat(64),parser_version:'parser-1',schema_version:'0.1',configuration_digest:'b'.repeat(64),platform:'win32-x64'};
const imports={kind:'typescript-imports' as const,value:{imports:['./api','react']}};
it('reuses identical static parse data and invalidates every identity input',()=>withTestDirectory(async root=>{
 const cache=new ParseCache(root);await cache.put(identity,imports);
 expect(await cache.get(identity,'typescript-imports')).toMatchObject({status:'HIT',entry:imports});
 for(const patch of [{content_digest:'c'.repeat(64)},{parser_version:'parser-2'},{schema_version:'0.2'},{configuration_digest:'c'.repeat(64)},{platform:'linux-x64'}])expect(await cache.get({...identity,...patch},'typescript-imports')).toMatchObject({status:'MISS'});
}));
it('rejects runtime check and gate results even when cast through an untyped caller',()=>withTestDirectory(async root=>{
 const cache=new ParseCache(root);
 for(const entry of [{kind:'check-result',value:{status:'PASS'}},{kind:'gate',value:{decision:'ALLOW'}},{kind:'typescript-imports',value:{imports:[],verdict:'PASS'}}])await expect(cache.put(identity,entry as unknown as typeof imports)).rejects.toThrow();
}));
it('treats corruption as a miss, reparses and preserves unrelated files',()=>withTestDirectory(async root=>{
 const cache=new ParseCache(root);let parsed=0;
 const parse=()=>{parsed++;return imports;};
 const first=await cache.getOrParse(identity,'typescript-imports',parse);expect(first.cache).toBe('MISS');expect(first.parse_ms).toBeGreaterThanOrEqual(0);
 expect((await cache.getOrParse(identity,'typescript-imports',parse)).cache).toBe('HIT');expect(parsed).toBe(1);
 const files=await fs.readdir(path.join(root,'parse-cache-v1'));const entry=files.find(file=>file.endsWith('.json')&&file!=='owner.json')!;
 await fs.writeFile(path.join(root,'parse-cache-v1',entry),'broken JSON');await fs.writeFile(path.join(root,'keep.txt'),'user content');
 expect((await cache.getOrParse(identity,'typescript-imports',parse)).cache).toBe('MISS');expect(parsed).toBe(2);expect(await fs.readFile(path.join(root,'keep.txt'),'utf8')).toBe('user content');
}));
it('bounds retained bytes and never follows a substituted cache link',()=>withTestDirectory(async root=>{
 const cache=new ParseCache(root,{max_bytes:1800,max_entry_bytes:900});
 for(let i=0;i<8;i++)await cache.put({...identity,parser_version:'v'+i},{kind:'typescript-imports',value:{imports:['x'.repeat(250)]}});
 const directory=path.join(root,'parse-cache-v1'),files=(await fs.readdir(directory)).filter(file=>file.endsWith('.json')&&file!=='owner.json');let total=0;
 for(const file of files)total+=(await fs.stat(path.join(directory,file))).size;expect(total).toBeLessThanOrEqual(1800);
 await expect(cache.put(identity,{kind:'typescript-imports',value:{imports:['x'.repeat(2000)]}})).rejects.toThrow();
 const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.rename(directory,directory+'-original');await fs.symlink(outside,directory,'junction');
 expect(await cache.get(identity,'typescript-imports')).toMatchObject({status:'MISS'});await expect(cache.put(identity,imports)).rejects.toThrow();expect(await fs.readdir(outside)).toEqual([]);
}));
it('supports only strict static configuration and bounded OpenAPI operation projections',()=>withTestDirectory(async root=>{
 const cache=new ParseCache(root),config=JSON.parse(await fs.readFile('tests/fixtures/config/original.json','utf8'));
 await cache.put(identity,{kind:'configuration',value:config});expect(await cache.get(identity,'configuration')).toMatchObject({status:'HIT'});
 await cache.put(identity,{kind:'openapi-operations',value:{operations:[{key:'GET /items',method:'GET',path:'/items',pointer:'/paths/~1items/get'}]}});
 expect(await cache.get(identity,'openapi-operations')).toMatchObject({status:'HIT'});
 await expect(cache.put(identity,{kind:'configuration',value:{...config,unexpected:true}})).rejects.toThrow();
}));
