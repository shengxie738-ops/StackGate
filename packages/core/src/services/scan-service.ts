import fs from 'node:fs/promises';
import path from 'node:path';
import type {TaskPayload,Diagnostic} from '../../../contracts/src/index.js';
import {validateSchema} from '../../../contracts/src/index.js';
import {resolveBaseline} from '../../../adapter-git/src/baseline.js';
import {gitCommand} from '../../../adapter-git/src/git-command.js';
import {captureInputs} from '../../../adapter-git/src/input-manifest.js';
import {loadContract} from '../../../adapter-oasdiff/src/load-contract.js';
import {RegisteredOasdiffAdapter} from '../../../adapter-oasdiff/src/resolve-tool.js';
import {loadMappings} from '../../../adapter-typescript/src/explicit-mappings.js';
import {emptyImpactGraph} from '../../../adapter-typescript/src/impact-graph.js';
import {analyzeTypeScript,type TypeScriptSource} from '../../../adapter-typescript/src/program.js';
import {aggregateImpacts} from '../domain/aggregate-impacts.js';
import {selectChecks} from '../domain/select-checks.js';
import {detectAcceptanceDrift,type AcceptanceSnapshot,type DriftFinding} from '../domain/protected-input-drift.js';
import {matchesPath} from '../domain/path-pattern.js';
import {resolveWithin} from '../storage/safe-path.js';
import {hashBytes} from '../storage/hash.js';
import {canonicalJson} from '../storage/canonical-json.js';
import {loadConfiguration} from './config-service.js';
import {configNames} from './project-service.js';
import {parseStrictDocument} from './strict-document.js';
import {configurationError,ServiceError} from './service-error.js';
import {ContractService,type ContractCompatibilityTool} from './contract-service.js';
import {TaskService,protectedPrefix} from './task-service.js';
import {publicContractAssessment} from './public-scan-report.js';
import {selectionPolicyFor} from './selection-policy.js';
const digest=(value:unknown)=>hashBytes(Buffer.from(canonicalJson(value)));
export interface ScanOptions {base?:string;task?:string;profile?:string}
export class ScanService {
  constructor(readonly root:string,readonly adapter:ContractCompatibilityTool=new RegisteredOasdiffAdapter()){}
  async scan(options:ScanOptions={}){
    const diagnostics:Diagnostic[]=[];const names:string[]=[];
    for(const name of configNames)try{await fs.access(await resolveWithin(this.root,name));names.push(name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(names.length!==1)throw configurationError('Exactly one project configuration required');
    const config=await loadConfiguration(path.join(this.root,names[0]!),this.root),{profile,selection_policy,policy_hash}=selectionPolicyFor(config,options.profile??Object.keys(config.profiles)[0]!);
    let task:TaskPayload|null=null,confirmed:Awaited<ReturnType<TaskService['loadConfirmed']>>|null=null;
    if(options.task){const relative=path.relative(path.resolve(this.root),path.resolve(this.root,options.task)).replaceAll(path.sep,'/');const result=validateSchema<TaskPayload>('task',parseStrictDocument(await fs.readFile(await resolveWithin(this.root,relative)),relative));if(!result.ok)throw new ServiceError(64,result.diagnostics);task=result.value;
      try{confirmed=await new TaskService(this.root).loadConfirmed(task.task_id,task.revision);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')diagnostics.push(...(error instanceof ServiceError?error.diagnostics:configurationError('Confirmation cannot be safely loaded').diagnostics));}
    }
    let baseline;try{baseline=await resolveBaseline({project_root:this.root,target_ref:options.base??'HEAD'});}catch{return {runtime:'NOT_EXECUTED',candidate_export:'NOT_EXECUTED',baseline:null,input_manifest:null,contracts:[],selection:{required_set:[...new Set([...(task?.required_checks??[]),...profile.required_checks])]},coverage_gaps:[{code:'BASELINE_MISSING',reason:'Requested baseline unavailable locally; no fetch or export was attempted'}],diagnostics};}
    const mappingsFile='.stackgate/mappings.json';let mappingsBytes:Buffer|null=null;try{mappingsBytes=await fs.readFile(await resolveWithin(this.root,mappingsFile));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const input_manifest=await captureInputs({project_id:config.project_id,repo_root:this.root,configuration_hash:digest(config),workspaces:config.workspaces,contracts:config.contracts},baseline,{exclusions:[{relative_path:config.state_dir,reason:'Local StackGate evidence state'}],include_ignored:[...new Set([...Object.values(config.contracts).map(c=>c.target_file),...config.security.protected_inputs.map(protectedPrefix),...(mappingsBytes?[mappingsFile]:[])])]});
    let acceptance_drift:DriftFinding[]=[{code:'TASK_UNCONFIRMED',reference:task?.task_id??'',category:'REVIEW_REQUIRED',decision:'DENY',message:'No matching sealed task revision is available'}];
    if(confirmed&&task){
      const sealed=confirmed.protected_inputs as {patterns?:string[];files?:AcceptanceSnapshot['protected_inputs'];check_contracts?:AcceptanceSnapshot['checks']};
      if(Array.isArray(sealed.patterns)&&Array.isArray(sealed.files)&&sealed.check_contracts){
        const previous:AcceptanceSnapshot={task_id:confirmed.task.task_id,revision:confirmed.task.revision,protected_inputs:sealed.files,required_checks:confirmed.task.required_checks,required_test_ids:confirmed.task.required_test_ids,checks:sealed.check_contracts,target_configuration_hash:confirmed.preview.configuration_hash};
        const patterns=[...new Set([...sealed.patterns,...config.security.protected_inputs])];
        const current:AcceptanceSnapshot={task_id:task.task_id,revision:task.revision,protected_inputs:input_manifest.files.filter(f=>patterns.some(p=>matchesPath(p,f.relative_path))).map(f=>({relative_path:f.relative_path,digest:f.digest})),required_checks:task.required_checks,required_test_ids:task.required_test_ids,checks:config.checks,target_configuration_hash:digest(config)};
        acceptance_drift=detectAcceptanceDrift(previous,current);
      }else acceptance_drift=[{code:'CONFIRMATION_INCOMPLETE',reference:task.task_id,category:'REVIEW_REQUIRED',decision:'DENY',message:'Sealed acceptance snapshot lacks the original check contracts'}];
    }
    const contracts:({service_id:string}&ReturnType<typeof publicContractAssessment>)[]=[],operation_keys:string[]=[],changed_operations:string[]=[];
    for(const [service_id,entry] of Object.entries(config.contracts)){
      let bytes:Buffer;try{bytes=await gitCommand(this.root,['show',baseline.base_oid+':'+entry.baseline_file]);}catch{diagnostics.push(...configurationError('Baseline contract unavailable: '+entry.baseline_file).diagnostics);continue;}
      const targetBytes=await fs.readFile(await resolveWithin(this.root,entry.target_file));
      const before=loadContract(bytes,entry.baseline_file+'@baseline'),target=loadContract(targetBytes,entry.target_file);
      for(const operation of target.operations)operation_keys.push(service_id+':'+operation.key);
      if(before.raw_hash!==target.raw_hash)changed_operations.push(...new Set([...before.operations,...target.operations].map(o=>service_id+':'+o.key)));
      const assessment=await new ContractService(this.adapter).compareThreeWay({baseline:before,target,candidate:null,task:task?{payload:task,confirmation:confirmed?.confirmation??null}:null,policy:{service_id,require_confirmation:true}});
      contracts.push({service_id,...publicContractAssessment(assessment)});
      const captured=input_manifest.files.find(f=>f.relative_path===entry.target_file);if(!captured||captured.digest!==hashBytes(targetBytes))diagnostics.push(...configurationError('Target changed during static capture: '+entry.target_file).diagnostics);
    }
    const inventory={operation_keys,paths:input_manifest.files.filter(f=>f.kind!=='deleted').map(f=>f.relative_path),check_ids:Object.keys(config.checks),test_ids:task?.required_test_ids??[],workspaces:Object.keys(config.workspaces)};
    const explicit=mappingsBytes?loadMappings(parseStrictDocument(mappingsBytes,mappingsFile),inventory):emptyImpactGraph();
    const sources:TypeScriptSource[]=[];
    for(const file of input_manifest.files){
      const workspace=Object.entries(config.workspaces).find(([,w])=>file.relative_path.startsWith(w.path+'/'))?.[0];if(!workspace)continue;
      if(file.kind!=='file'||! /\.(?:[cm]?ts|tsx)$/.test(file.relative_path)){explicit.unresolved.push({kind:'scope',workspace,reference:file.relative_path,origin:'input-manifest',reason:'Workspace input is deleted, linked, or outside the supported static TypeScript source subset'});continue;}
      const bytes=await fs.readFile(await resolveWithin(this.root,file.relative_path));if(hashBytes(bytes)!==file.digest){explicit.unresolved.push({kind:'scope',workspace,reference:file.relative_path,origin:'input-manifest',reason:'Source changed during scan'});continue;}sources.push({path:file.relative_path,workspace,content:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});
    }
    const staticGraph=analyzeTypeScript({files:sources,operation_keys,changed_paths:[...input_manifest.staged_changes,...input_manifest.unstaged_changes,...input_manifest.files.filter(f=>!f.tracked).map(f=>f.relative_path)]});
    const impacts=aggregateImpacts([explicit,staticGraph],changed_operations);
    if(!mappingsBytes)impacts.unresolved.push({kind:'scope',reference:mappingsFile,workspace:'*',origin:'scan',reason:'No explicit consumer mapping; static parsing cannot prove complete coverage'});
    const selection=selectChecks(task??{required_checks:[],required_test_ids:[]},selection_policy,impacts,Object.keys(config.checks));
    return {runtime:'NOT_EXECUTED',candidate_export:'NOT_EXECUTED',baseline,input_manifest,contracts,impacts,selection,policy_hash,acceptance_drift,coverage_gaps:[...selection.coverage_gaps,...acceptance_drift.filter(f=>f.decision==='DENY').map(f=>({code:f.code,reason:f.message,reference:f.reference})),...input_manifest.diagnostics.map(reason=>({code:'INPUT_SCOPE_INCOMPLETE',reason})),{code:'RUNTIME_NOT_EXECUTED',reason:'Candidate export, runtime probes and test inventories require a later authorized run'}],diagnostics};
  }
}
