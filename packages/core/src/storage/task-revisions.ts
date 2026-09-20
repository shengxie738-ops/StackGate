import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectPathWithin } from './safe-path.js';
import { configurationError } from '../services/service-error.js';
/** Create only explicitly authorized state directories, rejecting links at every component. */
export async function ensureDirectoryWithin(root:string,relative:string):Promise<string>{
  const parts=relative.split('/');let prefix='';
  for(const part of parts){prefix=prefix?prefix+'/'+part:part;const inspected=await inspectPathWithin(root,prefix);if(inspected.links.length)throw configurationError('State directory cannot contain links',prefix);
    try{await fs.mkdir(inspected.path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const checked=await inspectPathWithin(root,prefix);if(checked.links.length||!(await fs.lstat(checked.path)).isDirectory())throw configurationError('State path is not a real directory',prefix);
  }
  return path.join(root,...parts);
}
