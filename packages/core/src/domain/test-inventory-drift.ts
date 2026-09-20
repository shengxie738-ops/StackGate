import type { AcceptanceSnapshot,DriftFinding } from './protected-input-drift.js';
/** Static declarations and observed runtime inventory are deliberately evaluated separately. */
export function detectTestInventoryDrift(confirmed:AcceptanceSnapshot,current:AcceptanceSnapshot):DriftFinding[]{
  const findings:DriftFinding[]=[];
  const deny=(code:string,reference:string,message:string,category:DriftFinding['category']='KNOWN')=>findings.push({code,reference,category,decision:'DENY',message});
  for(const id of confirmed.required_checks)if(!current.required_checks.includes(id)||!Object.hasOwn(current.checks,id))deny('REQUIRED_CHECK_MISSING',id,'Confirmed required check was removed or is no longer configured');
  for(const id of confirmed.required_test_ids)if(!current.required_test_ids.includes(id))deny('REQUIRED_TEST_MISSING',id,'Confirmed stable test ID was removed or renamed');
  for(const [id,before] of Object.entries(confirmed.checks)){
    const after=Object.hasOwn(current.checks,id)?current.checks[id]:undefined;
    if(!after){if(!confirmed.required_checks.includes(id))deny('CHECK_CONTRACT_CHANGED',id,'Confirmed check definition was removed');continue;}
    if(before.adapter!==after.adapter||before.result_kind!==after.result_kind)deny('CHECK_CONTRACT_CHANGED',id,'Check adapter or result-kind contract changed');
    if(before.min_tests!==undefined&&(after.min_tests===undefined||after.min_tests<before.min_tests))deny('MIN_TESTS_REDUCED',id,'Confirmed minimum executed test count was reduced or removed');
  }
  const inventory=current.runtime_inventory;
  if(!inventory)findings.push({code:'RUNTIME_NOT_EXECUTED',reference:'runtime_inventory',category:'RUNTIME',decision:'NOT_EXECUTED',message:'No observed runtime test inventory was supplied; declared tests are not execution evidence'});
  else{
    if(inventory.complete!==true)deny('RUNTIME_INVENTORY_INCOMPLETE','runtime_inventory','Observed runtime inventory is incomplete','RUNTIME');
    if(new Set(inventory.executed_test_ids).size!==inventory.executed_test_ids.length)deny('RUNTIME_INVENTORY_INCOMPLETE','runtime_inventory','Observed runtime inventory contains duplicate stable IDs','RUNTIME');
    for(const id of confirmed.required_test_ids)if(!inventory.executed_test_ids.includes(id))deny('REQUIRED_TEST_NOT_EXECUTED',id,'Required stable test ID is absent from observed execution inventory','RUNTIME');
  }
  return findings;
}
