import {expect,it,vi} from 'vitest';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import type {ProbeDeclaration} from '../../../packages/contracts/src/index.js';
import {validateSchema} from '../../../packages/contracts/src/index.js';
import {evaluateDeclaration} from '../../../packages/core/src/services/probe-assertions.js';
import {withTestDirectory} from '../../support/test-paths.js';

// SG-054: every case drives a real loopback listener and records what actually happened. Unauthorized
// targets are proven by an observed request count, not by a log line.
vi.setConfig({testTimeout:240000});

const apiRoot = path.resolve('examples/contract-drift-demo/apps/api');
const declarationFile = path.resolve('examples/contract-drift-demo/probes/performance.json');
const confirmed = JSON.parse(await fs.readFile(declarationFile, 'utf8')) as ProbeDeclaration;
const python = process.platform === 'win32' ? 'python' : 'python3';
const baseEnv: NodeJS.ProcessEnv = {
  SystemRoot: process.env.SystemRoot ?? '', PATH: process.env.PATH ?? '', TEMP: process.env.TEMP ?? '',
  TMP: process.env.TMP ?? '', APPDATA: process.env.APPDATA ?? '', PYTHONIOENCODING: 'utf-8',
};
const identity = {
  STACKGATE_RUN_ID: 'run_probe_http', STACKGATE_CHECK_ID: 'runtime_probe',
  STACKGATE_ATTEMPT_ID: 'attempt_probe_http_1', STACKGATE_REQUEST_ID: 'request_performance_1',
};

async function withListener<R>(handler: (request: http.IncomingMessage, response: http.ServerResponse, state: {count: number}) => void,
  work: (port: number, state: {count: number}) => Promise<R>): Promise<R> {
  const state = {count: 0};
  const server = http.createServer((request, response) => {state.count++;handler(request, response, state);});
  server.on('connection', socket => server.once('close', () => socket.destroy()));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await work(port, state);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function unusedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

const jsonHandler = (payload: unknown, status = 200) =>
  (request: http.IncomingMessage, response: http.ServerResponse) => {
    const body = `${JSON.stringify(payload)}\n`;
    response.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(body)});
    response.end(body);
  };

async function runProbe(output: string, env: Record<string, string>) {
  await fs.mkdir(output, {recursive: true});
  return new Promise<{code: number | null; stdout: string; stderr: string}>(resolve => {
    const child = spawn(python, ['-B', '-E', 'scripts/probe_performance.py'], {
      cwd: apiRoot,
      env: {...baseEnv, STACKGATE_OUTPUT_DIR: output, STACKGATE_PROBE_DECLARATION: declarationFile, ...identity, ...env},
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => {stdout += chunk.toString();});
    child.stderr.on('data', chunk => {stderr += chunk.toString();});
    child.on('error', error => resolve({code: null, stdout, stderr: `${stdout}${error.message}`}));
    child.on('close', code => resolve({code, stdout, stderr}));
  });
}

async function errorReason(output: string): Promise<string> {
  return JSON.parse(await fs.readFile(path.join(output, 'probe-error.json'), 'utf8')).reason as string;
}

async function overrideDeclaration(root: string, overrides: Partial<ProbeDeclaration>) {
  const file = path.join(root, 'declaration.json');
  await fs.writeFile(file, `${JSON.stringify({...confirmed, ...overrides}, null, 2)}\n`);
  return file;
}

const recompute = (bytes: Buffer, raw: {status_code: number; media_type: string}) =>
  evaluateDeclaration(confirmed, JSON.parse(bytes.toString('utf8')), {status_code: raw.status_code, media_type: raw.media_type, truncated: false});

async function readReport(output: string) {
  const report = JSON.parse(await fs.readFile(path.join(output, 'probe.json'), 'utf8'));
  const raw = JSON.parse(await fs.readFile(path.join(output, 'probe-raw.json'), 'utf8'));
  const bytes = await fs.readFile(path.join(output, 'responses', `${raw.request_id}.json`));
  return {report, raw, bytes};
}

it('refuses a declared operation against a listener that is not there', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    const port = await unusedPort();
    const run = await runProbe(output, {
      STACKGATE_API_ORIGIN: `http://127.0.0.1:${port}`, STACKGATE_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    });
    expect(run.code).toBe(2);
    expect(await errorReason(output)).toBe('CONNECT_FAILED');
    expect(await fs.readFile(path.join(output, 'probe.json')).catch(() => null)).toBeNull();
  });
});

it('sends zero requests when the target origin is not one of the authorized bindings', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    const allowed = await unusedPort();
    await withListener(jsonHandler({data: {performance: {total_return: 0.1234, period: '2026-Q3'}}}), async (port, state) => {
      const run = await runProbe(output, {
        STACKGATE_API_ORIGIN: `http://127.0.0.1:${port}`, STACKGATE_ALLOWED_ORIGINS: `http://127.0.0.1:${allowed}`,
      });
      expect(run.code).toBe(2);
      expect(await errorReason(output)).toBe('ORIGIN_NOT_AUTHORIZED');
      expect(state.count, 'the probe must not touch an unlisted origin').toBe(0);
    });
  });
});

it('records a real successful probe and lets the core recompute the same assertions', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    await withListener(jsonHandler({data: {performance: {total_return: 0.1234, period: '2026-Q3'}}}), async (port, state) => {
      const run = await runProbe(output, {
        STACKGATE_API_ORIGIN: `http://127.0.0.1:${port}`, STACKGATE_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
      });
      expect(run.code, run.stderr).toBe(0);
      expect(state.count).toBe(1);
      const {report, raw, bytes} = await readReport(output);
      expect(report.operations[0]).toMatchObject({status_code: 200, media_type: 'application/json'});
      expect(report.operations[0].assertions.every((item: {passed: boolean}) => item.passed)).toBe(true);
      expect(validateSchema('probe', report).ok).toBe(true);
      expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(raw.response_digest);
      const recomputed = recompute(bytes, raw);
      expect(recomputed.failed).toBe(0);
      expect(recomputed.status_ok && recomputed.media_type_ok).toBe(true);
    });
  });
});

it('does not promote a self-reported schema_valid over a recomputed type mismatch', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    await withListener(jsonHandler({data: {performance: {total_return: '0.1234', period: '2026-Q3'}}}), async (port, state) => {
      const run = await runProbe(output, {
        STACKGATE_API_ORIGIN: `http://127.0.0.1:${port}`, STACKGATE_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
      });
      expect(run.code).toBe(1);
      expect(state.count).toBe(1);
      const {report, raw, bytes} = await readReport(output);
      expect(report.operations[0].schema_valid, 'the probe still claims the schema is valid').toBe(true);
      const recomputed = recompute(bytes, raw);
      expect(recomputed.failed).toBeGreaterThan(0);
      expect(recomputed.outcomes.find(item => item.assertion_id === 'total-return-type')?.reason).toBe('TYPE_MISMATCH');
      expect(recomputed.outcomes.find(item => item.assertion_id === 'total-return-value')?.reason).toBe('VALUE_MISMATCH');
    });
  });
});

it('refuses a redirect instead of following it to another origin', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    const otherPort = await unusedPort();
    let followed = 0;
    const second = http.createServer(() => {followed++;});
    second.on('connection', socket => second.once('close', () => socket.destroy()));
    await new Promise<void>(resolve => second.listen(otherPort, '127.0.0.1', resolve));
    try {
      await withListener((request, response) => {
        response.writeHead(302, {location: `http://127.0.0.1:${otherPort}/api/performance`});
        response.end();
      }, async (port, state) => {
        const run = await runProbe(output, {
          STACKGATE_API_ORIGIN: `http://127.0.0.1:${port}`, STACKGATE_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
        });
        expect(run.code).toBe(2);
        expect(await errorReason(output)).toBe('REDIRECT_REFUSED');
        expect(state.count).toBe(1);
        expect(followed, 'the redirect target must never be contacted').toBe(0);
      });
    } finally {
      second.closeAllConnections();
      await new Promise<void>(resolve => second.close(() => resolve()));
    }
  });
});

it('stops at the declared response budget and at the deadline instead of buffering', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'budget');
    const small = await overrideDeclaration(root, {max_response_bytes: 32});
    await withListener(jsonHandler({data: {performance: {total_return: 0.1234, period: 'a'.repeat(4096)}}}), async port => {
      const run = await runProbe(output, {
        STACKGATE_API_ORIGIN: `http://127.0.0.1:${port}`, STACKGATE_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
        STACKGATE_PROBE_DECLARATION: small,
      });
      expect(run.code).toBe(2);
      expect(await errorReason(output)).toBe('RESPONSE_OVER_BUDGET');
    });
    const stalled = path.join(root, 'deadline');
    const quick = await overrideDeclaration(root, {deadline_ms: 300});
    await withListener(() => undefined, async port => {
      const run = await runProbe(stalled, {
        STACKGATE_API_ORIGIN: `http://127.0.0.1:${port}`, STACKGATE_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
        STACKGATE_PROBE_DECLARATION: quick,
      });
      expect(run.code).toBe(2);
      expect(await errorReason(stalled)).toBe('DEADLINE_EXCEEDED');
    });
  });
});
