import type { EvidenceIdentity, FreshnessReason } from './compare-inputs.js';
import { compareInputs } from './compare-inputs.js';
export type { EvidenceIdentity, FreshnessReason } from './compare-inputs.js';
export interface FreshnessRequirements { require_latest_target:boolean; target_tip_verified?:boolean; run_input_hash_before?:string; run_input_hash_after?:string; ttl_ms?:number; now?:string }
export interface FreshnessResult {freshness:'FRESH'|'STALE'|'UNVERIFIED';reasons:FreshnessReason[]}
/** Pure identity comparison. The caller supplies trusted observations and a confirmed target policy. */
export function evaluateFreshness(recorded:EvidenceIdentity,current:EvidenceIdentity,requirements:FreshnessRequirements): FreshnessResult {
  const reasons = compareInputs(recorded,current);
  if (recorded.completeness !== 'COMPLETE' || current.completeness !== 'COMPLETE') reasons.push({field:'completeness',code:'UNVERIFIED'});
  if (requirements.require_latest_target === true) {
    if (requirements.target_tip_verified !== true) reasons.push({field:'target_tip_oid',code:'UNVERIFIED'});
    else if (!recorded.target_tip_oid?.trim() || !current.target_tip_oid?.trim()) reasons.push({field:'target_tip_oid',code:'MISSING'});
    else if (recorded.target_tip_oid !== current.target_tip_oid) reasons.push({field:'target_tip_oid',code:'CHANGED'});
  } else if (requirements.require_latest_target !== false) reasons.push({field:'require_latest_target',code:'UNVERIFIED'});
  const before = requirements.run_input_hash_before, after = requirements.run_input_hash_after;
  if (before !== undefined || after !== undefined) {
    if (!before?.trim() || !after?.trim()) reasons.push({field:'run.input_hash',code:'MISSING'});
    else if (before !== after) reasons.push({field:'run.input_hash',code:'INPUT_CHANGED_DURING_RUN'});
    else if (before !== recorded.input_hash || after !== current.input_hash) reasons.push({field:'run.input_hash',code:'CHANGED'});
  }
  if (requirements.ttl_ms !== undefined) {
    const captured = Date.parse(recorded.captured_at ?? ''), now = Date.parse(requirements.now ?? '');
    if (!Number.isFinite(requirements.ttl_ms) || requirements.ttl_ms < 0 || !Number.isFinite(captured) || !Number.isFinite(now) || captured > now) reasons.push({field:'captured_at',code:'INVALID_TIME'});
    else if (now - captured > requirements.ttl_ms) reasons.push({field:'captured_at',code:'EXPIRED'});
  }
  const stale = reasons.some(reason => reason.code === 'CHANGED' || reason.code === 'EXPIRED' || reason.code === 'INPUT_CHANGED_DURING_RUN');
  return {freshness:stale ? 'STALE' : reasons.length ? 'UNVERIFIED' : 'FRESH',reasons};
}
