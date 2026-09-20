import type { GateInput, GateEvaluation, Verdict } from '../../../contracts/src/index.js';
import { aggregateChecks } from './aggregate-checks.js';
import { selectExitCode } from './exit-code.js';
/** Evaluates core-supplied facts only. Authenticating reports/plan identity belongs to GateService. */
export function evaluateGate(input: GateInput): GateEvaluation {
  const aggregate = aggregateChecks(input.checks, input.required_check_ids);
  const reasons = [...aggregate.reasons, ...input.deterministic_denials];
  if (input.configuration_valid !== true) reasons.push('CONFIG_INVALID');
  if (input.fatal_error !== false) reasons.push('FATAL_ERROR');
  if (input.report_integrity === 'INVALID') reasons.push('REPORT_INVALID');
  else if (input.report_integrity !== 'VALID') reasons.push('REPORT_UNVERIFIED');
  if (input.freshness === 'STALE') reasons.push('INPUT_STALE');
  else if (input.freshness !== 'FRESH') reasons.push('FRESHNESS_UNVERIFIED');
  const prerequisites = [
    [input.inputs_complete, 'INPUTS_INCOMPLETE'],
    [input.task_confirmed, 'TASK_UNCONFIRMED'],
    [input.policy_confirmed, 'POLICY_UNCONFIRMED'],
    [input.environment_satisfied, 'ENV_PROVENANCE_INSUFFICIENT'],
    [input.acceptance_inputs_approved, 'ACCEPTANCE_INPUTS_UNAPPROVED'],
  ] as const;
  for (const [valid, reason] of prerequisites) if (valid !== true) reasons.push(reason);
  const missing = prerequisites.some(([valid]) => valid !== true) || input.report_integrity !== 'VALID';
  const canceled = input.canceled !== false;
  if (canceled) reasons.push('CANCELED');
  const error = input.configuration_valid !== true || input.fatal_error !== false || input.report_integrity === 'INVALID' || aggregate.error;
  const deterministicDenial = input.deterministic_denials.length > 0;
  const verdict: Verdict = error ? 'ERROR' : canceled ? 'INCOMPLETE' : aggregate.failed || deterministicDenial ? 'FAIL' : aggregate.incomplete || missing ? 'INCOMPLETE' : 'PASS';
  const exitCode = selectExitCode({ configuration_valid: input.configuration_valid, verdict, freshness: input.freshness, deterministic_denial: deterministicDenial, incomplete: missing || canceled });
  return { schema_version: '0.1', verdict, freshness: input.freshness, decision: exitCode === 0 ? 'ALLOW' : 'DENY', exit_code: exitCode, reasons: [...new Set(reasons)] };
}
