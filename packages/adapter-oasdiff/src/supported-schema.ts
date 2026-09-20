import type { Diagnostic } from '../../contracts/src/diagnostic.js';
import type { LoadedContract } from './load-contract.js';
import { isRecord, pointerPart, resolveFragment, unsupported } from './inspect-refs.js';
import { resolveOperationScope } from './operation-scope.js';

export interface CapabilityDiagnostics {
  supported: boolean;
  verdict: 'SUPPORTED' | 'INCOMPLETE';
  diagnostics: Diagnostic[];
  operation_scope: string[];
  conservative: boolean;
}
/** Exact tested subset; unknown validation keywords/annotations are never silently ignored. */
export const SUPPORTED_SCHEMA_CAPABILITIES = Object.freeze({
  dialect: 'OpenAPI 3.1', types: ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'],
  keywords: ['$ref', 'type', 'properties', 'required', 'items', 'enum', 'additionalProperties', 'readOnly', 'writeOnly', 'anyOf', 'title', 'description'],
  formats: [], nullable: 'one non-null type plus null; either type array or two simple anyOf branches',
  metadata: ['title', 'description'], references: 'same-document JSON pointers; no cycles',
});
const types = new Set<string>(SUPPORTED_SCHEMA_CAPABILITIES.types);
const keywords = new Set<string>(SUPPORTED_SCHEMA_CAPABILITIES.keywords);

export function inspectSupportedSchema(contract: LoadedContract, operationScope?: readonly string[]): CapabilityDiagnostics {
  const scope = resolveOperationScope(contract, operationScope);
  const diagnostics = [...contract.diagnostics];
  const fail = (pointer: string, message: string) => diagnostics.push(unsupported(contract.source, pointer, message));
  const visited = new Set<string>();
  let count = 0;
  function schema(value: unknown, pointer: string, depth: number): void {
    if (++count > 50000 || depth > 128) { if (count === 50001 || depth === 129) fail(pointer, 'Schema traversal bound exceeded'); return; }
    if (!isRecord(value)) { fail(pointer, 'Schema must be an object in the tested subset'); return; }
    if (visited.has(`schema:${pointer}`)) return;
    visited.add(`schema:${pointer}`);
    for (const key of Object.keys(value)) if (!keywords.has(key)) fail(`${pointer}/${pointerPart(key)}`, `Unsupported schema keyword or annotation: ${key}`);
    if (value.$ref !== undefined) {
      const resolved = resolveFragment(contract.document, value.$ref);
      if (!resolved) fail(`${pointer}/$ref`, 'Unresolved reference');
      else schema(resolved.value, resolved.pointer, depth + 1);
    }
    const declaredType = value.type;
    let typeList: string[] = [];
    if (typeof declaredType === 'string' && types.has(declaredType)) typeList = [declaredType];
    else if (Array.isArray(declaredType) && declaredType.length === 2 && new Set(declaredType).size === 2 && declaredType.includes('null') && declaredType.every((type) => typeof type === 'string' && types.has(type))) typeList = declaredType as string[];
    else if (declaredType !== undefined) fail(`${pointer}/type`, 'Only primitive types and simple T|null are supported');
    if (declaredType === undefined && value.$ref === undefined && value.anyOf === undefined) fail(pointer, 'Explicit type or tested local reference/nullable union is required');
    if (value.anyOf !== undefined) {
      if (declaredType !== undefined || value.$ref !== undefined) fail(`${pointer}/anyOf`, 'Combining nullable branches with another type/reference is outside the tested subset');
      const variants = value.anyOf;
      const simple = Array.isArray(variants) && variants.length === 2 && variants.every((branch) => isRecord(branch) && typeof branch.type === 'string' && types.has(branch.type)) && variants.filter((branch) => isRecord(branch) && branch.type === 'null' && Object.keys(branch).length === 1).length === 1;
      if (!simple) fail(`${pointer}/anyOf`, 'Only two-branch simple T|null anyOf is supported');
      else (variants as unknown[]).forEach((branch, index) => schema(branch, `${pointer}/anyOf/${index}`, depth + 1));
    }
    for (const annotation of ['readOnly', 'writeOnly']) if (value[annotation] !== undefined && typeof value[annotation] !== 'boolean') fail(`${pointer}/${annotation}`, 'Direction annotation must be boolean');
    if (value.readOnly === true && value.writeOnly === true) fail(pointer, 'A property cannot be both readOnly and writeOnly');
    for (const annotation of ['title', 'description']) if (value[annotation] !== undefined && typeof value[annotation] !== 'string') fail(`${pointer}/${annotation}`, 'Metadata must be a string');
    if (value.properties !== undefined) {
      if (!typeList.includes('object') || !isRecord(value.properties)) fail(`${pointer}/properties`, 'Properties require an object type and property map');
      else for (const [key, child] of Object.entries(value.properties)) schema(child, `${pointer}/properties/${pointerPart(key)}`, depth + 1);
    }
    if (value.required !== undefined && (!typeList.includes('object') || !Array.isArray(value.required) || new Set(value.required).size !== value.required.length || value.required.some((key) => typeof key !== 'string' || !isRecord(value.properties) || !Object.hasOwn(value.properties, key)))) fail(`${pointer}/required`, 'Required must list unique declared property names');
    if (value.additionalProperties !== undefined && (!typeList.includes('object') || typeof value.additionalProperties !== 'boolean')) fail(`${pointer}/additionalProperties`, 'Only boolean additionalProperties on objects is supported');
    if (typeList.includes('array')) {
      if (value.items === undefined) fail(`${pointer}/items`, 'Array items schema is required for this subset');
      else schema(value.items, `${pointer}/items`, depth + 1);
    } else if (value.items !== undefined) fail(`${pointer}/items`, 'Items require an array type');
    if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.some((entry) => entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)) || new Set(value.enum.map((entry) => JSON.stringify(entry))).size !== value.enum.length)) fail(`${pointer}/enum`, 'Enum must contain unique scalar values');
    else if (Array.isArray(value.enum) && typeList.length > 0 && value.enum.some((entry) => !typeList.some((type) => type === 'null' ? entry === null : type === 'integer' ? typeof entry === 'number' && Number.isInteger(entry) : typeof entry === type))) fail(`${pointer}/enum`, 'Enum entries must match the declared type');
  }
  const walked = new Set<string>();
  function parameter(value: unknown, pointer: string): void {
    if (isRecord(value) && value.$ref !== undefined) {
      const resolved = resolveFragment(contract.document, value.$ref);
      if (resolved) { parameter(resolved.value, resolved.pointer); return; }
    }
    if (!isRecord(value) || typeof value.name !== 'string' || !value.name || !['query', 'header', 'path', 'cookie'].includes(String(value.in)) || !isRecord(value.schema) || value.content !== undefined || (value.required !== undefined && typeof value.required !== 'boolean') || (value.in === 'path' && value.required !== true)) fail(pointer, 'Parameter requires a name, supported location, schema, and valid required flag');
  }
  function walk(value: unknown, pointer: string, depth: number): void {
    if (++count > 50000 || depth > 128) { if (count === 50001 || depth === 129) fail(pointer, 'Operation traversal bound exceeded'); return; }
    if ((!isRecord(value) && !Array.isArray(value)) || walked.has(pointer)) return;
    walked.add(pointer);
    if (isRecord(value) && value.$ref !== undefined) {
      const resolved = resolveFragment(contract.document, value.$ref);
      if (resolved) walk(resolved.value, resolved.pointer, depth + 1);
      else fail(`${pointer}/$ref`, 'Unresolved operation reference');
    }
    for (const [key, child] of Object.entries(value)) {
      const childPointer = `${pointer}/${pointerPart(key)}`;
      if (key === 'content') {
        if (!isRecord(child) || Object.keys(child).length === 0) fail(childPointer, 'Content must be a nonempty JSON media-type map');
        else for (const [media, representation] of Object.entries(child)) if (media !== 'application/json' || !isRecord(representation) || !isRecord(representation.schema)) fail(`${childPointer}/${pointerPart(media)}`, 'Only application/json with an explicit schema is supported');
      }
      if (key === 'parameters') {
        if (!Array.isArray(child)) fail(childPointer, 'Parameters must be an array');
        else child.forEach((entry, index) => parameter(entry, `${childPointer}/${index}`));
      }
      if (key === 'requestBody' && (!isRecord(child) || (child.$ref === undefined && !isRecord(child.content)) || (isRecord(child) && child.required !== undefined && typeof child.required !== 'boolean'))) fail(childPointer, 'Request body must have content or an audited reference and a boolean required flag');
      if (key === 'schema') schema(child, childPointer, depth + 1);
      else if (key !== '$ref') walk(child, childPointer, depth + 1);
    }
  }
  if (contract.supported && contract.document) for (const operation of contract.operations.filter((item) => scope.operation_scope.includes(item.key))) {
    // Internal JSON pointers are not URI fragments yet; preserve literal percent signs.
    const fragment = (pointer: string) => `#${pointer.split('/').map(encodeURIComponent).join('/')}`;
    const resolved = resolveFragment(contract.document, fragment(operation.pointer));
    if (resolved) walk(resolved.value, resolved.pointer, 0);
    const pathPointer = operation.pointer.slice(0, operation.pointer.lastIndexOf('/'));
    const parameters = resolveFragment(contract.document, fragment(`${pathPointer}/parameters`));
    if (parameters) {
      if (!Array.isArray(parameters.value)) fail(parameters.pointer, 'Parameters must be an array');
      else parameters.value.forEach((entry, index) => parameter(entry, `${parameters.pointer}/${index}`));
      walk(parameters.value, parameters.pointer, 0);
    }
  }
  const supported = contract.supported && diagnostics.length === 0;
  return { supported, verdict: supported ? 'SUPPORTED' : 'INCOMPLETE', diagnostics, ...scope };
}
