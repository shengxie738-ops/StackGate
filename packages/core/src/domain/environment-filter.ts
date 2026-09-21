const systemNames=['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','COMSPEC','PATHEXT'];
/** Values stay in memory; callers expose names only in previews and logs. */
export function filterEnvironment(source:Readonly<Record<string,string|undefined>>,allowlist:readonly string[],platform:string):Record<string,string>{
 const normalize=(key:string)=>platform==='win32'?key.toUpperCase():key;
 const approved=new Set([...systemNames,...allowlist].map(normalize));
 const result:Record<string,string>={};
 for(const [key,value]of Object.entries(source)){
  if(value===undefined)continue;
  const canonical=normalize(key);if(!approved.has(canonical))continue;
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||value.includes('\0'))throw new Error('Invalid environment entry');
  if(Object.hasOwn(result,canonical)&&result[canonical]!==value)throw new Error('Ambiguous environment key');
  result[canonical]=value;
 }
 return result;
}
