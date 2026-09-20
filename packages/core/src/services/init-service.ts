import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveWithin,inspectPathWithin} from '../storage/safe-path.js';
import {ensureDirectoryWithin} from '../storage/task-revisions.js';
import {hashBytes} from '../storage/hash.js';
import {configurationError} from './service-error.js';
import {configNames} from './project-service.js';
export class InitService {
  constructor(readonly root:string,readonly templateRoot=fileURLToPath(new URL(import.meta.url.endsWith('/core.mjs')?'./presets/fastapi-react/':'../../../../presets/fastapi-react/',import.meta.url))){}
  private async writeTarget(relative:string):Promise<string>{
    const inspected=await inspectPathWithin(this.root,relative);
    if(inspected.links.length)throw configurationError('Initialization write target cannot contain links',relative);
    try{const stat=await fs.lstat(inspected.path);if(stat.isSymbolicLink()||stat.nlink>1)throw configurationError('Initialization write target cannot be a symbolic or hard link',relative);if(!stat.isFile())throw configurationError('Initialization write target must be a regular file',relative);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    return inspected.path;
  }
  async preview(){
    const templates=[['.stackgate.yaml','config.template.yaml'],['.stackgate/tasks/example.json','task.template.json']] as const;
    const files: {path:string;content:string;sha256:string;conflict:boolean}[]=[];
    const existingConfigurations:string[]=[];
    for(const name of configNames)try{await fs.lstat(await resolveWithin(this.root,name));existingConfigurations.push(name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    // Preflight every destination before apply creates the first file.
    for(const [relative,template] of templates){const content=await fs.readFile(path.join(this.templateRoot,template),'utf8'),destination=await this.writeTarget(relative);let conflict=relative==='.stackgate.yaml'&&existingConfigurations.length>0;try{await fs.lstat(destination);conflict=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}files.push({path:relative,content,sha256:hashBytes(Buffer.from(content)),conflict});}
    const ignoreDestination=await this.writeTarget('.gitignore');
    let old='';try{old=await fs.readFile(ignoreDestination,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const gitignore_patch=old.split(/\r?\n/).some(line=>line.trim()==='.stackgate/state/')?'':(old&&!old.endsWith('\n')?'\n':'')+'# StackGate local evidence\n.stackgate/state/\n';
    return {files,conflicts:[...new Set([...existingConfigurations,...files.filter(f=>f.conflict&&f.path!=='.stackgate.yaml').map(f=>f.path)])],gitignore_patch,gitignore_before:old,permissions:{writes:[...files.filter(f=>!f.conflict).map(f=>f.path),...(gitignore_patch?['.gitignore']:[])],executes:[],network:[]},runtime:'NOT_EXECUTED' as const};
  }
  async apply(preview:Awaited<ReturnType<InitService['preview']>>){
    const current=await this.preview();if(JSON.stringify(current)!==JSON.stringify(preview))throw configurationError('Initialization inputs changed; review again');
    const written:string[]=[];
    for(const file of preview.files.filter(f=>!f.conflict)){const parent=path.posix.dirname(file.path);if(parent!=='.')await ensureDirectoryWithin(this.root,parent);await fs.writeFile(await this.writeTarget(file.path),file.content,{flag:'wx',mode:0o600});written.push(file.path);}
    // Append a separately displayed ignore patch, preserving every existing byte.
    if(preview.gitignore_patch){const destination=await this.writeTarget('.gitignore');let old='';try{old=await fs.readFile(destination,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(old!==preview.gitignore_before)throw configurationError('Ignore rules changed; patch not applied');await fs.appendFile(destination,preview.gitignore_patch);written.push('.gitignore');}
    return {...preview,written};
  }
}
