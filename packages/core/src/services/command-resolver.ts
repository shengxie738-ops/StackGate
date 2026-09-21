import type {ResolvedCommand} from '../ports/runner.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {TrustService} from './trust-service.js';
import {configurationError} from './service-error.js';
import {filterEnvironment} from '../domain/environment-filter.js';
import {inspectPathWithin,resolveWithin} from '../storage/safe-path.js';
import {hashBytes} from '../storage/hash.js';
import {canonicalJson} from '../storage/canonical-json.js';
import {verifyRunWorkspace} from '../../../runner-local/src/workspace.js';
export interface CommandResolutionContext {execution_digest:string;run_id:string;check_id:string;attempt_id:string;output_dir:string;allowed_origins:readonly string[];owner_token:string}
export class CommandResolver {
 constructor(readonly root:string,readonly options:{trustStoreRoot?:string}={}){}
 async resolve(commandId:string,context:CommandResolutionContext):Promise<ResolvedCommand>{
  const service=new TrustService(this.root,this.options.trustStoreRoot?{storeRoot:this.options.trustStoreRoot}:{});
  const review=await service.review();if(!review.already_trusted||review.execution_digest!==context.execution_digest)throw configurationError('Execution requires an unchanged current local trust grant');
  const captured=await service.capture();if(captured.execution_digest!==context.execution_digest)throw configurationError('Inputs changed during command resolution');
  const preview=captured.execution_preview,config=captured.configuration,command=config.commands[commandId],tool=preview.tools[commandId];
  if(!command||!tool?.invocation)throw configurationError('Command identity was not included in reviewed execution');
  if(preview.runner_provenance.status!=='AVAILABLE')throw configurationError('Reviewed process ownership runner is unavailable');
  if(!/^run_[A-Za-z0-9_-]+$/.test(context.run_id)||!/^attempt_[A-Za-z0-9_-]+$/.test(context.attempt_id)||!/^[-A-Za-z0-9_]+$/.test(context.check_id))throw configurationError('Invalid run/check/attempt identity');
  const output=await inspectPathWithin(this.root,`${config.state_dir}/work/${context.run_id}/${context.check_id}/${context.attempt_id}`);
  if(output.links.length||path.resolve(context.output_dir)!==output.path||!(await fs.stat(output.path)).isDirectory())throw configurationError('Command output must be the owned current run/check/attempt directory');
  if(context.allowed_origins.some(origin=>!preview.network_targets.includes(origin)))throw configurationError('Command origin exceeds reviewed permissions');
  const owner=await verifyRunWorkspace(await resolveWithin(this.root,config.state_dir),{run_id:context.run_id,repo_id:preview.repo_id,worktree_id:preview.worktree_id,owner_token:context.owner_token});
  const environment={...filterEnvironment(process.env,config.security.env_allowlist,process.platform),...preview.system_environment};
  Object.assign(environment,{STACKGATE_RUN_ID:context.run_id,STACKGATE_CHECK_ID:context.check_id,STACKGATE_ATTEMPT_ID:context.attempt_id,STACKGATE_OUTPUT_DIR:output.path,STACKGATE_ALLOWED_ORIGINS:JSON.stringify([...context.allowed_origins].sort())});
  const inputs=new Map(tool.invocation.verified_inputs.map(item=>[item.path,item.digest]));
  for(const file of preview.runner_provenance.files)inputs.set(file.path,file.digest);
  inputs.set(owner.path,hashBytes(owner.bytes));
  for(const item of captured.input_manifest.files){if(item.kind!=='file')continue;inputs.set(await resolveWithin(this.root,item.relative_path),item.digest.replace(/^sha256:/,''));}
  const resolved:ResolvedCommand={command_id:commandId,identity:tool.invocation.identity,args:[...tool.invocation.args_prefix,...command.args],cwd:await resolveWithin(this.root,config.workspaces[command.workspace]!.path),environment,timeout_ms:command.timeout_seconds*1000,authorization_hash:context.execution_digest,command_hash:'',verified_inputs:[...inputs].map(([path,digest])=>({path,digest}))};
  resolved.command_hash=hashBytes(Buffer.from(canonicalJson({command_id:resolved.command_id,identity:resolved.identity,args:resolved.args,cwd:resolved.cwd,environment_names:Object.keys(environment).sort(),timeout_ms:resolved.timeout_ms,authorization_hash:resolved.authorization_hash,verified_inputs:resolved.verified_inputs})));
  return resolved;
 }
}
