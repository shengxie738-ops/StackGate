export function discoverCapabilities(manifests:Readonly<Record<string,unknown>>):string[] {
  const found=new Set<string>();
  const pkg=manifests['package.json'];
  if(pkg&&typeof pkg==='object') {
    const dependencies={...(pkg as {dependencies?:Record<string,unknown>}).dependencies,...(pkg as {devDependencies?:Record<string,unknown>}).devDependencies};
    if(['react','typescript','next','vite'].some(name=>Object.hasOwn(dependencies,name)))found.add('typescript');
    if(['vitest','jest','@playwright/test'].some(name=>Object.hasOwn(dependencies,name)))found.add('tests');
  }
  if(['pyproject.toml','requirements.txt'].some(name=>typeof manifests[name]==='string'&&/\bfastapi\b/i.test(manifests[name] as string)))found.add('fastapi');
  return [...found].sort();
}
