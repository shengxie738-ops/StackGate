import { expect, it } from 'vitest';
import { mergePolicy, isPathAllowed } from '../../../packages/core/src/domain/merge-policy.js';
const defaults={source:'defaults',required_set:['contract'],allowed_origins:['http://127.0.0.1:8000'],allowed_paths:['apps/**'],protected_inputs:['contracts/**'],minimum_provenance:'DECLARED'} as const;
it('unions required/protected sets, intersects origins and raises provenance with source attribution',()=>{
  const result=mergePolicy(defaults,{source:'repo',required_set:[],allowed_origins:['http://127.0.0.1:8000','https://production.example'],allowed_paths:['**/*.ts'],minimum_provenance:'DECLARED'},undefined,{source:'trusted-ci',required_set:['e2e'],protected_inputs:['tests/**'],minimum_provenance:'CONTROLLED'});
  expect(result.required_set).toEqual(['contract','e2e']);expect(result.allowed_origins).toEqual(['http://127.0.0.1:8000']);expect(result.minimum_provenance).toBe('CONTROLLED');
  expect(result.sources.required_set).toEqual(['defaults','repo','trusted-ci']);expect(result.conflicts.some(c=>c.field==='required_set'&&c.source==='repo')).toBe(true);
  expect(isPathAllowed(result,'apps/web/main.ts')).toBe(true);expect(isPathAllowed(result,'apps/web/main.js')).toBe(false);expect(isPathAllowed(result,'other/main.ts')).toBe(false);
});
it('empty permissions deny everything and missing permission sources do not widen constraints',()=>{
  const denied=mergePolicy(defaults,{source:'repo',allowed_paths:[],allowed_origins:[]});expect(isPathAllowed(denied,'apps/a.ts')).toBe(false);expect(denied.allowed_origins).toEqual([]);
  const inherited=mergePolicy(defaults,{source:'repo',required_set:['unit']});expect(isPathAllowed(inherited,'apps/a.ts')).toBe(true);
  expect(isPathAllowed(inherited,'apps/../outside')).toBe(false);
});
it('rejects unsupported glob syntax rather than interpreting it permissively',()=>{
  expect(()=>mergePolicy(defaults,{source:'repo',allowed_paths:['apps/{a,b}/**']})).toThrow();
});
