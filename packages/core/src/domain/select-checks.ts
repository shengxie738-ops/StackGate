import type { ImpactGraph, ImpactGap, ImpactSelection } from '../../../adapter-typescript/src/impact-graph.js';
export interface SelectionTask { required_checks: readonly string[]; required_test_ids: readonly string[] }
export interface SelectionPolicy { required_set: readonly string[]; workspace_regression?: Readonly<Record<string, readonly string[]>>; optional_failure_policy: 'fail' | 'incomplete' }
export interface CoverageGap { workspace: string; reference: string; reason: string; origin: string }
export interface SelectionResult {
  required_set: string[]; selected_checks: ImpactSelection[]; selected_tests: ImpactSelection[];
  analysis_gaps: ImpactGap[]; coverage_gaps: CoverageGap[]; status: 'READY' | 'INCOMPLETE';
  optional_failure_policy: 'fail' | 'incomplete';
}
/** workspace_regression must come from the caller's confirmed configuration, not inferred AST coverage. */
export function selectChecks(task:SelectionTask,policy:SelectionPolicy,impacts:ImpactGraph,configured_checks:readonly string[]):SelectionResult {
  if(!['fail','incomplete'].includes(policy.optional_failure_policy))throw new Error('Optional failure policy must be fixed before selection');
  const checks=new Map<string,Set<string>>(),tests=new Map<string,Set<string>>();
  const coverage_gaps:CoverageGap[]=[];
  const add=(map:Map<string,Set<string>>,id:string,source:string)=>{const sources=map.get(id)??new Set<string>();sources.add(source);map.set(id,sources);};
  for(const id of task.required_checks)add(checks,id,'task');
  for(const id of policy.required_set)add(checks,id,'policy');
  for(const id of task.required_test_ids)add(tests,id,'task');
  for(const item of impacts.selected_checks)for(const source of item.sources)add(checks,item.id,source);
  for(const item of impacts.selected_tests)for(const source of item.sources)add(tests,item.id,source);
  for(const association of [...impacts.known,...impacts.candidate]){
    for(const id of association.check_ids)add(checks,id,association.operation_key);
    for(const id of association.test_ids)add(tests,id,association.operation_key);
  }
  for(const gap of impacts.unresolved){
    const workspaces=gap.workspace==='*'?Object.keys(policy.workspace_regression??{}):[gap.workspace];
    if(!workspaces.length)coverage_gaps.push({workspace:gap.workspace,reference:gap.reference,origin:gap.origin,reason:'No confirmed workspace regression set'});
    for(const workspace of workspaces){
      const regression=policy.workspace_regression?.[workspace];
      if(!regression?.length)coverage_gaps.push({workspace,reference:gap.reference,origin:gap.origin,reason:'No confirmed workspace regression set'});
      else for(const id of regression)add(checks,id,'workspace-regression:'+workspace);
    }
    if(gap.kind==='test'||gap.kind==='check')coverage_gaps.push({workspace:gap.workspace,reference:gap.reference,origin:gap.origin,reason:'Mapped required reference is missing'});
  }
  for(const [id,sources] of checks)if(!configured_checks.includes(id))coverage_gaps.push({workspace:'*',reference:id,origin:[...sources].sort().join(','),reason:'Selected check is not configured'});
  const selected=(map:Map<string,Set<string>>):ImpactSelection[]=>[...map].sort(([a],[b])=>a.localeCompare(b)).map(([id,sources])=>({id,sources:[...sources].sort()}));
  const selected_checks=selected(checks);
  return {required_set:selected_checks.map(item=>item.id),selected_checks,selected_tests:selected(tests),analysis_gaps:impacts.unresolved.map(gap=>({...gap})),coverage_gaps,status:coverage_gaps.length?'INCOMPLETE':'READY',optional_failure_policy:policy.optional_failure_policy};
}
