export interface BehaviorProjection {operations:Record<string,unknown>;root:Record<string,unknown>}
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const methods=new Set(['get','put','post','delete','options','head','patch','trace']);
const metadata=new Set(['title','description','summary','externalDocs','tags']);
const dictionaries=new Set(['properties','responses','content','headers','securitySchemes','schemas','examples','encoding']);
function stable(value:unknown):string {return JSON.stringify(value);}
/** Call only after capability checks. All behavioral keys survive; only declared prose is stripped. */
export function projectContractBehavior(document:Record<string,unknown>):BehaviorProjection {
  let visited=0;
  function project(value:unknown,dictionary=false,key='',depth=0):unknown {
    if(++visited>50000||depth>128)throw new Error('Contract projection bound exceeded');
    if(Array.isArray(value)) {const result=value.map(item=>project(item,key==='security',key,depth+1));if(['required','enum','anyOf','security'].includes(key))result.sort((a,b)=>stable(a)<stable(b)?-1:stable(a)>stable(b)?1:0);return result;}
    if(!record(value))return value;
    const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
    for(const name of Object.keys(value).sort()) {
      if(!dictionary&&metadata.has(name))continue;
      if(!dictionary&&name==='$ref') {
        const ref=value[name];if(typeof ref!=='string'||!ref.startsWith('#/'))throw new Error('Unsupported reference during projection');
        let resolved:unknown=document;
        for(const token of decodeURIComponent(ref.slice(2)).split('/').map(part=>part.replaceAll('~1','/').replaceAll('~0','~'))) {if(!record(resolved)||!Object.hasOwn(resolved,token))throw new Error('Unresolved reference during projection');resolved=resolved[token];}
        // Preserve reference sibling intersection rather than overwriting either constraint.
        result.$ref=project(resolved,false,'',depth+1);continue;
      }
      result[name]=project(value[name],dictionary?false:dictionaries.has(name),name,depth+1);
    }
    return result;
  }
  const operations:Record<string,unknown>={};
  if(!record(document.paths))throw new Error('Missing contract paths');
  for(const route of Object.keys(document.paths).sort()) {
    const item=document.paths[route];if(!record(item)||route.startsWith('x-'))continue;
    for(const method of Object.keys(item).sort())if(methods.has(method)) {
      const inherited=Object.fromEntries(Object.entries(item).filter(([name])=>!methods.has(name)));
      operations[`${method.toUpperCase()} ${route}`]=project({operation:item[method],inherited});
    }
  }
  const components=record(document.components)?document.components:{};
  const rootFields=Object.fromEntries(Object.entries(document).filter(([name])=>!['paths','components','info','openapi'].includes(name)));
  return {operations,root:project({...rootFields,security:document.security??[],servers:document.servers??[],securitySchemes:components.securitySchemes??{}}) as Record<string,unknown>};
}
export function compareContractBehavior(target:Record<string,unknown>,candidate:Record<string,unknown>):{aligned:boolean;changed_operations:string[]} {
  const before=projectContractBehavior(target),after=projectContractBehavior(candidate);
  const rootChanged=stable(before.root)!==stable(after.root);
  const changed_operations=[...new Set([...Object.keys(before.operations),...Object.keys(after.operations)])].sort().filter(key=>rootChanged||stable(before.operations[key])!==stable(after.operations[key]));
  return {aligned:!rootChanged&&changed_operations.length===0,changed_operations};
}
