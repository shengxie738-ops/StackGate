/** Small, declared glob subset. Unsupported syntax is rejected, never broadened. */
export function validatePathPattern(pattern:string):void {
  if(!pattern||pattern.startsWith('/')||/[\\:\x00-\x1f\x7f{}[\]!]/.test(pattern)||pattern.split('/').some(p=>!p||p==='.'||p==='..'||(/[. ]$/.test(p))||(p.includes('**')&&p!=='**')))throw new Error('Unsupported path pattern');
}
export function matchesPath(pattern:string,relative:string):boolean{
  validatePathPattern(pattern);
  if(!relative||/[\\:\x00-\x1f\x7f]/.test(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..'))return false;
  let expression='^';
  const parts=pattern.split('/');
  for(let i=0;i<parts.length;i++){
    const part=parts[i]!;
    if(part==='**'){expression+=i===parts.length-1?'.*':'(?:[^/]+/)*';continue;}
    for(const character of part)expression+=character==='*'?'[^/]*':character==='?'?'[^/]':character.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(i<parts.length-1)expression+='/';
  }
  return new RegExp(expression+'$','u').test(relative);
}
