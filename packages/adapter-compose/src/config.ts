import fs from 'node:fs/promises';
import path from 'node:path';
import type { Diagnostic } from '../../contracts/src/index.js';
import { parseStrictDocument } from '../../core/src/services/strict-document.js';
import { redactText } from '../../core/src/evidence/redaction.js';

/**
 * Compose configuration reading boundary for SG-057.
 *
 * Everything here is text parsing. No compose command is executed, no resource is created, and no
 * host environment variable is read implicitly: the caller supplies the interpolation environment it
 * authorises, so an unset variable can never be silently defaulted.
 */

export const COMPOSE_MAX_BYTES = 262_144;
const SOURCE = 'compose-config';

export interface InterpolationFact {
  pointer: string;
  variable: string;
  /** False when the variable is absent from the caller-supplied environment. */
  declared: boolean;
  sensitivity: 'plain' | 'restricted';
}

export interface ComposeParseResult {
  ok: boolean;
  source: string;
  /** Best effort resolved document; tokens stay unexpanded when they could not be resolved. */
  config: unknown;
  diagnostics: Diagnostic[];
  interpolation: InterpolationFact[];
  /** Pointers whose value came from a variable and carries a credential, kept out of every report. */
  restricted_pointers: string[];
}

export interface ComposeParseInput { source: string; text: string; environment?: Readonly<Record<string, string>> }

/**
 * A value counts as credential-bearing when the repository existing conservative redaction rule
 * would alter it (`redactText`, packages/core/src/evidence/redaction.ts) or when it parses as a URL
 * that carries userinfo. That is a stated rule with one implementation, not a per-adapter keyword
 * list; because it can under-detect, service `environment` values are additionally never echoed into
 * any diagnostic, so an undetected credential still cannot leave the boundary as report text.
 */
export function credentialBearing(value: string): boolean {
  if (value.length === 0) return false;
  if (redactText(value) !== value) return true;
  try {
    return new URL(value).password.length > 0;
  } catch {
    return false;
  }
}

const INTERPOLATION = /\$\$|\$\{([^{}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/** Compose interpolation forms: NAME, NAME:-default, NAME-default, NAME:?err, NAME?err, NAME:=default, NAME=default. */
function parseExpression(expression: string): { variable: string; had_default: boolean } | null {
  const match = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::?[-+=?].*)?$/u);
  const name = match?.[1];
  if (typeof name !== 'string') return null;
  return { variable: name, had_default: expression.length > name.length };
}

export function parseComposeText(input: ComposeParseInput): ComposeParseResult {
  const diagnostics: Diagnostic[] = [];
  let parsed: unknown = null;
  try {
    parsed = parseStrictDocument(Buffer.from(input.text, 'utf8'), input.source);
  } catch (error) {
    diagnostics.push({
      code: 'CONFIG_INVALID',
      rule_id: 'SG-POLICY-COMPOSE-PARSE-FAILED',
      message: `Compose document could not be parsed as a strict YAML mapping: ${(error as Error).message}`,
      location: `/${input.source}`,
      observed_facts: { source: input.source },
      recommended_action: 'Repair the compose document so it parses without aliases, duplicate keys or non-UTF-8 bytes.',
      source: SOURCE,
    });
    return { ok: false, source: input.source, config: null, diagnostics, interpolation: [], restricted_pointers: [] };
  }
  const environment = input.environment ?? {};
  const interpolation: InterpolationFact[] = [];
  const restricted_pointers: string[] = [];
  const config = resolveNode(parsed, '', environment, interpolation, diagnostics, restricted_pointers);
  return { ok: diagnostics.length === 0, source: input.source, config, diagnostics, interpolation, restricted_pointers };
}

export interface ComposeFileInput { file: string; cwd?: string; environment?: Readonly<Record<string, string>> }

export async function loadComposeFile(input: ComposeFileInput): Promise<ComposeParseResult> {
  const absolute = path.resolve(input.cwd ?? process.cwd(), input.file);
  const source = input.file;
  let text: string;
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return failure(source, 'compose path is not a regular file');
    if (stat.size > COMPOSE_MAX_BYTES) return failure(source, `compose document exceeds ${COMPOSE_MAX_BYTES} bytes`);
    text = await fs.readFile(absolute, 'utf8');
  } catch (error) {
    return failure(source, `compose document is unreadable: ${(error as Error).message}`);
  }
  return parseComposeText({ source, text, ...(input.environment ? { environment: input.environment } : {}) });
}

export interface BuildInputAccounting {
  context: string;
  exists: boolean;
  is_directory: boolean;
  dockerignore_present: boolean;
  entry_count: number;
  truncated: boolean;
  complete: boolean;
}

/**
 * Count the actual build inputs of one declared context and require a `.dockerignore`, so the build
 * inputs are accounted by the file set rather than substituted by a Git SHA.
 */
export async function accountBuildInputs(root: string, context: string, limits: { maxEntries?: number } = {}): Promise<BuildInputAccounting> {
  const empty: BuildInputAccounting = { context, exists: false, is_directory: false, dockerignore_present: false, entry_count: 0, truncated: false, complete: false };
  const absolute = path.resolve(root, context);
  if (!inside(absolute, path.resolve(root))) return empty;
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    return empty;
  }
  if (!stat.isDirectory()) return { ...empty, exists: true };
  const maxEntries = limits.maxEntries ?? 5_000;
  let entries = 0;
  let truncated = false;
  let dockerignore = false;
  const queue = [absolute];
  while (queue.length > 0) {
    const directory = queue.shift()!;
    let children;
    try {
      children = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return { ...empty, exists: true, is_directory: true };
    }
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      if (++entries > maxEntries) {
        truncated = true;
        break;
      }
      if (child.isDirectory()) queue.push(path.join(directory, child.name));
      else if (child.isFile() && directory === absolute && child.name === '.dockerignore') dockerignore = true;
    }
    if (truncated) break;
  }
  return { context, exists: true, is_directory: true, dockerignore_present: dockerignore, entry_count: entries, truncated, complete: !truncated && dockerignore && entries > 0 };
}

function failure(source: string, message: string): ComposeParseResult {
  return {
    ok: false,
    source,
    config: null,
    diagnostics: [{ code: 'CONFIG_INVALID', rule_id: 'SG-POLICY-COMPOSE-CONFIG-UNVALIDATED', message, location: `/${source}`, observed_facts: { source }, recommended_action: 'Provide a readable compose document inside the run directory.', source: SOURCE }],
    interpolation: [],
    restricted_pointers: [],
  };
}

function resolveNode(value: unknown, pointer: string, environment: Readonly<Record<string, string>>, facts: InterpolationFact[], diagnostics: Diagnostic[], restricted: string[]): unknown {
  if (typeof value === 'string') return resolveString(value, pointer, environment, facts, diagnostics, restricted);
  if (Array.isArray(value)) return value.map((entry, index) => resolveNode(entry, `${pointer}/${index}`, environment, facts, diagnostics, restricted));
  const record = asRecord(value);
  if (!record) return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    const childPointer = `${pointer}/${key}`;
    const resolvedKey = resolveString(key, childPointer, environment, facts, diagnostics, restricted);
    output[resolvedKey] = resolveNode(entry, childPointer, environment, facts, diagnostics, restricted);
  }
  return output;
}

function resolveString(value: string, pointer: string, environment: Readonly<Record<string, string>>, facts: InterpolationFact[], diagnostics: Diagnostic[], restricted: string[]): string {
  if (!value.includes('$')) return value;
  let output = '';
  let cursor = 0;
  for (const match of value.matchAll(INTERPOLATION)) {
    output += value.slice(cursor, match.index);
    cursor = (match.index ?? 0) + match[0].length;
    if (match[0] === '$$') {
      output += '$';
      continue;
    }
    const expression = match[1] ?? match[0].slice(1);
    const parsed = parseExpression(expression);
    if (!parsed) {
      output += match[0];
      continue;
    }
    const present = Object.hasOwn(environment, parsed.variable);
    const resolved = present ? environment[parsed.variable]! : '';
    facts.push({ pointer, variable: parsed.variable, declared: present, sensitivity: present && credentialBearing(resolved) ? 'restricted' : 'plain' });
    if (!present) {
      diagnostics.push(unresolved(pointer, parsed.variable, parsed.had_default));
      output += match[0];
      continue;
    }
    if (credentialBearing(resolved)) restricted.push(pointer);
    output += resolved;
  }
  return output + value.slice(cursor);
}

function unresolved(pointer: string, variable: string, defaulted: boolean): Diagnostic {
  return {
    code: 'CONFIG_INVALID',
    rule_id: 'SG-POLICY-COMPOSE-INTERPOLATION-UNRESOLVED',
    message: `Value depends on variable ${variable} which is not in the authorised environment, so its effective form is unknown.`,
    location: pointer,
    observed_facts: { variable, default_present: defaulted },
    recommended_action: 'Pass the variable in the authorised environment or replace the reference with a literal value the preflight can read.',
    source: SOURCE,
  };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function inside(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith('..'));
}
