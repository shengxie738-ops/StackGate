import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectConfig } from '../../../contracts/src/validation.js';
import type { ProjectConfig } from '../../../contracts/src/index.js';
import { parseStrictDocument } from './strict-document.js';
import { ServiceError, configurationError } from './service-error.js';
import { resolveReferences } from '../domain/resolve-references.js';
import { resolveWithin } from '../storage/safe-path.js';
export function parseConfiguration(bytes:Uint8Array,source:string):ProjectConfig {
  const result=validateProjectConfig(parseStrictDocument(bytes,source));
  if(!result.ok)throw new ServiceError(64,result.diagnostics);
  const issues=resolveReferences(result.value);
  if(issues.length)throw new ServiceError(64,issues.flatMap(issue=>configurationError(issue.message,issue.location,source).diagnostics));
  return result.value;
}
export async function loadConfiguration(file:string,root=path.dirname(path.resolve(file))):Promise<ProjectConfig>{
  const resolved=await resolveWithin(root,path.relative(root,path.resolve(file)));
  const stat=await fs.stat(resolved);if(!stat.isFile()||stat.size>1048576)throw configurationError('Configuration size/type unsupported',path.basename(file));
  return parseConfiguration(await fs.readFile(resolved),path.basename(file));
}
