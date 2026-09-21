import {mkdir,readFile,lstat,unlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function packageTool({sourceRoot,destinationRoot,relativePath,expectedDigest}){
 if(!/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(relativePath)||relativePath.split('/').some(p=>p==='.'||p==='..'))throw new Error('Invalid package tool path');
 const root=path.resolve(destinationRoot),target=path.resolve(root,relativePath);
 if(!target.startsWith(root+path.sep))throw new Error('Package tool escapes destination');
 await mkdir(root,{recursive:true});
 let current=root;
 for(const component of ['',...relativePath.split('/').slice(0,-1)]){
  if(component)current=path.join(current,component);
  try{await mkdir(current);}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Linked package directory denied');
 }
 try{const stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Unsafe existing packaged tool');}catch(error){if(error.code!=='ENOENT')throw error;}
 let bytes;
 try{bytes=await readFile(path.join(sourceRoot,relativePath));}catch(error){
  if(error.code!=='ENOENT')throw error;
  // This is one validated file inside the installation; never recursively clean dist.
  try{await unlink(target);}catch(removal){if(removal.code!=='ENOENT')throw removal;}
  return 'NOT_INSTALLED';
 }
 if(createHash('sha256').update(bytes).digest('hex')!==expectedDigest)throw new Error('Reviewed tool digest differs');
 await writeFile(target,bytes);return 'PACKAGED';
}
