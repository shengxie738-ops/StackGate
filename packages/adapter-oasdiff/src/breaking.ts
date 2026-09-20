import { normalizeFindings } from './normalize-findings.js';
import type { CompatibilityFinding } from './normalize-findings.js';
import { parseToolJson, toolDiagnostic } from './tool.js';
import type { ContractToolResult, ToolEvidence } from './tool.js';
export function parseBreakingResult(evidence: ToolEvidence): ContractToolResult<CompatibilityFinding[]> {
  const result: ContractToolResult<CompatibilityFinding[]> = { status: 'ERROR', value: null, diagnostics: [], evidence: [evidence] };
  try {
    if (evidence.interrupted || evidence.signal || evidence.stderr || ![0, 1].includes(evidence.exit_code ?? -1)) throw new Error('Tool failed or emitted diagnostics');
    const normalized = normalizeFindings(parseToolJson(evidence.stdout));
    result.value = normalized.findings;
    if (normalized.unknown_ids.length) throw new Error(`Unmapped tool rule IDs: ${normalized.unknown_ids.join(', ')}`);
    // Adapter invokes --fail-on WARN so every returned breaking finding must exit 1.
    if (evidence.exit_code !== (normalized.findings.length ? 1 : 0)) throw new Error('Breaking output and exit status disagree');
    result.status = normalized.findings.length ? 'FAIL' : 'PASS';
  } catch (error) { result.diagnostics.push(toolDiagnostic('REPORT_INVALID', error instanceof Error ? error.message : 'Invalid tool output')); }
  return result;
}
