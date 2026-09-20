import type {ContractAssessment} from './contract-service.js';
import {hashBytes} from '../storage/hash.js';
/** Public DTO only. The adapter's raw evidence remains unchanged for evidence storage. */
export function publicContractAssessment(input:ContractAssessment){
  const findings=input.compatibility.findings.map(finding=>{const raw=structuredClone(finding.raw);for(const [key,label]of [['baseSource','baseline.openapi.json'],['revisionSource','target.openapi.json']] as const){const location=raw[key];if(location&&typeof location==='object'&&!Array.isArray(location))raw[key]={...location,file:label};}return {...finding,raw};});
  const evidence=input.compatibility.evidence.map(item=>({command:item.command,exit_code:item.exit_code,signal:item.signal,version:item.version,executable_sha256:item.executable_sha256,base_hash:item.base_hash??null,target_hash:item.target_hash??null,stdout_sha256:hashBytes(Buffer.from(item.stdout)),stderr_sha256:hashBytes(Buffer.from(item.stderr)),stdout_bytes:Buffer.byteLength(item.stdout),stderr_bytes:Buffer.byteLength(item.stderr),interrupted:item.interrupted??null}));
  return {...input,compatibility:{...input.compatibility,findings,evidence}};
}
