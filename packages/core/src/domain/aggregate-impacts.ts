import type { ImpactGraph } from '../../../adapter-typescript/src/impact-graph.js';
export function aggregateImpacts(graphs:readonly ImpactGraph[],changed_operation_keys:readonly string[]=[]):ImpactGraph {
  const result:ImpactGraph={nodes:[],edges:[],known:[],candidate:[],unresolved:[],selected_checks:[],selected_tests:[]};
  const seen=new Map<string,Set<string>>();
  const unique=(field:string,key:string)=>{const keys=seen.get(field)??new Set<string>();seen.set(field,keys);if(keys.has(key))return false;keys.add(key);return true;};
  for(const graph of graphs){
    for(const node of graph.nodes)if(unique('nodes',node.id))result.nodes.push({...node});
    for(const edge of graph.edges)if(unique('edges',JSON.stringify([edge.from,edge.to,edge.origin,edge.confidence])))result.edges.push({...edge});
    for(const field of ['known','candidate'] as const)for(const association of graph[field]){
      const copy={...association,consumer_paths:[...association.consumer_paths],check_ids:[...association.check_ids],test_ids:[...association.test_ids]};
      if(unique(field,JSON.stringify(copy)))result[field].push(copy);
    }
    for(const gap of graph.unresolved)if(unique('unresolved',JSON.stringify([gap.kind,gap.reference,gap.workspace,gap.origin,gap.reason,gap.operation_key])))result.unresolved.push({...gap});
    for(const field of ['selected_checks','selected_tests'] as const)for(const selection of graph[field]){
      const current=result[field].find(item=>item.id===selection.id);
      if(current)current.sources=[...new Set([...current.sources,...selection.sources])].sort();
      else result[field].push({id:selection.id,sources:[...new Set(selection.sources)].sort()});
    }
  }
  for(const operation_key of new Set(changed_operation_keys))if(!result.known.some(association=>association.operation_key===operation_key)){
    const workspaces=[...new Set(result.candidate.filter(association=>association.operation_key===operation_key).map(association=>association.workspace))];
    result.unresolved.push({kind:'operation',reference:operation_key,operation_key,workspace:workspaces.length===1?workspaces[0]!:'*',origin:'changed-operation',reason:'Changed operation has no complete explicit or generated consumer mapping'});
  }
  for(const field of ['selected_checks','selected_tests'] as const)result[field].sort((a,b)=>a.id.localeCompare(b.id));
  return result;
}
