import type { Diagnostic } from '../../contracts/src/diagnostic.js';
import { parseStrictDocument } from '../../core/src/services/strict-document.js';
import { hashBytes } from '../../core/src/storage/hash.js';
import { canonicalJson } from '../../core/src/storage/canonical-json.js';
import { inspectRefs, isRecord, pointerPart, unsupported } from './inspect-refs.js';

export interface ContractOperation { key: string; method: string; path: string; pointer: string }
export interface LoadedContract {
  source: string;
  raw_hash: string;
  document: Record<string, unknown> | null;
  operations: ContractOperation[];
  /** Parse/shape/reference safety only. Call inspectSupportedSchema for operation capabilities. */
  supported: boolean;
  diagnostics: Diagnostic[];
}
export interface ContractLimits { maxBytes?: number; maxDepth?: number; maxAliases?: number; maxRefVisits?: number }
const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const snapshots = new WeakMap<LoadedContract, { raw_hash: string; canonical_json: string }>();
/** Process-local certificate tying the parsed projection to the exact originally loaded bytes. */
export function getContractSnapshot(contract: LoadedContract): { raw_hash: string; canonical_json: string } | undefined {
  const snapshot = snapshots.get(contract);
  if (!snapshot || snapshot.raw_hash !== contract.raw_hash || snapshot.canonical_json !== canonicalJson(contract.document)) return undefined;
  return { ...snapshot };
}

export function loadContract(bytes: Uint8Array, source: string, limits: ContractLimits = {}): LoadedContract {
  const diagnostics: Diagnostic[] = [];
  const result: LoadedContract = { source, raw_hash: `sha256:${hashBytes(bytes)}`, document: null, operations: [], supported: false, diagnostics };
  const fail = (location: string, message: string) => diagnostics.push(unsupported(source, location, message));
  if (Object.values(limits).some((limit) => !Number.isSafeInteger(limit) || limit < 0) || (limits.maxAliases ?? 0) !== 0) {
    fail('', 'Invalid bounds or requested YAML alias expansion'); return result;
  }
  let parsed: unknown;
  try { parsed = parseStrictDocument(bytes, source, limits); }
  catch { fail('', 'Contract must be strict UTF-8 JSON/YAML with unique keys, no aliases or custom tags, and bounded size/depth'); return result; }
  if (!isRecord(parsed)) { fail('', 'OpenAPI document must be an object'); return result; }
  result.document = parsed;
  // This runs over every value, even unused components, annotations and invalid shapes.
  diagnostics.push(...inspectRefs(parsed, source, limits.maxRefVisits));
  if (typeof parsed.openapi !== 'string' || !/^3\.1\.\d+$/.test(parsed.openapi)) fail('/openapi', 'Only the OpenAPI 3.1 series is supported');
  if (!isRecord(parsed.info) || typeof parsed.info.title !== 'string' || !parsed.info.title || typeof parsed.info.version !== 'string' || !parsed.info.version) fail('/info', 'OpenAPI info requires nonempty title and version');
  if (parsed.jsonSchemaDialect !== undefined && parsed.jsonSchemaDialect !== 'https://spec.openapis.org/oas/3.1/dialect/base') fail('/jsonSchemaDialect', 'Custom JSON Schema dialect is unsupported');
  if (parsed.webhooks !== undefined) fail('/webhooks', 'Webhooks are outside the REST operation subset');
  if (parsed.components !== undefined && !isRecord(parsed.components)) fail('/components', 'Components must be an object');
  if (!isRecord(parsed.paths)) fail('/paths', 'OpenAPI paths must be an object');
  else for (const [route, item] of Object.entries(parsed.paths)) {
    if (route.startsWith('x-')) continue;
    const pointer = `/paths/${pointerPart(route)}`;
    if (!route.startsWith('/') || !isRecord(item)) { fail(pointer, 'Path items must be objects under literal slash-prefixed paths'); continue; }
    if (item.$ref !== undefined) { fail(`${pointer}/$ref`, 'Path-item references are outside the tested operation scope'); continue; }
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) {
        if (!['summary', 'description', 'servers', 'parameters'].includes(method) && !method.startsWith('x-')) fail(`${pointer}/${pointerPart(method)}`, 'Unknown path-item member');
        continue;
      }
      const operationPointer = `${pointer}/${method}`;
      if (!isRecord(operation) || !isRecord(operation.responses) || Object.keys(operation.responses).length === 0) { fail(operationPointer, 'Operations require a nonempty responses object'); continue; }
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!/^(?:[1-5](?:\d{2}|XX)|default)$/.test(status) || !isRecord(response) || (response.$ref === undefined && typeof response.description !== 'string')) fail(`${operationPointer}/responses/${pointerPart(status)}`, 'Invalid response status or response object');
      }
      if (operation.callbacks !== undefined) fail(`${operationPointer}/callbacks`, 'Callbacks are outside the tested REST subset');
      result.operations.push({ key: `${method.toUpperCase()} ${route}`, method: method.toUpperCase(), path: route, pointer: operationPointer });
    }
  }
  result.operations.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  result.supported = diagnostics.length === 0;
  if (result.supported) snapshots.set(result, { raw_hash: result.raw_hash, canonical_json: canonicalJson(parsed) });
  return result;
}
