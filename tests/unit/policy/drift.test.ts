import { describe, expect, it } from 'vitest';
import { detectAcceptanceDrift, type AcceptanceSnapshot } from '../../../packages/core/src/domain/protected-input-drift.js';
const hash=(character:string)=>character.repeat(64);
const baseline=():AcceptanceSnapshot=>({task_id:'checkout',revision:3,protected_inputs:[{relative_path:'tests/checkout.ts',digest:hash('a'),content:'test("checkout", () => expect(total).toBe(20));'}],required_checks:['unit'],required_test_ids:['checkout-total'],checks:{unit:{adapter:'junit',min_tests:3}},target_configuration_hash:hash('b')});
const codes=(current:AcceptanceSnapshot,confirmed=baseline())=>detectAcceptanceDrift(confirmed,current).map(finding=>finding.code);
describe('acceptance input drift',()=>{
  it('detects deleted protected tests and removed stable check/test IDs',()=>{
    const current={...baseline(),protected_inputs:[],required_checks:[],required_test_ids:['renamed-id'],checks:{}};
    expect(codes(current)).toEqual(expect.arrayContaining(['PROTECTED_INPUT_DELETED','REQUIRED_CHECK_MISSING','REQUIRED_TEST_MISSING']));
  });
  it('rejects adapter/result-kind changes and reduced minimum counts',()=>{
    expect(codes({...baseline(),checks:{unit:{adapter:'command',result_kind:'exit-code',min_tests:0}}})).toEqual(expect.arrayContaining(['CHECK_CONTRACT_CHANGED','MIN_TESTS_REDUCED']));
  });
  it('requires review for assertion changes it cannot prove harmless and strictly denies them',()=>{
    const current={...baseline(),protected_inputs:[{relative_path:'tests/checkout.ts',digest:hash('c'),content:'test("checkout", () => expect(total).toBeGreaterThan(0));'}]};
    expect(detectAcceptanceDrift(baseline(),current)).toContainEqual(expect.objectContaining({code:'REVIEW_REQUIRED',category:'REVIEW_REQUIRED',decision:'DENY',reference:'tests/checkout.ts'}));
  });
  it('reports introduced skip/only/mock patterns as observed input changes',()=>{
    for(const [content,code] of [['test.skip("checkout",()=>{});','TEST_SKIP_INTRODUCED'],['test.only("checkout",()=>{});','TEST_ONLY_INTRODUCED'],['page.route("**/api", route => route.fulfill({body:"mock"}));','MOCK_INTRODUCED']]){
      const current={...baseline(),protected_inputs:[{relative_path:'tests/checkout.ts',digest:hash('c'),content:content!}]};
      expect(codes(current)).toContain(code);
    }
  });
  it('approves only exact confirmed revision/path and before/after digests',()=>{
    const before=baseline(),current={...baseline(),protected_inputs:[{relative_path:'tests/checkout.ts',digest:hash('c'),content:'reviewed replacement'}]};
    const approval={task_id:'checkout',revision:3,relative_path:'tests/checkout.ts',before_digest:hash('a'),after_digest:hash('c')};
    expect(codes(current,{...before,approved_changes:[approval]})).not.toContain('REVIEW_REQUIRED');
    for(const changed of [{...approval,revision:2},{...approval,relative_path:'tests/other.ts'},{...approval,after_digest:hash('d')}])expect(codes(current,{...before,approved_changes:[changed]})).toContain('REVIEW_REQUIRED');
    expect(codes({...current,approved_changes:[approval]},before)).toContain('REVIEW_REQUIRED');
  });
  it('denies task identity or target configuration drift',()=>{
    expect(codes({...baseline(),revision:4,target_configuration_hash:hash('d')})).toEqual(expect.arrayContaining(['TASK_IDENTITY_CHANGED','TARGET_CONFIGURATION_CHANGED']));
  });
  it('never infers actual execution from unchanged files or declared test IDs',()=>{
    expect(detectAcceptanceDrift(baseline(),baseline())).toEqual([expect.objectContaining({code:'RUNTIME_NOT_EXECUTED',category:'RUNTIME',decision:'NOT_EXECUTED'})]);
    const current={...baseline(),runtime_inventory:{executed_test_ids:[],complete:true}};
    expect(codes(current)).toContain('REQUIRED_TEST_NOT_EXECUTED');
    expect(codes({...baseline(),runtime_inventory:{executed_test_ids:['checkout-total'],complete:false}})).toContain('RUNTIME_INVENTORY_INCOMPLETE');
  });
});
