import type { Diagnostic } from '../../contracts/src/diagnostic.js';

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const pointerPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
export function unsupported(source: string, location: string, message: string, facts: Record<string, unknown> = {}): Diagnostic {
  return { code: 'UNSUPPORTED_SCHEMA', rule_id: 'SG-CONTRACT-UNSUPPORTED_SCHEMA', source, location, message, observed_facts: facts, recommended_action: 'Use the explicitly tested OpenAPI 3.1 subset; keep this contract check incomplete.' };
}
export interface ResolvedFragment { value: unknown; pointer: string }
/** Resolve JSON pointers against the supplied object only. Never resolve files, URLs or anchors. */
export function resolveFragment(document: unknown, ref: unknown): ResolvedFragment | undefined {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return undefined;
  let fragment: string;
  try { fragment = decodeURIComponent(ref.slice(1)); } catch { return undefined; }
  if (fragment !== '' && !fragment.startsWith('/')) return undefined;
  let value = document;
  if (fragment !== '') for (const encoded of fragment.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(encoded)) return undefined;
    const token = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if ((!isRecord(value) && !Array.isArray(value)) || !Object.hasOwn(value, token)) return undefined;
    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      value = value[Number(token)];
    } else value = value[token];
  }
  return { value, pointer: fragment };
}

export function inspectRefs(document: unknown, source: string, maxRefVisits = 2000): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const active = new Set<object>();
  const complete = new Set<object>();
  let references = 0;
  let exhausted = false;
  function visit(value: unknown, pointer: string, depth: number): void {
    if (exhausted || (!isRecord(value) && !Array.isArray(value))) return;
    if (depth > 128) { diagnostics.push(unsupported(source, pointer, 'Reference traversal exceeds depth limit')); exhausted = true; return; }
    if (active.has(value)) { diagnostics.push(unsupported(source, pointer, 'Recursive references are outside the tested subset')); return; }
    if (complete.has(value)) return;
    active.add(value);
    for (const [key, child] of Object.entries(value)) {
      const location = `${pointer}/${pointerPart(key)}`;
      if (['$dynamicRef', '$recursiveRef', '$dynamicAnchor', '$anchor', '$id'].includes(key)) {
        diagnostics.push(unsupported(source, location, 'Dynamic references, anchors and rebased reference scopes are unsupported'));
      }
      if (key === '$ref') {
        if (++references > maxRefVisits) { diagnostics.push(unsupported(source, location, 'Reference traversal limit exceeded')); exhausted = true; break; }
        if (typeof child !== 'string' || !child.startsWith('#')) {
          diagnostics.push({ ...unsupported(source, location, 'External references are prohibited before any tool invocation'), rule_id: 'SG-CONTRACT-EXTERNAL_REFERENCE' });
        } else {
          const resolved = resolveFragment(document, child);
          if (!resolved) diagnostics.push(unsupported(source, location, 'Local reference is malformed or its target is missing', { ref: child }));
          else if (!isRecord(resolved.value)) diagnostics.push(unsupported(source, location, 'Reference target must be an object'));
          else if (active.has(resolved.value)) diagnostics.push(unsupported(source, location, 'Recursive references are outside the tested subset'));
          else visit(resolved.value, resolved.pointer, depth + 1);
        }
      } else visit(child, location, depth + 1);
    }
    active.delete(value);
    complete.add(value);
  }
  visit(document, '', 0);
  return diagnostics;
}
