import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertNoCompletedReport, reporterIdentity, stableTestId, UNANNOTATED_TEST_ID } from './inventory.js';

/**
 * Collects the real Playwright run into the versioned `playwright-report` protocol.
 *
 * Every callback is defensive: a throwing reporter must still leave a diagnosable, incomplete artifact
 * instead of letting a framework exit code 0 look like a verified pass.
 */
type StatusString = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
interface InventoryEntry { test_id: string; title: string; file: string; line: number; annotations: {type: string; description: string}[]; only: boolean }
interface Attachment { name: string; relative_path: string; media_type: string; sensitivity: 'regular' | 'restricted' }
interface AttemptEntry { test_id: string; retry: number; expected_status: StatusString; actual_status: StatusString; duration_ms: number; attachments: Attachment[]; errors: string[] }

interface ReporterOptions { name?: string; identity?: ReturnType<typeof reporterIdentity> }

export default class StackGateReporter {
  private readonly reportFile: string;
  private readonly directory: string | null;
  private readonly identity: ReturnType<typeof reporterIdentity>;
  private startedAt: string | null = null;
  private inventory: InventoryEntry[] = [];
  private attempts: AttemptEntry[] = [];
  private requests: unknown[] = [];
  private consoleLines: {test_id: string; level: 'log' | 'info' | 'warning' | 'error'; message: string; redaction_state: 'REDACTED' | 'NOT_REQUIRED'}[] = [];
  private failures = 0;
  private interrupted = false;
  private diagnostics: string[] = [];

  constructor(options: ReporterOptions = {}) {
    this.identity = options.identity ?? reporterIdentity(process.env);
    this.reportFile = options.name ?? 'playwright.json';
    this.directory = 'output_dir' in this.identity ? this.identity.output_dir : null;
    if (this.directory) {
      try {
        assertNoCompletedReport(this.directory, this.reportFile);
      } catch (error) {
        this.diagnostics.push(`PRE_EXISTING_REPORT:${(error as Error).message}`);
      }
    } else {
      this.diagnostics.push(`IDENTITY_REJECTED:${'error' in this.identity ? this.identity.error : 'unknown'}`);
    }
  }

  onBegin(_config: unknown, suite: { allTests?: () => { title: string; titlePath: () => string[]; location?: {file: string; line: number}; annotations?: {type: string; description: string}[]; only?: boolean; expectedStatus?: string }[] }) {
    this.startedAt = new Date().toISOString();
    try {
      this.inventory = (suite.allTests?.() ?? []).map(test => {
        const annotations = test.annotations ?? [];
        const {test_id} = stableTestId(annotations);
        const location = test.location ?? {file: 'unknown', line: 1};
        return {
          test_id,
          title: test.titlePath().slice(1).join(' > ') || test.title,
          file: path.relative(process.cwd(), location.file).replaceAll('\\', '/'),
          line: Number(location.line) || 1,
          annotations: annotations.map(item => ({type: String(item.type), description: String(item.description ?? '')})),
          only: Boolean(test.only),
        };
      });
    } catch (error) {
      this.diagnostics.push(`ONBEGIN_FAILED:${(error as Error).message}`);
    }
  }

  onTestEnd(test: { title: string; titlePath: () => string[]; location?: {file: string; line: number}; annotations?: {type: string; description: string}[]; expectedStatus?: string; repeatEachIndex?: number },
    result: { status?: string; retries?: number; duration?: number; error?: {message?: string}; errors?: {message?: string}[]; attachments?: {name: string; contentType?: string; path?: string; body?: Buffer}[] }) {
    try {
      const {test_id} = stableTestId(test.annotations ?? []);
      const retry = Number(result.retries ?? 0);
      const actual = normalizeStatus(result.status);
      const expected = normalizeStatus(test.expectedStatus ?? 'passed');
      if (actual === 'failed' || actual === 'timedOut' || actual === 'interrupted') this.failures++;
      this.attempts.push({
        test_id,
        retry,
        expected_status: expected,
        actual_status: actual,
        duration_ms: Math.max(0, Math.round(Number(result.duration ?? 0))),
        attachments: (result.attachments ?? []).map(item => ({
          name: String(item.name),
          relative_path: item.path ? path.relative(this.directory ?? process.cwd(), item.path).replaceAll('\\', '/') : `attachments/${test_id}-${retry}-${slug(item.name)}`,
          media_type: String(item.contentType ?? 'application/octet-stream'),
          sensitivity: sensitivityFor(item.contentType),
        })),
        errors: collectErrors(result).map(message => truncate(redact(message))),
      });
      const output = result.attachments?.find(item => item.name === 'stackgate-requests');
      if (output?.path) {
        try {
          const parsed = JSON.parse(require('node:fs').readFileSync(output.path, 'utf8'));
          if (Array.isArray(parsed)) this.requests = [...this.requests, ...parsed];
        } catch (error) {
          this.diagnostics.push(`REQUEST_COLLECTION_FAILED:${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.diagnostics.push(`ONTESTEND_FAILED:${(error as Error).message}`);
    }
  }

  onError(error: {message?: string; location?: unknown}) {
    this.interrupted = true;
    this.diagnostics.push(`FRAMEWORK_ERROR:${truncate(redact(error?.message ?? 'unknown'))}`);
  }

  onEnd(result: {status?: string}) {
    try {
      const document = this.build(result.status);
      if (!this.directory) return;
      mkdirSync(this.directory, {recursive: true});
      const target = path.join(this.directory, this.reportFile);
      const temporary = path.join(this.directory, `.${this.reportFile}.partial`);
      writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      renameSync(temporary, target);
    } catch (error) {
      this.diagnostics.push(`ONEND_FAILED:${(error as Error).message}`);
      try {
        if (this.directory) {
          mkdirSync(this.directory, {recursive: true});
          writeFileSync(path.join(this.directory, 'playwright-reporter-error.json'),
            `${JSON.stringify({schema_version: '0.1', diagnostics: this.diagnostics}, null, 2)}\n`, 'utf8');
        }
      } catch { /* the collector still has to see a missing completed report */ }
    }
  }

  build(status: string | undefined) {
    const ended = new Date().toISOString();
    const ids = new Set(this.inventory.map(entry => entry.test_id));
    return {
      schema_version: '0.1' as const,
      kind: 'stackgate-playwright' as const,
      run_id: 'run_id' in this.identity ? this.identity.run_id : 'run_invalid',
      check_id: 'check_id' in this.identity ? this.identity.check_id : 'invalid',
      attempt_id: 'attempt_id' in this.identity ? this.identity.attempt_id : 'attempt_invalid',
      started_at: this.startedAt ?? ended,
      ended_at: ended,
      completed: this.diagnostics.length === 0 && this.startedAt !== null && ids.size > 0,
      status: normalizeStatus(this.interrupted ? 'interrupted' : status ?? (this.failures ? 'failed' : 'passed')),
      inventory: this.inventory,
      attempts: this.attempts,
      requests: this.requests,
      console: this.consoleLines,
      diagnostics: this.diagnostics,
    };
  }
}

function normalizeStatus(value: string | undefined): StatusString {
  const allowed: StatusString[] = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
  return (allowed as string[]).includes(value ?? '') ? (value as StatusString) : 'interrupted';
}

function sensitivityFor(contentType: string | undefined): 'regular' | 'restricted' {
  if (!contentType) return 'restricted';
  return contentType.startsWith('image/') || contentType.includes('trace') || contentType.includes('video') ? 'restricted' : 'regular';
}

function collectErrors(result: {error?: {message?: string}; errors?: {message?: string}[]}): string[] {
  const messages = (result.errors ?? []).map(item => item?.message ?? '').filter(Boolean);
  if (!messages.length && result.error?.message) messages.push(result.error.message);
  return messages;
}

const SECRET_PATTERN = /(?:authorization|cookie|token|secret|password)\s*[:=]\s*\S+/gi;
function redact(message: string): string {
  return message.replace(SECRET_PATTERN, match => `${match.split(/[:=]/)[0]}=[REDACTED]`);
}
const truncate = (message: string) => (message.length > 2000 ? `${message.slice(0, 2000)}…` : message);
const slug = (value: string) => value.replaceAll(/[^A-Za-z0-9._-]+/g, '-').slice(0, 64);
export { UNANNOTATED_TEST_ID };
