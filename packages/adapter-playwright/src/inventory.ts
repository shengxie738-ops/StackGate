import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const STACKGATE_ID_ANNOTATION = 'stackgate-id';
export const UNANNOTATED_TEST_ID = 'unannotated';
const ID_PATTERNS = {
  run_id: /^run_[A-Za-z0-9_-]+$/,
  check_id: /^[A-Za-z][A-Za-z0-9_-]{0,127}$/,
  attempt_id: /^attempt_[A-Za-z0-9_-]+$/,
} as const;
/**
 * A report name is a plain basename only. Directory traversal, dot-prefixed temporary names and
 * non-JSON extensions are refused before any path is joined, because the caller-supplied name is
 * the only part of the write target that is not already fixed by the run identity.
 */
const SAFE_REPORT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,117}\.json$/;

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

function assertSafeName(name: string): void {
  if (!SAFE_REPORT_NAME.test(name)) throw new Error(`UNSAFE_NAME:${name}`);
}

/** An absent directory is a legal first writer; a link or a file standing in for one is not. */
function assertPlainDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) throw new Error('UNSAFE_DIRECTORY_NOT_ABSOLUTE');
  let status;
  try {
    status = lstatSync(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw new Error(`REPORT_DIRECTORY_UNREADABLE:${code}`);
  }
  if (status.isSymbolicLink()) throw new Error('REPORT_DIRECTORY_IS_A_LINK');
  if (!status.isDirectory()) throw new Error('REPORT_DIRECTORY_NOT_A_DIRECTORY');
}

/**
 * Diagnose whatever already occupies the report path. Only an absent target returns null; a stale,
 * corrupt, unreadable or aliased target is a reason to refuse, never a licence to overwrite.
 */
function diagnoseExistingReport(directory: string, name: string): string | null {
  const target = path.join(directory, name);
  let status;
  try {
    status = lstatSync(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    return `REPORT_TARGET_UNREADABLE:${code}`;
  }
  if (status.isSymbolicLink() || status.nlink > 1) return 'REPORT_TARGET_IS_A_LINK';
  if (!status.isFile()) return 'REPORT_TARGET_NOT_A_REGULAR_FILE';
  let text;
  try {
    text = readFileSync(target, 'utf8');
  } catch (error) {
    return `REPORT_TARGET_UNREADABLE:${(error as NodeJS.ErrnoException).code}`;
  }
  try {
    const parsed = JSON.parse(text) as {completed?: unknown};
    return parsed?.completed === true ? 'PRE_EXISTING_COMPLETED_REPORT' : 'STALE_INCOMPLETE_REPORT';
  } catch {
    return 'PRE_EXISTING_REPORT_UNPARSEABLE';
  }
}

/**
 * Refuses to write into an attempt that already holds a report. The name is kept for the reporter's
 * pre-existing-report check, but every existing target is refused, not only a completed one: an
 * interrupted or corrupt report still owns those bytes and a second submission needs a new attempt.
 */
export function assertNoCompletedReport(directory: string, name = 'playwright.json'): void {
  assertSafeName(name);
  assertPlainDirectory(directory);
  const reason = diagnoseExistingReport(directory, name);
  if (reason) throw new Error(reason);
}

function writeAll(handle: number, bytes: Buffer): void {
  let written = 0;
  while (written < bytes.length) written += writeSync(handle, bytes, written, bytes.length - written);
}

/**
 * Commits a JSON document without ever replacing an existing target. The exclusive temporary open and
 * the hard-link submit are the authority: `rename` would silently destroy a concurrent winner, while
 * `link` fails with EEXIST against any target that already exists on every supported platform.
 */
export function atomicWriteJson(directory: string, name: string, value: unknown): string {
  assertSafeName(name);
  assertPlainDirectory(directory);
  const blocked = diagnoseExistingReport(directory, name);
  if (blocked) throw new Error(blocked);
  mkdirSync(directory, {recursive: true});
  assertPlainDirectory(directory);
  const recheck = diagnoseExistingReport(directory, name);
  if (recheck) throw new Error(recheck);
  const target = path.join(directory, name);
  const temporary = path.join(directory, `.${name}.${randomUUID()}.partial`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  let handle: number | undefined;
  try {
    handle = openSync(temporary, 'wx', 0o600);
    writeAll(handle, bytes);
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    linkSync(temporary, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      const reason = diagnoseExistingReport(directory, name);
      throw new Error(reason ?? 'PRE_EXISTING_REPORT_APPEARED');
    }
    throw error;
  } finally {
    if (handle !== undefined) closeSync(handle);
    try {
      unlinkSync(temporary);
    } catch {
      // A temporary we cannot remove is still not a reason to touch the committed target.
    }
  }
  const final = lstatSync(target);
  if (!final.isFile() || final.isSymbolicLink() || final.nlink !== 1) throw new Error('COMMIT_IDENTITY_UNVERIFIED');
  if (!readFileSync(target).equals(bytes)) throw new Error('COMMIT_BYTES_UNVERIFIED');
  return target;
}
