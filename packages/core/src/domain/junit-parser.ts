import {SaxesParser} from 'saxes';
export interface JunitCase {id:string|null;name:string;classname:string;status:'PASS'|'FAIL'|'SKIPPED';flaky:boolean}
export type JunitParseResult={ok:true;cases:JunitCase[]}|{ok:false;reason:string};
export const JUNIT_MAX_BYTES=8*1024*1024;
/** Pure bounded XML parser. Suite summary attributes never determine test inventory. */
export function parseJunit(bytes:Uint8Array):JunitParseResult{
 try{
  if(bytes.length>JUNIT_MAX_BYTES)throw Error();
  const xml=new TextDecoder('utf8',{fatal:true}).decode(bytes),parser=new SaxesParser({xmlns:false});
  const stack:string[]=[],cases:JunitCase[]=[],identities=new Set<string>(),ids=new Set<string>();let current:JunitCase|null=null,nodes=0;
  const allowed:Record<string,readonly string[]>={'':['testsuite','testsuites'],testsuites:['testsuite'],testsuite:['testsuite','testcase','properties','system-out','system-err'],testcase:['failure','error','skipped','properties','system-out','system-err','flakyFailure','flakyError','rerunFailure','rerunError'],properties:['property']};
  parser.on('error',()=>{throw Error();});parser.on('doctype',()=>{throw Error();});parser.on('processinginstruction',()=>{throw Error();});
  parser.on('xmldecl',declaration=>{if(declaration.encoding&&!/^utf-8$/i.test(declaration.encoding))throw Error();});
  parser.on('opentag',tag=>{
   if(++nodes>100000||stack.length>=32||!(allowed[stack.at(-1)??'']??[]).includes(tag.name))throw Error();
   if(tag.name==='testcase'){
    const name=tag.attributes.name,classname=tag.attributes.classname??'',id=tag.attributes.id??null;
    if(typeof name!=='string'||!name.length||name.length>4096||typeof classname!=='string'||classname.length>4096||id!==null&&(typeof id!=='string'||!id.length||id.length>4096))throw Error();
    const identity=JSON.stringify([classname,name]);if(identities.has(identity)||id!==null&&ids.has(id))throw Error();identities.add(identity);if(id!==null)ids.add(id);
    current={name,classname,id,status:'PASS',flaky:false};cases.push(current);if(cases.length>50000)throw Error();
   }else if(current&&tag.name==='property'&&tag.attributes.name==='stackgate-id'){
    const value=tag.attributes.value;if(typeof value!=='string'||!value.length||value.length>4096||current.id!==null&&current.id!==value)throw Error();
    if(current.id===null){if(ids.has(value))throw Error();ids.add(value);current.id=value;}
   }else if(current&&['failure','error','skipped'].includes(tag.name)){
    const status=tag.name==='skipped'?'SKIPPED':'FAIL';if(current.status!=='PASS'&&current.status!==status)throw Error();current.status=status;
   }else if(current&&['flakyFailure','flakyError','rerunFailure','rerunError'].includes(tag.name))current.flaky=true;
   stack.push(tag.name);
  });
  parser.on('closetag',tag=>{stack.pop();if(tag.name==='testcase')current=null;});
  const content=(text:string)=>{if(text.trim()&&!['failure','error','skipped','system-out','system-err','property','flakyFailure','flakyError','rerunFailure','rerunError'].includes(stack.at(-1)??''))throw Error();};parser.on('text',content);parser.on('cdata',content);
  parser.write(xml).close();return {ok:true,cases};
 }catch{return {ok:false,reason:'REPORT_INVALID'};}
}
