import { matchesPath, validatePathPattern } from './path-pattern.js';
export interface PolicyLayer {
  source:string;required_set?:readonly string[];allowed_origins?:readonly string[];allowed_paths?:readonly string[];protected_inputs?:readonly string[];
  minimum_provenance?:'DECLARED'|'OBSERVED'|'CONTROLLED';
}
/** Effective constraints retain an AND of source-level OR predicates; never flatten globs into permissions. */
export interface MergedPolicy {
  required_set:string[];allowed_origins:string[];protected_inputs:string[];minimum_provenance:'DECLARED'|'OBSERVED'|'CONTROLLED';
  path_constraints:{source:string;patterns:string[]}[];sources:Record<string,string[]>;conflicts:{source:string;field:string;reason:string}[];
}
export function mergePolicy(defaults:PolicyLayer,repo?:PolicyLayer,local?:PolicyLayer,ci?:PolicyLayer):MergedPolicy {
  const layers=[defaults,repo,local,ci].filter((layer):layer is PolicyLayer=>layer!==undefined);
  const result:MergedPolicy={required_set:[],allowed_origins:[],protected_inputs:[],minimum_provenance:'DECLARED',path_constraints:[],sources:{},conflicts:[]};
  const levels=['DECLARED','OBSERVED','CONTROLLED'] as const;let origins:string[]|undefined;
  for(const layer of layers){
    for(const field of ['required_set','allowed_origins','allowed_paths','protected_inputs','minimum_provenance'] as const)if(layer[field]!==undefined)(result.sources[field]??=[]).push(layer.source);
    for(const field of ['required_set','protected_inputs'] as const){
      const items=layer[field];if(items===undefined)continue;
      if(result[field].some(id=>!items.includes(id)))result.conflicts.push({source:layer.source,field,reason:'Previously required constraints cannot be removed'});
      result[field]=[...new Set([...result[field],...items])].sort();
    }
    if(layer.allowed_origins!==undefined){
      if(origins&&layer.allowed_origins.some(origin=>!origins!.includes(origin)))result.conflicts.push({source:layer.source,field:'allowed_origins',reason:'Origin permissions cannot be widened'});
      origins=origins?origins.filter(origin=>layer.allowed_origins!.includes(origin)):[...new Set(layer.allowed_origins)];
    }
    if(layer.allowed_paths!==undefined){for(const pattern of layer.allowed_paths)validatePathPattern(pattern);result.path_constraints.push({source:layer.source,patterns:[...layer.allowed_paths]});}
    if(layer.minimum_provenance!==undefined){
      const rank=levels.indexOf(layer.minimum_provenance);if(rank<0)throw new Error('Unknown provenance constraint');
      if(rank<levels.indexOf(result.minimum_provenance))result.conflicts.push({source:layer.source,field:'minimum_provenance',reason:'Provenance cannot be weakened'});
      else result.minimum_provenance=layer.minimum_provenance;
    }
  }
  result.allowed_origins=(origins??[]).sort();return result;
}
export function isPathAllowed(policy:Pick<MergedPolicy,'path_constraints'>,relative:string):boolean {
  return policy.path_constraints.length>0&&policy.path_constraints.every(group=>group.patterns.some(pattern=>matchesPath(pattern,relative)));
}
