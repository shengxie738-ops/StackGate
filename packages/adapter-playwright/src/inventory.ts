import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const STACKGATE_ID_ANNOTATION = 'stackgate-id';
export const UNANNOTATED_TEST_ID = 'unannotated';
const ID_PATTERNS = {
  run_id: /^run_[A-Za-z0-9_-]+$/,
  check_id: /^[A-Za-z][A-Za-z0-9_-]{0,127}$/,
  attempt_id: /^attempt_[A-Za-z0-9_-]+$/,
} as const;

export interface ReporterIdentity {
  run_id: string;
  check_id: string;
  attempt_id: string;
  output_dir: string;
}

export type IdentityResult = ReporterIdentity | {error: string};

export function reporterIdentity(environment: NodeJS.ProcessEnv): IdentityResult {
  const identity = {
    run_id: environment.STACKGATE_RUN_ID ?? '',
    check_id: environment.STACKGATE_CHECK_ID ?? '',
    attempt_id: environment.STACKGATE_ATTEMPT_ID ?? '',
    output_dir: environment.STACKGATE_OUTPUT_DIR ?? '',
  };
  for (const field of ['run_id', 'check_id', 'attempt_id'] as const) {
    if (!ID_PATTERNS[field].test(identity[field])) return {error: `IDENTITY_INVALID:${field}`};
  }
  if (!path.isAbsolute(identity.output_dir)) return {error: 'IDENTITY_INVALID:output_dir'};
  return identity;
}

/** A stable acceptance id comes only from an explicit annotation, never from a title or file path. */
export function stableTestId(annotations: readonly {type?: unknown; description?: unknown}[]): {test_id: string; annotated: boolean} {
  const matches = annotations.filter(item => item?.type === STACKGATE_ID_ANNOTATION && typeof item.description === 'string');
  if (matches.length === 1) {
    const description = String((matches[0] as {description: string}).description);
    if (ID_PATTERNS.check_id.test(description)) return {test_id: description, annotated: true};
  }
  return {test_id: UNANNOTATED_TEST_ID, annotated: false};
}

export function atomicWriteJson(directory: string, name: string, value: unknown): string {
  mkdirSync(directory, {recursive: true});
  const target = path.join(directory, name);
  const temporary = path.join(directory, `.${name}.partial`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
  return target;
}

/** Refuses to overwrite a finished report from this attempt; a second run needs a new attempt id. */
export function completedReportExists(directory: string, name = 'playwright.json'): {exists: boolean; reason: string | null} {
  let text: string;
  try {
    text = readFileSync(path.join(directory, name), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {exists: false, reason: null};
    return {exists: false, reason: `REPORT_UNREADABLE:${code}`};
  }
  try {
    const parsed = JSON.parse(text) as {completed?: unknown};
    if (parsed?.completed === true) return {exists: true, reason: 'PRE_EXISTING_COMPLETED_REPORT'};
    return {exists: false, reason: 'STALE_INCOMPLETE_REPORT'};
  } catch {
    return {exists: false, reason: 'PRE_EXISTING_REPORT_UNPARSEABLE'};
  }
}
