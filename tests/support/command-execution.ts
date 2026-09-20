import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Artifact,CheckStep,RunManifest} from '../../packages/contracts/src/index.js';
import type {ExecutionContext,CollectionContext} from '../../packages/core/src/ports/adapter.js';
import {FileEvidenceStore} from '../../packages/core/src/storage/file-evidence-store.js';
import {BudgetedArtifactWriter,EvidenceBudget} from '../../packages/core/src/evidence/budget.js';
import {hashBytes} from '../../packages/core/src/storage/hash.js';
import {LocalRunner} from '../../packages/runner-local/src/local-runner.js';
export const commandStep:CheckStep={step_id:'step_build',check_id:'build',adapter_id:'command',command_id:'build',depends_on:[],required:true,timeout_ms:10000,resource_locks:[],expected_artifacts:[],expected_test_ids:[],min_tests:null,parameters:{adapter_id:'command',result_kind:'exit-code'}};
/** Real process and storage harness. The narrowly authorized command closure exists only in tests. */
export async function commandExecution(root:string,code:string,options:{signal?:AbortSignal;timeout?:number;missingExecutable?:boolean;invalidExecutable?:boolean;maxOutputBytes?:number;onOutput?:(text:string)=>void}={}){
 const state=path.join(root,'state');await fs.mkdir(state);const script=path.join(root,'business.cjs');await fs.writeFile(script,code);
 const sample=JSON.parse(await fs.readFile('tests/fixtures/protocols/run.json','utf8')) as RunManifest;
 const manifest:RunManifest={...sample,phase:'CREATED',verdict:'INCOMPLETE',checks:[],artifact_refs:[],started_at:null,finished_at:null,environment_ref:null};
 const store=new FileEvidenceStore({stateRoot:state,owner:{repo_id:sample.repo_id,worktree_id:sample.worktree_id}});await store.createRun(manifest);
 const scope={run_id:sample.run_id,check_id:'build',attempt_id:'attempt_first'},artifacts:Artifact[]=[];
 const writer=new BudgetedArtifactWriter(store,scope,new EvidenceBudget());
 let executable=process.execPath;if(options.invalidExecutable){executable=path.join(root,'invalid.exe');await fs.writeFile(executable,'not a native executable');}
 const runner=new LocalRunner(options.maxOutputBytes===undefined?{}:{max_output_bytes:options.maxOutputBytes}),output={stdout:'',stderr:''};
 const context:ExecutionContext={...scope,allowed_paths:[root],allowed_origins:[],environment:{STACKGATE_OUTPUT_DIR:root},signal:options.signal??new AbortController().signal,
  commands:{async run(command_id){if(command_id!=='build')throw Error('Unreviewed command');return runner.run({command_id,identity:{executable:options.missingExecutable?path.join(root,'missing.exe'):executable,version:process.version.slice(1),digest:hashBytes(await fs.readFile(executable))},args:[script],cwd:root,environment:{SystemRoot:process.env.SystemRoot??'',TEMP:root,TMP:root,STACKGATE_OUTPUT_DIR:root},timeout_ms:options.timeout??10000,authorization_hash:'a'.repeat(64),command_hash:'b'.repeat(64),verified_inputs:[{path:script,digest:hashBytes(await fs.readFile(script))}]},{...scope,signal:context.signal,async stdout(chunk){const text=Buffer.from(chunk).toString();output.stdout+=text;options.onOutput?.(text);},async stderr(chunk){output.stderr+=Buffer.from(chunk).toString();}});}},
  log:{async append(stream,text){if(stream==='stdout'||stream==='stderr')output[stream]+=text;}},
  artifacts:{async store(input){const artifact=await writer.store(input);artifacts.push(artifact);return artifact;}},clock:{now:()=>new Date().toISOString()},ids:{create:kind=>`${kind}_${randomUUID()}`},
 };
 const collection:CollectionContext={...scope,expected_artifacts:[],evidence:store,signal:context.signal};
 return {context,collection,artifacts,store,output,root};
}
