import {expect, it, vi} from 'vitest';
import {spawn} from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import type {ProbeDeclaration} from '../../../packages/contracts/src/index.js';
import {withTestDirectory} from '../../support/test-paths.js';

// V2-R03: the total deadline, the proxy boundary and the artifact commit rules are observed from outside the
// process that performs the request. Every case spawns a real Python child against a real loopback listener;
// nothing below is a mock standing in for execution. The child environment is replaced rather than inherited,
// so a proxy variable can only be present because a case below put it there, and only inside that one child:
// the user's own environment and system proxy configuration is never read, changed or cleared here, and every
// address is 127.0.0.1.
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
  STACKGATE_RUN_ID: 'run_v2_r03', STACKGATE_CHECK_ID: 'runtime_probe',
  STACKGATE_ATTEMPT_ID: 'attempt_v2_r03_1', STACKGATE_REQUEST_ID: 'request_v2_r03_1',
};
const declaredPayload = {data: {performance: {total_return: 0.1234, period: '2026-Q3'}}};
const jsonBytes = Buffer.from(`${JSON.stringify(declaredPayload)}\n`, 'utf8');
// Long enough that one byte per 20 ms cannot finish inside any deadline this file uses, and still valid JSON
// that the confirmed declaration's assertions pass against: the defect being reproduced is a wrong *success*.
const dripBytes = Buffer.from(`${JSON.stringify({...declaredPayload, padding: 'v2r03slowdrip'.repeat(14)})}\n`, 'utf8');
const CANARY = 'v2r03canary';

type Run = {code: number | null; stdout: string; stderr: string; elapsed_ms: number};

async function runProbe(output: string, env: Record<string, string>): Promise<Run> {
  // A case may deliberately point at a path storage cannot provide; a failed mkdir there is the fact under
  // test, so it must reach the child process instead of aborting the harness.
  await fs.mkdir(output, {recursive: true}).catch(() => undefined);
  const started = Date.now();
  const result = await new Promise<Omit<Run, 'elapsed_ms'>>(resolve => {
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
  return {...result, elapsed_ms: Date.now() - started};
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  return text === null ? null : JSON.parse(text) as Record<string, unknown>;
}

async function errorReason(output: string): Promise<string | null> {
  const document = await readJson(path.join(output, 'probe-error.json'));
  return document === null ? null : String(document.reason);
}

/** Relative path -> `bytes:mtime`, so a same-size rewrite of an existing artifact stays visible. */
async function fingerprintTree(root: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, {withFileTypes: true}).catch(() => [])) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {await walk(path.join(directory, entry.name), relative); continue;}
      const stat = await fs.stat(path.join(directory, entry.name));
      found[relative] = `${stat.size}:${Math.round(stat.mtimeMs)}`;
    }
  };
  await walk(root, '');
  return found;
}

/** Independent liveness probe for a process this file did not spawn: signal 0 only asks whether it exists. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as {code?: string}).code !== 'ESRCH';
  }
}

async function unusedPort(): Promise<number> {
  const probe = net.createServer(socket => socket.destroy());
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

type RawState = {requests: number; requestLine: string; requestText: string; bytesReceived: number; closed: boolean};
type Responder = (socket: net.Socket, state: RawState, track: (timer: NodeJS.Timeout) => void) => void;

/**
 * A loopback listener that answers at the byte level, so a case can withhold the status line, drip a body one
 * byte at a time, or push more bytes than the response budget. It keeps the exact request bytes it received.
 */
async function withRawListener<R>(respond: Responder, work: (port: number, state: RawState) => Promise<R>): Promise<R> {
  const state: RawState = {requests: 0, requestLine: '', requestText: '', bytesReceived: 0, closed: false};
  const timers = new Set<NodeJS.Timeout>();
  const sockets = new Set<net.Socket>();
  const track = (timer: NodeJS.Timeout): void => {timers.add(timer);};
  const server = net.createServer(socket => {
    state.requests++;
    sockets.add(socket);
    let buffered = '';
    let answered = false;
    socket.on('error', () => undefined);
    socket.on('data', chunk => {
      state.bytesReceived += chunk.length;
      if (answered) return;
      buffered += chunk.toString('latin1');
      const end = buffered.indexOf('\r\n\r\n');
      if (end < 0) return;
      answered = true;
      state.requestText = buffered.slice(0, end);
      state.requestLine = state.requestText.split('\r\n')[0] ?? '';
      respond(socket, state, track);
    });
    socket.on('close', () => {state.closed = true; sockets.delete(socket);});
  });
  server.on('connection', socket => server.once('close', () => socket.destroy()));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await work(port, state);
  } finally {
    for (const timer of timers) clearInterval(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function statusLine(status: string, headers: Record<string, unknown>): string {
  const lines = [`HTTP/1.1 ${status}`];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${String(value)}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
}

const originFor = (port: number): string => `http://127.0.0.1:${port}`;
const targetEnv = (port: number, declaration: string): Record<string, string> => ({
  STACKGATE_API_ORIGIN: originFor(port), STACKGATE_ALLOWED_ORIGINS: originFor(port),
  STACKGATE_PROBE_DECLARATION: declaration,
});

async function overrideDeclaration(root: string, name: string, overrides: Partial<ProbeDeclaration>): Promise<string> {
  const file = path.join(root, `${name}.json`);
  await fs.writeFile(file, `${JSON.stringify({...confirmed, ...overrides}, null, 2)}\n`);
  return file;
}

const jsonResponder: Responder = socket => {
  socket.write(statusLine('200 OK', {'content-type': 'application/json', 'content-length': jsonBytes.length}));
  socket.end(jsonBytes);
};

/** One byte every `intervalMs`, sustained for at least `durationMs`; `progress` reports what left the socket. */
function dripResponder(body: Buffer, intervalMs: number, durationMs: number, progress: {sent: number}): Responder {
  return (socket, _state, track) => {
    socket.write(statusLine('200 OK', {'content-type': 'application/json', 'content-length': body.length}));
    let sent = 0;
    const started = Date.now();
    const timer = setInterval(() => {
      if (socket.destroyed || socket.writableEnded) {clearInterval(timer); return;}
      if (Date.now() - started >= durationMs || sent >= body.length) {
        clearInterval(timer);
        socket.end();
        return;
      }
      socket.write(body.subarray(sent, sent + 1));
      sent++;
      progress.sent = sent;
    }, intervalMs);
    track(timer);
  };
}

type Observation = {
  code: number | null; stdout: string; stderr: string; elapsed_ms: number;
  reason: string | null; completed: boolean; has_report: boolean;
  worker_pid: number | null; worker_reclaimed: boolean | null; worker_killed: boolean | null;
  worker_alive_after: boolean | null;
  spawned: boolean | null; pipes_closed: boolean | null; reap_mechanism: string | null;
  reader_is_spawned_handle: boolean | null;
  requests_at_exit: number; requests_after_settle: number;
  drip_bytes_sent: number; server_closed: boolean;
  fingerprints_at_exit: Record<string, string>; fingerprints_after_settle: Record<string, string>;
};

function flag(document: Record<string, unknown> | null, name: string): boolean | null {
  if (document === null || typeof document[name] !== 'boolean') return null;
  return document[name] as boolean;
}

function text(document: Record<string, unknown> | null, name: string): string | null {
  if (document === null || typeof document[name] !== 'string') return null;
  return document[name] as string;
}

/**
 * The counterexample the audit measured: a listener that drips the body one byte at a time long past the
 * product deadline. This helper really starts the listener, really runs the Python entry point, really reads
 * the artifacts and the process table back, and reclaims everything it created.
 */
async function runSlowDripProbe(input: {deadline_ms: number; interval_ms: number; duration_ms: number}): Promise<Observation> {
  return await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    const declaration = await overrideDeclaration(root, 'drip-declaration', {deadline_ms: input.deadline_ms});
    const progress = {sent: 0};
    return await withRawListener(dripResponder(dripBytes, input.interval_ms, input.duration_ms, progress), async (port, state) => {
      const run = await runProbe(output, targetEnv(port, declaration));
      const fingerprintsAtExit = await fingerprintTree(output);
      const report = await readJson(path.join(output, 'probe.json'));
      const worker = await readJson(path.join(output, 'probe-worker.json'));
      const workerPid = worker !== null && typeof worker.worker_pid === 'number' ? worker.worker_pid : null;
      const readerPid = worker !== null && typeof worker.worker_reader_pid === 'number' ? worker.worker_reader_pid : null;
      const requestsAtExit = state.requests;
      // Look again while the listener is still dripping: a surviving worker would keep pulling bytes.
      await new Promise<void>(resolve => setTimeout(resolve, 400));
      return {
        ...run,
        reason: await errorReason(output),
        completed: report !== null && report.completed === true,
        has_report: report !== null,
        worker_pid: workerPid,
        worker_reclaimed: flag(worker, 'reclaimed'),
        worker_killed: flag(worker, 'killed'),
        worker_alive_after: workerPid === null ? null : processAlive(workerPid),
        spawned: flag(worker, 'spawned'),
        pipes_closed: flag(worker, 'pipes_closed'),
        reap_mechanism: text(worker, 'reap_mechanism'),
        reader_is_spawned_handle: workerPid === null || readerPid === null ? null : readerPid === workerPid,
        requests_at_exit: requestsAtExit,
        requests_after_settle: state.requests,
        drip_bytes_sent: progress.sent,
        server_closed: state.closed,
        fingerprints_at_exit: fingerprintsAtExit,
        fingerprints_after_settle: await fingerprintTree(output),
      };
    });
  });
}

const summary = (observed: Observation): string => JSON.stringify({...observed,
  fingerprints_at_exit: Object.keys(observed.fingerprints_at_exit),
  fingerprints_after_settle: Object.keys(observed.fingerprints_after_settle)});

it('ends a 100 ms total deadline against a 20 ms drip instead of completing the body', async () => {
  const observed = await runSlowDripProbe({deadline_ms: 100, interval_ms: 20, duration_ms: 2500});
  console.log('V2-R03 slow-drip deadline_ms=100:', summary(observed));
  expect(observed.reason, summary(observed)).toBe('DEADLINE_EXCEEDED');
  expect(observed.completed, summary(observed)).toBe(false);
  expect(observed.has_report, `a request-level failure must not leave a success report: ${summary(observed)}`).toBe(false);
  // 1000 ms is only the harness scheduling ceiling; the product deadline under test stays at 100 ms.
  expect(observed.elapsed_ms, `harness ceiling, measured ${summary(observed)}`).toBeLessThan(1000);
  expect(observed.elapsed_ms, `the deadline must land before the 2500 ms drip window: ${summary(observed)}`)
    .toBeLessThan(2500);
  expect(observed.worker_alive_after, summary(observed)).toBe(false);
  // Reclamation is a chain of measured facts, not a report the parent is asked to trust: the worker really
  // started, the reader inside it is the process the parent holds a handle to, the pipes reached end of file,
  // the wait was on that handle, and an unrelated observer looking at the process table agrees.
  expect(observed.spawned, summary(observed)).toBe(true);
  // Whenever the reader got to answer, its own pid has to be the handle the parent waited on. A worker
  // terminated before it could answer reports nothing about itself, which is recorded as absent rather than
  // as a claim.
  expect(observed.reader_is_spawned_handle, 'a reader that answered is the process that was terminated')
    .not.toBe(false);
  expect(observed.pipes_closed, summary(observed)).toBe(true);
  expect(observed.reap_mechanism, summary(observed)).toBe('subprocess.wait on the handle this process created');
  expect(observed.worker_reclaimed, 'the parent must prove the worker it created is gone').toBe(true);
  expect(observed.fingerprints_after_settle).toEqual(observed.fingerprints_at_exit);
  expect(observed.requests_after_settle, 'no further request may leave a reclaimed worker').toBe(observed.requests_at_exit);
});

it('terminates and reclaims the worker mid-request, with nothing reading afterwards', async () => {
  // One millisecond cannot cover a second interpreter start, so this is the path where the parent has to
  // terminate a live worker and wait for the handle it created - not a worker answering on its own timeout.
  const observed = await runSlowDripProbe({deadline_ms: 1, interval_ms: 20, duration_ms: 2000});
  console.log('V2-R03 terminate-and-reap deadline_ms=1:', summary(observed));
  expect(observed.reason, summary(observed)).toBe('DEADLINE_EXCEEDED');
  expect(observed.has_report).toBe(false);
  expect(observed.spawned, 'a worker was started, so there is something to reclaim').toBe(true);
  expect(observed.worker_killed, summary(observed)).toBe(true);
  expect(observed.pipes_closed, 'the pipes close only once nothing downstream holds them').toBe(true);
  expect(observed.reap_mechanism).toBe('subprocess.wait on the handle this process created');
  expect(observed.worker_reclaimed).toBe(true);
  expect(observed.worker_alive_after, 'no process created by this request survives it').toBe(false);
  expect(observed.fingerprints_after_settle).toEqual(observed.fingerprints_at_exit);
});

it('cancels a read that is already in progress, mid-body', async () => {
  // A deadline wide enough to cover two interpreter starts, so the worker is genuinely inside the body read
  // when the budget expires: the case a per-read socket timeout alone cannot bound.
  const observed = await runSlowDripProbe({deadline_ms: 900, interval_ms: 20, duration_ms: 3000});
  console.log('V2-R03 mid-body cancel deadline_ms=900:', summary(observed));
  expect(observed.reason, summary(observed)).toBe('DEADLINE_EXCEEDED');
  expect(observed.completed).toBe(false);
  expect(observed.has_report).toBe(false);
  expect(observed.requests_at_exit, 'the request must actually have reached the listener').toBe(1);
  expect(observed.drip_bytes_sent, `the read must stop inside the budget, measured ${summary(observed)}`)
    .toBeLessThan(100);
  expect(observed.server_closed, 'the connection must go away with the worker').toBe(true);
  expect(observed.worker_alive_after).toBe(false);
  expect(observed.spawned).toBe(true);
  expect(observed.reader_is_spawned_handle, 'a reader that answered is the process that was terminated')
    .not.toBe(false);
  expect(observed.pipes_closed).toBe(true);
  expect(observed.reap_mechanism).toBe('subprocess.wait on the handle this process created');
  expect(observed.worker_reclaimed).toBe(true);
  // The reclamation facts above are the deadline's own proof. What the worker could otherwise inherit -
  // an active virtual environment, a proxy in the caller's environment - is isolation's scope and is asserted
  // there, from the reader's own prefix and environment projection in the same artifact.
  // The drip window is 3000 ms and the body needs dripBytes.length*20 ms to arrive; waiting it out is the bug.
  expect(observed.elapsed_ms, summary(observed)).toBeLessThan(2000);
});

it('hits the total deadline when the server never sends a status line', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    const declaration = await overrideDeclaration(root, 'headers-declaration', {deadline_ms: 700});
    await withRawListener(() => undefined, async (port, state) => {
      const run = await runProbe(output, targetEnv(port, declaration));
      const reason = await errorReason(output);
      console.log('V2-R03 withheld status line:', JSON.stringify({...run, reason, requestLine: state.requestLine}));
      expect(run.code, run.stderr).toBe(2);
      expect(reason).toBe('DEADLINE_EXCEEDED');
      expect(state.requestLine, 'the request went out and was then left hanging').toBe('GET /api/performance HTTP/1.1');
      expect(await readJson(path.join(output, 'probe.json'))).toBeNull();
      expect(run.elapsed_ms, 'a withheld status line must not stretch past the total deadline').toBeLessThan(1800);
      expect(await readJson(path.join(output, 'probe-worker.json'))).not.toBeNull();
    });
  });
});

it('bounds an oversized error-response body and writes no success artifact', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    const declaration = await overrideDeclaration(root, 'error-declaration', {max_response_bytes: 32});
    const oversized = Buffer.from('x'.repeat(2 * 1024 * 1024), 'utf8');
    await withRawListener(socket => {
      socket.write(statusLine('500 Internal Server Error', {'content-type': 'application/json',
        'content-length': oversized.length}));
      socket.on('error', () => undefined);
      socket.write(oversized);
      socket.end();
    }, async (port, state) => {
      const run = await runProbe(output, targetEnv(port, declaration));
      const fingerprints = await fingerprintTree(output);
      console.log('V2-R03 oversized 500 body:', JSON.stringify({...run, reason: await errorReason(output),
        files: Object.keys(fingerprints), requests: state.requests, bytesReceived: state.bytesReceived}));
      expect(run.code, run.stderr).toBe(2);
      expect(await errorReason(output)).toBe('RESPONSE_OVER_BUDGET');
      expect(fingerprints['probe.json'], 'an error response must not be reported as complete').toBeUndefined();
      expect(fingerprints['probe-raw.json']).toBeUndefined();
      expect(Object.keys(fingerprints).some(name => name.startsWith('responses/')),
        'an over-budget error body must not be filed as a response').toBe(false);
      expect(run.elapsed_ms).toBeLessThan(5000);
    });
  });
});

it('refuses an unsupported Content-Encoding instead of re-serializing the body', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    const declaration = await overrideDeclaration(root, 'encoding-declaration', {});
    await withRawListener(socket => {
      socket.write(statusLine('200 OK', {'content-type': 'application/json', 'content-encoding': 'gzip',
        'content-length': jsonBytes.length}));
      socket.end(jsonBytes);
    }, async (port, state) => {
      const run = await runProbe(output, targetEnv(port, declaration));
      const reason = await errorReason(output);
      console.log('V2-R03 unsupported content-encoding:', JSON.stringify({...run, reason,
        requestLine: state.requestLine}));
      expect(run.code, run.stderr).toBe(2);
      expect(reason).toBe('CONTENT_ENCODING_UNSUPPORTED');
      expect(await readJson(path.join(output, 'probe.json'))).toBeNull();
    });
  });
});

it('sends zero requests to an environment proxy and keeps the authorized origin as the route', async () => {
  await withTestDirectory(async root => {
    const output = path.join(root, 'attempt');
    const declaration = await overrideDeclaration(root, 'proxy-declaration', {deadline_ms: 2000});
    // `no_proxy` deliberately does not name the target: a bypass would hide the defect instead of fixing it.
    const proxyEnv = (port: number): Record<string, string> => {
      const url = `http://${CANARY}:fabricated@127.0.0.1:${port}`;
      return {http_proxy: url, HTTP_PROXY: url, https_proxy: url, all_proxy: url, no_proxy: '10.99.99.99'};
    };
    const proxy = {requests: 0, requestText: '', bytesReceived: 0, closed: false, requestLine: ''};
    const proxySockets = new Set<net.Socket>();
    const proxyServer = net.createServer(socket => {
      proxy.requests++;
      proxySockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('data', chunk => {
        proxy.bytesReceived += chunk.length;
        proxy.requestText += chunk.toString('latin1');
        proxy.requestLine = proxy.requestText.split('\r\n')[0] ?? '';
      });
      socket.on('close', () => proxySockets.delete(socket));
    });
    await new Promise<void>(resolve => proxyServer.listen(0, '127.0.0.1', resolve));
    const proxyPort = (proxyServer.address() as AddressInfo).port;
    try {
      // Both the lower-case and the upper-case form, plus the TLS and the aggregate variable: urllib consults
      // all of them through the default ProxyHandler.
      const run = await withRawListener(jsonResponder, async (port, state) => ({
        run: await runProbe(output, {...targetEnv(port, declaration), ...proxyEnv(proxyPort)}),
        target: state,
      }));
      console.log('V2-R03 environment proxy:', JSON.stringify({
        code: run.run.code, elapsed_ms: run.run.elapsed_ms, proxyRequests: proxy.requests,
        proxyRequestLine: proxy.requestLine, targetRequestLine: run.target.requestLine,
        targetBytesReceived: run.target.bytesReceived, reason: await errorReason(output),
      }));
      expect(proxy.requests, `an unlisted proxy must never be contacted, saw ${proxy.requestLine}`).toBe(0);
      expect(run.target.requests, 'the authorized origin is the only route').toBe(1);
      expect(run.target.requestLine).toBe('GET /api/performance HTTP/1.1');
      expect(run.target.requestText.toLowerCase(), 'no proxy credential may be inherited')
        .not.toContain(CANARY);
      expect(run.target.requestText.toLowerCase()).not.toContain('proxy-authorization');
      expect(run.run.code, run.run.stderr).toBe(0);
      expect(await errorReason(output)).toBeNull();
      expect(await readJson(path.join(output, 'probe.json'))).not.toBeNull();
      // On the path where the worker does answer, the reader inside it is the process the parent created: the
      // handle it waits on and the handle it may terminate are the same object.
      const worker = await readJson(path.join(output, 'probe-worker.json'));
      expect(worker, 'a successful attempt still records what happened to its worker').not.toBeNull();
      expect(worker?.worker_reader_pid).toBe(worker?.worker_pid);
      expect(worker?.spawned).toBe(true);
      expect(worker?.killed).toBe(false);
      expect(worker?.reclaimed).toBe(true);
      expect(worker?.pipes_closed).toBe(true);
      expect(worker?.reap_mechanism).toBe('subprocess.wait on the handle this process created');
      expect(typeof worker?.worker_pid).toBe('number');
      expect(processAlive(worker?.worker_pid as number), 'the successful worker is gone too').toBe(false);
    } finally {
      for (const socket of proxySockets) socket.destroy();
      await new Promise<void>(resolve => proxyServer.close(() => resolve()));
    }
  });
});

it('keeps existing artifact bytes instead of overwriting a previous attempt', async () => {
  await withTestDirectory(async root => {
    const sentinel = '{"sentinel":"from-the-previous-attempt"}\n';
    const failure = path.join(root, 'attempt-failure');
    await fs.mkdir(failure, {recursive: true});
    await fs.writeFile(path.join(failure, 'probe-error.json'), sentinel);
    const port = await unusedPort();
    const refused = await runProbe(failure, {
      STACKGATE_API_ORIGIN: originFor(port), STACKGATE_ALLOWED_ORIGINS: originFor(port),
    });
    const preservedError = await fs.readFile(path.join(failure, 'probe-error.json'), 'utf8');
    console.log('V2-R03 no-replace on probe-error.json:', JSON.stringify({...refused, preserved: preservedError}));
    expect(preservedError, 'the previous attempt bytes must survive').toBe(sentinel);
    expect(refused.code, 'a blocked artifact commit is a tool/evidence error').toBe(3);
    expect(refused.stderr).toContain('ARTIFACT_EXISTS');

    const success = path.join(root, 'attempt-success');
    await fs.mkdir(success, {recursive: true});
    await fs.writeFile(path.join(success, 'probe.json'), sentinel);
    await withRawListener(jsonResponder, async target => {
      const run = await runProbe(success, targetEnv(target, declarationFile));
      const preservedReport = await fs.readFile(path.join(success, 'probe.json'), 'utf8');
      console.log('V2-R03 no-replace on probe.json:', JSON.stringify({...run, preserved: preservedReport.length}));
      expect(preservedReport, 'a new attempt may not replace a previous report').toBe(sentinel);
      expect(run.code, run.stderr).toBe(3);
      expect(await readJson(path.join(success, 'probe-raw.json')),
        'the raw facts are still recorded; only the completed success report is withheld').not.toBeNull();
    });
  });
});

/**
 * The boundaries a network listener cannot reach: what a frame may claim before it is refused instead of
 * trusted, what the worker may inherit, and what must be refused before any process exists. These cases call
 * the production functions and spawn the production worker for real, through the shared support module.
 */
it('holds the frame, escape, isolation and no-spawn boundaries when driven directly', async () => {
  const started = Date.now();
  const run = await new Promise<{code: number | null; stdout: string; stderr: string}>(resolve => {
    const child = spawn(python, ['-B', '-E', 'tests/support/v2_probe_worker_cases.py'], {
      cwd: path.resolve('.'), env: {...baseEnv, PYTHONIOENCODING: 'utf-8'},
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => {stdout += chunk.toString();});
    child.stderr.on('data', chunk => {stderr += chunk.toString();});
    child.on('error', error => resolve({code: null, stdout, stderr: `${stdout}${error.message}`}));
    child.on('close', code => resolve({code, stdout, stderr}));
  });
  expect(run.code, run.stderr).toBe(0);
  const groups = JSON.parse(run.stdout) as Record<string, Record<string, Record<string, unknown>>>;
  console.log('V2-R03 support-module cases:', JSON.stringify(groups).slice(0, 200), 'elapsed_ms', Date.now() - started);
  const raised = (group: string, name: string): string => String(groups[group]?.[name]?.code);
  const value = (group: string, name: string): unknown => groups[group]?.[name]?.value;

  expect(groups.caps?.frame_refuses_body_over_granted_cap?.raised).toBe(true);
  expect(raised('caps', 'frame_refuses_body_over_granted_cap')).toBe('FRAME_OVER_BUDGET');
  expect(raised('caps', 'frame_refuses_metadata_over_cap')).toBe('FRAME_OVER_BUDGET');
  expect(raised('caps', 'unframe_refuses_body_over_granted_cap')).toBe('WORKER_PROTOCOL_ERROR');
  expect(value('caps', 'round_trip_preserves_bytes_exactly')).toBe('True');
  expect(value('caps', 'frame_allows_body_at_exactly_the_cap')).toBe('True');

  for (const name of ['empty_answer', 'shorter_than_a_header', 'truncated_body', 'truncated_metadata',
    'trailing_bytes_after_frame', 'metadata_that_is_not_an_object', 'metadata_length_beyond_cap',
    'worker_rejects_a_shapeless_request']) {
    expect(groups.degenerate?.[name]?.raised, name).toBe(true);
    expect(raised('degenerate', name), name).toBe('WORKER_PROTOCOL_ERROR');
  }

  expect(groups.bounded?.per_read_never_exceeds_remaining_budget_plus_one).toBe(true);
  expect(groups.bounded?.per_read_sizes_shrink_with_the_budget).toEqual([101, 91, 81, 71]);
  expect(raised('bounded', 'over_budget_is_classified_after_the_first_byte_past')).toBe('RESPONSE_OVER_BUDGET');
  expect(groups.bounded?.over_budget_is_classified_after_the_first_byte_past?.detail).toBe('101');
  expect(raised('bounded', 'steady_trickle_hits_the_absolute_deadline')).toBe('DEADLINE_EXCEEDED');

  // A hand-written work order can only be declined, never performed: 8.8.8.8 and a named canary are refused
  // before the worker touches a socket, and the authorized shape is the only one that comes back usable.
  expect(raised('escape', 'external_ip_origin')).toBe('WORKER_ORIGIN_UNAUTHORIZED');
  expect(raised('escape', 'named_canary_origin')).toBe('WORKER_ORIGIN_UNAUTHORIZED');
  expect(raised('escape', 'url_escapes_the_authorized_origin')).toBe('WORKER_URL_ESCAPE');
  expect(raised('escape', 'declared_path_with_a_fragment')).toBe('WORKER_PATH_RULE');
  expect(raised('escape', 'budget_beyond_the_maximum')).toBe('WORKER_PROTOCOL_ERROR');
  expect(raised('escape', 'response_cap_beyond_the_maximum')).toBe('WORKER_PROTOCOL_ERROR');
  expect(groups.escape?.exactly_the_authorized_request?.raised).toBe(false);

  // The worker was started with a decoy on PYTHONPATH, an active virtual environment, proxies and fabricated
  // credentials in its environment, and still answered for the authorized loopback origin with the exact bytes.
  const isolation = groups.isolation ?? {};
  expect(isolation.answer?.returncode).toBe(0);
  expect(isolation.answer?.served_connections).toBe(1);
  expect(isolation.answer?.request_line).toBe('GET /api/performance HTTP/1.1');
  expect(isolation.answer?.body_is_the_original_bytes).toBe(true);
  expect(isolation.answer?.digest_matches_the_bytes_that_were_sent).toBe(true);
  expect(isolation.worker_environment_carries_no_interpretable_name).toBe(true);
  expect(isolation.worker_prefix_is_its_own_interpreter).toBe(true);
  expect(isolation.worker_imported_the_production_helper).toBe(true);
  expect(isolation.neutralized?.removed_count).toBeGreaterThan(0);
  expect(['unsupported', 'released', 'partial', 'refused'])
    .toContain(String(isolation.neutralized?.groups_release));

  // And when a launch cannot be proven beforehand, nothing is started to find out.
  expect(groups.no_spawn?.deadline_out_of_range?.spawned).toBe(false);
  expect(groups.no_spawn?.unprovable_launch?.spawned).toBe(false);
  expect(raised('no_spawn', 'deadline_out_of_range')).toBe('DEADLINE_OUT_OF_RANGE');
  expect(raised('no_spawn', 'unprovable_launch')).toBe('WORKER_NOT_PROVEN');
  expect(groups.no_spawn?.unprovable_launch?.launch_proofs).toMatchObject({worker_script_present: false});
}, 120000);

it('separates an unusable launch parameter from an artifact that cannot be committed', async () => {
  await withTestDirectory(async root => {
    const port = await unusedPort();
    const relative = await runProbe(path.join(root, 'attempt'), {
      STACKGATE_OUTPUT_DIR: 'relative/only', STACKGATE_PROBE_DECLARATION: declarationFile,
      STACKGATE_API_ORIGIN: originFor(port), STACKGATE_ALLOWED_ORIGINS: originFor(port),
    });
    const empty = await runProbe(path.join(root, 'attempt'), {
      STACKGATE_OUTPUT_DIR: '', STACKGATE_PROBE_DECLARATION: declarationFile,
      STACKGATE_API_ORIGIN: originFor(port), STACKGATE_ALLOWED_ORIGINS: originFor(port),
    });
    console.log('V2-R03 launch parameter errors:', JSON.stringify({relative, empty}));
    // A launch parameter that cannot be honoured is the reserved 64, caught at entry: no request, no worker.
    expect(relative.code, relative.stderr).toBe(64);
    expect(empty.code, empty.stderr).toBe(64);
    expect(relative.stderr).toContain('absolute STACKGATE_OUTPUT_DIR is required');
    expect(await fingerprintTree(root)).toEqual({});

    // An absolute directory the storage cannot provide is a different failure, and it surfaces after the
    // request has really been made: that is an evidence error, 3, not a parameter error.
    const blocker = path.join(root, 'afile');
    const blockerBytes = Buffer.from('not a directory\n', 'utf8');
    await fs.writeFile(blocker, blockerBytes);
    const unresolvable = path.join(blocker, 'attempt');
    await withRawListener(jsonResponder, async target => {
      const run = await runProbe(unresolvable, targetEnv(target, declarationFile));
      console.log('V2-R03 unresolvable artifact root:', JSON.stringify(run));
      expect(run.code, run.stderr).toBe(3);
      expect(run.stderr).toContain('ARTIFACT_COMMIT_FAILED');
      expect(await fingerprintTree(root)).toEqual({afile: `${blockerBytes.length}:${Math.round((await fs.stat(blocker)).mtimeMs)}`});
    });
  });
});
