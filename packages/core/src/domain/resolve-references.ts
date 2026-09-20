import type { ProjectConfig } from '../../../contracts/src/index.js';
export interface ReferenceIssue {location:string;message:string}
export function resolveReferences(config:ProjectConfig):ReferenceIssue[]{
  const issues:ReferenceIssue[]=[];
  const requireRef=(collection:object,id:string,location:string)=>{if(!Object.hasOwn(collection,id))issues.push({location,message:'Unknown reference: '+id});};
  for(const[id,command]of Object.entries(config.commands))requireRef(config.workspaces,command.workspace,`/commands/${id}/workspace`);
  for(const[id,check]of Object.entries(config.checks)){
    if(check.adapter==='openapi'){requireRef(config.contracts,check.service,`/checks/${id}/service`);requireRef(config.commands,check.candidate_command,`/checks/${id}/candidate_command`);}
    else requireRef(config.commands,check.command,`/checks/${id}/command`);
  }
  for(const[id,profile]of Object.entries(config.profiles)){
    if(profile.environment!==null)requireRef(config.environments,profile.environment,`/profiles/${id}/environment`);
    else {
      if(profile.minimum_provenance!=='DECLARED')issues.push({location:`/profiles/${id}/minimum_provenance`,message:'A local profile cannot claim external environment provenance'});
      const selected=[...profile.required_checks,...Object.values(profile.workspace_regression??{}).flat()];
      for(const check of selected)if(config.checks[check]&&!['command','junit'].includes(config.checks[check]!.adapter))issues.push({location:`/profiles/${id}/environment`,message:'A local profile supports only command and JUnit checks'});
    }
    for(const check of profile.required_checks)requireRef(config.checks,check,`/profiles/${id}/required_checks`);
    for(const [workspace,checks] of Object.entries(profile.workspace_regression??{})){
      requireRef(config.workspaces,workspace,`/profiles/${id}/workspace_regression/${workspace}`);
      for(const check of checks)requireRef(config.checks,check,`/profiles/${id}/workspace_regression/${workspace}`);
    }
  }
  const extension=config.extensions?.stackgate_v0_1 as Record<string,unknown>|undefined;
  const deps=extension?.check_dependencies;
  if(deps!==undefined){
    if(!deps||typeof deps!=='object'||Array.isArray(deps))issues.push({location:'/extensions/stackgate_v0_1/check_dependencies',message:'Expected a check dependency map'});
    else{
      const graph=deps as Record<string,unknown>,active=new Set<string>(),visited=new Set<string>();
      const visit=(id:string)=>{
        if(active.has(id)){issues.push({location:`/checks/${id}`,message:'Cyclic check dependency'});return;}if(visited.has(id))return;
        requireRef(config.checks,id,`/checks/${id}`);active.add(id);
        const children=graph[id];
        if(children!==undefined&&(!Array.isArray(children)||children.some(child=>typeof child!=='string')))issues.push({location:`/checks/${id}`,message:'Expected dependency IDs'});
        else for(const child of children as string[]??[])visit(child);
        active.delete(id);visited.add(id);
      };
      for(const id of Object.keys(graph))visit(id);
    }
  }
  return issues;
}
