import type { AdapterCapabilities, Diagnostic, ProvenanceLevel } from '../../../contracts/src/index.js';
export interface CapabilityRequest {
  adapter_id: string; version: string; platform: 'win32' | 'linux' | 'darwin';
  schema_dialect: string; schema_features: readonly string[]; evidence_format: string;
  minimum_provenance: ProvenanceLevel;
}
export interface CapabilityNegotiation { supported: boolean; diagnostics: Diagnostic[] }
export function negotiateCapabilities(declared: AdapterCapabilities, requested: CapabilityRequest): CapabilityNegotiation {
  const diagnostics: Diagnostic[] = [];
  function requireSupport(condition: boolean, field: string, wanted: unknown, available: unknown) {
    if (!condition) diagnostics.push({ code: 'UNSUPPORTED_CAPABILITY', rule_id: 'SG-TOOL-UNSUPPORTED_CAPABILITY', message: `Adapter does not declare requested ${field}`, location: '/' + field, observed_facts: { requested: wanted, declared: available }, recommended_action: 'Use an explicitly tested adapter/tool combination or keep the check blocked.', source: declared.adapter_id });
  }
  requireSupport(declared.status === 'SUPPORTED', 'status', 'SUPPORTED', declared.status);
  requireSupport(declared.adapter_id === requested.adapter_id, 'adapter_id', requested.adapter_id, declared.adapter_id);
  requireSupport(declared.version === requested.version, 'version', requested.version, declared.version);
  requireSupport(declared.platforms.includes(requested.platform), 'platform', requested.platform, declared.platforms);
  requireSupport(declared.schema_dialects.includes(requested.schema_dialect), 'schema_dialect', requested.schema_dialect, declared.schema_dialects);
  for (const feature of requested.schema_features) requireSupport(declared.schema_features.includes(feature), 'schema_features', feature, declared.schema_features);
  requireSupport(declared.evidence_formats.includes(requested.evidence_format), 'evidence_format', requested.evidence_format, declared.evidence_formats);
  const rank: Record<ProvenanceLevel, number> = { DECLARED: 0, OBSERVED: 1, CONTROLLED: 2 };
  requireSupport(declared.provenance_levels.some(level => rank[level] >= rank[requested.minimum_provenance]), 'minimum_provenance', requested.minimum_provenance, declared.provenance_levels);
  return { supported: diagnostics.length === 0, diagnostics };
}
