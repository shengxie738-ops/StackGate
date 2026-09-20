import type { ExitCode, Freshness, Verdict } from '../../../contracts/src/index.js';
export function selectExitCode(input: { configuration_valid: boolean; verdict: Verdict; freshness: Freshness; deterministic_denial: boolean; incomplete: boolean }): ExitCode {
  if (input.configuration_valid !== true) return 64;
  if (input.verdict === 'ERROR' || !['PASS','FAIL','INCOMPLETE'].includes(input.verdict)) return 3;
  if (input.freshness === 'STALE') return 4;
  if (input.verdict === 'FAIL' || input.deterministic_denial) return 1;
  if (input.verdict === 'INCOMPLETE' || input.freshness !== 'FRESH' || input.incomplete !== false || input.deterministic_denial !== false) return 2;
  return 0;
}
