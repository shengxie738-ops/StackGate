export type PayloadDirection='request'|'response';
import { isRecord,resolveFragment } from './inspect-refs.js';
/** Builds owned schemas; annotations alter required membership only, never payload values. */
export function projectDirection(schema:Record<string,unknown>,document:Record<string,unknown>,direction:PayloadDirection):Record<string,unknown>{
  let visits=0;
  const excluded=direction==='request'?'readOnly':'writeOnly';
  function annotated(value:unknown,depth=0):boolean {
    if(depth>128||!isRecord(value))throw new Error('Invalid directional property');
    if(value[excluded]===true)return true;
    if(value.$ref!==undefined){const ref=resolveFragment(document,value.$ref);if(!ref)throw new Error('Unresolved directional reference');return annotated(ref.value,depth+1);}
    return false;
  }
  function project(value:unknown,depth:number):Record<string,unknown>{
    if(++visits>50000||depth>128||!isRecord(value))throw new Error('Directional schema traversal exceeded supported bounds');
    const entries:[string,unknown][]=[];
    for(const [key,child]of Object.entries(value)){
      if(['$ref','readOnly','writeOnly'].includes(key))continue;
      if(key==='properties') {if(!isRecord(child))throw new Error('Invalid properties');entries.push([key,Object.fromEntries(Object.entries(child).map(([name,property])=>[name,project(property,depth+1)]))]);}
      else if(key==='items')entries.push([key,project(child,depth+1)]);
      else if(key==='anyOf'){if(!Array.isArray(child))throw new Error('Invalid union');entries.push([key,child.map(branch=>project(branch,depth+1))]);}
      else if(key==='required'){if(!Array.isArray(child)||!isRecord(value.properties))throw new Error('Invalid required declaration');const properties=value.properties;entries.push([key,child.filter(name=>typeof name==='string'&&!annotated(properties[name]))]);}
      else entries.push([key,child]);
    }
    const own=Object.fromEntries(entries);
    if(value.$ref===undefined)return own;
    const resolved=resolveFragment(document,value.$ref);if(!resolved)throw new Error('Unresolved directional reference');
    const referenced=project(resolved.value,depth+1);
    return entries.length?{allOf:[referenced,own]}:referenced;
  }
  return project(schema,0);
}
