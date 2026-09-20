import { isRecord } from './inspect-refs.js';
import { parseToolJson, toolDiagnostic } from './tool.js';
import type { ContractToolResult, ToolEvidence } from './tool.js';
const mapFields = new Set(['paths', 'operations', 'responses', 'content', 'properties', 'parameters', 'headers', 'schemas', 'securitySchemes', 'requestBodies']);
const nodeFields = new Set(['schema', 'items', 'requestBody', 'info', 'components']);
const valueFields = new Set(['openapi', 'type', 'enum', 'required', 'description', 'title', 'version', 'operationId', 'summary', 'readOnly', 'writeOnly', 'additionalPropertiesAllowed', 'jsonSchemaDialect']);
const scalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
function validDifference(value: unknown): value is Record<string, unknown> {
  let nodes = 0;
  function node(item: unknown, depth: number): boolean {
    if (++nodes > 50000 || depth > 128 || !isRecord(item) || !Object.keys(item).length) return false;
    return Object.entries(item).every(([key, child]) => mapFields.has(key) ? delta(child, depth + 1, false) : nodeFields.has(key) ? node(child, depth + 1) : valueFields.has(key) ? valueDelta(child) : false);
  }
  function valueDelta(item: unknown): boolean {
    if (!isRecord(item) || !Object.keys(item).length) return false;
    if (Object.keys(item).every((key) => ['from', 'to'].includes(key))) return Object.values(item).every(scalar);
    return delta(item, 0, true);
  }
  function delta(item: unknown, depth: number, values: boolean): boolean {
    if (++nodes > 50000 || depth > 128 || !isRecord(item) || !Object.keys(item).length) return false;
    return Object.entries(item).every(([key, child]) => {
      if (key === 'added' || key === 'deleted') return Array.isArray(child) && child.length > 0 && child.every(values ? scalar : (entry) => typeof entry === 'string');
      if (key !== 'modified' || values || !isRecord(child) || !Object.keys(child).length) return false;
      return Object.values(child).every((entry) => node(entry, depth + 1));
    });
  }
  return isRecord(value) && (Object.keys(value).length === 0 || node(value, 0));
}
export function parseDiffResult(evidence: ToolEvidence): ContractToolResult<Record<string, unknown>> {
  const result: ContractToolResult<Record<string, unknown>> = { status: 'ERROR', value: null, diagnostics: [], evidence: [evidence] };
  try {
    if (evidence.interrupted || evidence.signal || evidence.stderr || ![0, 1].includes(evidence.exit_code ?? -1)) throw new Error('Tool failed or emitted diagnostics');
    const value: unknown = parseToolJson(evidence.stdout);
    if (!validDifference(value)) throw new Error('Unknown or malformed structural diff JSON');
    result.value = value;
    const changed = Object.keys(value).length > 0;
    if (evidence.exit_code !== (changed ? 1 : 0)) throw new Error('Diff output and exit status disagree');
    result.status = changed ? 'FAIL' : 'PASS';
  } catch (error) { result.diagnostics.push(toolDiagnostic('REPORT_INVALID', error instanceof Error ? error.message : 'Invalid diff output')); }
  return result;
}
