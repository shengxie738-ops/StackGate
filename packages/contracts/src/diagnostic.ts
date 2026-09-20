import type { ReasonCode } from './generated/common.js';
export type { ReasonCode } from './generated/common.js';
export type DiagnosticCategory = 'CONTRACT' | 'CONSUMER' | 'RUNTIME' | 'EVIDENCE' | 'POLICY' | 'ENV' | 'TOOL';
export interface Diagnostic {
  code: ReasonCode;
  rule_id?: `SG-${DiagnosticCategory}-${string}`;
  message: string;
  location: string;
  observed_facts: Record<string, unknown>;
  recommended_action: string;
  source: string;
}
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] };
