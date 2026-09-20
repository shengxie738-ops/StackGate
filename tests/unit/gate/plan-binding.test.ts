import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import type {CheckPlan,CheckResult} from '../../../packages/contracts/src/index.js';
import {validateCheckPlanBinding} from '../../../packages/core/src/services/gate-service.js';
const plan:CheckPlan=JSON.parse(await fs.readFile('tests/fixtures/protocols/plan.json','utf8'));
const result:CheckResult=JSON.parse(await fs.readFile('tests/fixtures/protocols/check-result.json','utf8'));
it('binds valid collected check requirements without mutating facts',()=>{const before=structuredClone(result);expect(validateCheckPlanBinding(plan,[result])).toEqual([]);expect(result).toEqual(before);});
it.each(['expected-ids','kind','step','required','minimum','attempt','unknown','duplicate'])('rejects forged %s even if a document schema would accept it',kind=>{
 const changed=structuredClone(result);if(kind==='expected-ids')changed.expected_test_ids=[];if(kind==='kind')changed.result_kind='exit-code';if(kind==='step')changed.step_id='other';if(kind==='required')changed.required=false;if(kind==='minimum')changed.executed_tests=0;if(kind==='attempt')changed.attempts=[];if(kind==='unknown')changed.check_id='other';
 expect(validateCheckPlanBinding(plan,kind==='duplicate'?[changed,changed]:[changed]).length).toBeGreaterThan(0);
});
