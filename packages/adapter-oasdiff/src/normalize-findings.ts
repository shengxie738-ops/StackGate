import { isRecord } from './inspect-refs.js';

export interface CompatibilityFinding {
  rule_id: `SG-CONTRACT-${string}`;
  raw_rule_id: string;
  operation_key: string;
  severity: 'warning' | 'error';
  message: string;
  raw: Record<string, unknown>;
}
export const RULE_CLASSIFICATIONS: Readonly<Record<string, `SG-CONTRACT-${string}`>> = Object.freeze({
  'response-property-type-changed': 'SG-CONTRACT-TYPE_CHANGED',
  'response-required-property-removed': 'SG-CONTRACT-REQUIRED_PROPERTY_REMOVED',
  'request-property-became-required': 'SG-CONTRACT-REQUEST_REQUIRED_ADDED',
  'response-property-enum-value-added': 'SG-CONTRACT-RESPONSE_ENUM_EXPANDED',
});
const allowed = new Set(['id', 'text', 'comment', 'disclaimers', 'level', 'operation', 'operationId', 'path', 'section', 'attributes', 'baseSource', 'revisionSource', 'fingerprint']);
const cleanString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
export function normalizeFindings(value: unknown): { findings: CompatibilityFinding[]; unknown_ids: string[] } {
  if (!Array.isArray(value)) throw new Error('Breaking output must be an array');
  const unknown = new Set<string>();
  const findings = value.map((record): CompatibilityFinding => {
    if (!isRecord(record) || Object.keys(record).some((key) => !allowed.has(key)) || !cleanString(record.id) || !/^[a-z0-9-]+$/.test(record.id) || !cleanString(record.text) || ![2, 3].includes(Number(record.level)) || typeof record.level !== 'number' || !cleanString(record.operation) || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)$/.test(record.operation) || !cleanString(record.path) || !record.path.startsWith('/') || record.section !== 'paths') throw new Error('Unknown or malformed breaking record');
    for (const key of ['comment', 'operationId', 'fingerprint']) if (record[key] !== undefined && !cleanString(record[key])) throw new Error('Malformed optional finding text');
    if (record.disclaimers !== undefined && (!Array.isArray(record.disclaimers) || record.disclaimers.some((entry) => !cleanString(entry)))) throw new Error('Malformed disclaimers');
    if (record.attributes !== undefined && !isRecord(record.attributes)) throw new Error('Malformed attributes');
    for (const key of ['baseSource', 'revisionSource']) if (record[key] !== undefined) {
      const location = record[key];
      if (!isRecord(location) || Object.keys(location).some((name) => !['file', 'line', 'column', 'endLine', 'endColumn'].includes(name)) || (location.file !== undefined && !cleanString(location.file)) || Object.entries(location).some(([name, entry]) => name !== 'file' && (!Number.isSafeInteger(entry) || Number(entry) < 0))) throw new Error('Malformed source location');
    }
    const mapped = RULE_CLASSIFICATIONS[record.id];
    if (!mapped) unknown.add(record.id);
    return { rule_id: mapped ?? 'SG-CONTRACT-UNMAPPED', raw_rule_id: record.id, operation_key: `${record.operation} ${record.path}`, severity: record.level === 3 ? 'error' : 'warning', message: record.text, raw: record };
  });
  return { findings, unknown_ids: [...unknown] };
}
