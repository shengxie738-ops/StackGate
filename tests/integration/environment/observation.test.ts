import { expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { BackendObservation } from '../../../packages/contracts/src/index.js';
import { validateSchema } from '../../../packages/contracts/src/index.js';
import { withTestDirectory } from '../../support/test-paths.js';

/**
 * SG-055 integration suite. Every case below starts the demo's real FastAPI service through the test-only
 * launcher, over a loopback socket the launcher opened, and then reads back the files that service wrote.
 * Nothing is mocked: the bytes compared are the bytes `fetch` received, the digest is recomputed by Node,
 * and the process that is reclaimed in `finally` is the one this file spawned and no other.
 */
vi.setConfig({ testTimeout: 180000 });

const apiRoot = path.resolve('examples/contract-drift-demo/apps/api');
const python = process.platform === 'win32' ? 'python' : 'python3';
// Replaced, not inherited: a proxy or a credential in the user's own environment cannot reach this service.
const baseEnv: NodeJS.ProcessEnv = {
  SystemRoot: process.env.SystemRoot ?? '', PATH: process.env.PATH ?? '', TEMP: process.env.TEMP ?? '',
  TMP: process.env.TMP ?? '', APPDATA: process.env.APPDATA ?? '', PYTHONIOENCODING: 'utf-8',
};
const RUN_ID = 'run_sg055_integration';
const OTHER_RUN = 'run_sg055_not_allowed';
const CHECK_ID = 'runtime_probe';
const ATTEMPT_ID = 'attempt_sg055_1';
const INPUT_HASH = createHash('sha256').update('stackgate-sg055-candidate-input').digest('hex');
const FORGED_INSTANCE = 'client_supplied_instance';
const FORGED_REVISION = 'client-supplied-revision';
const OPERATION = 'api:GET /api/performance';

/** Independent liveness check for the one process this file created: signal 0 only asks whether it exists. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code !== 'ESRCH';
  }
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
}

function identityHeaders(requestId: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-stackgate-run-id': RUN_ID, 'x-stackgate-check-id': CHECK_ID,
    'x-stackgate-attempt-id': ATTEMPT_ID, 'x-stackgate-request-id': requestId, ...extra,
  };
}

type Launcher = {
  origin: string;
  port: number;
  pid: number;
  instanceId: string;
  dataRevision: string;
  startRecord: Record<string, unknown>;
  stateDirectory: string;
  observationRoot: string;
  stderr: string;
};

/**
 * Starts the launcher, waits for its ready line, hands the caller a live service, and in `finally` kills
 * only the child handle this function created. The exit is awaited with a ceiling so a hung service is
 * reported rather than left running behind a passing test.
 */
async function withObservedApi<R>(root: string, work: (api: Launcher) => Promise<R>): Promise<R> {
  const stateDirectory = path.join(root, 'state');
  const child = spawn(python, ['-B', '-E', 'scripts/launch_test_api.py'], {
    cwd: apiRoot,
    env: {
      ...baseEnv, STACKGATE_STATE_DIR: stateDirectory, STACKGATE_ALLOWED_RUN_IDS: RUN_ID,
      STACKGATE_INPUT_HASH: INPUT_HASH,
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const exited = new Promise<number | null>(resolve => child.on('close', code => resolve(code)));
  const ready = await new Promise<Record<string, unknown>>((resolve, reject) => {
    let buffered = '';
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString('utf8');
      const newline = buffered.indexOf('\n');
      if (newline >= 0) {
        child.stdout.off('data', onData);
        try { resolve(JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>); }
        catch (error) { reject(error as Error); }
        return;
      }
      if (buffered.length > 65536) {
        child.stdout.off('data', onData);
        reject(new Error(`launcher prelude exceeded 64 KiB: ${buffered.slice(0, 200)}`));
      }
    };
    child.stdout.on('data', onData);
    child.on('error', error => { child.stdout.off('data', onData); reject(error); });
    void exited.then(code => {
      child.stdout.off('data', onData);
      if (buffered.indexOf('\n') < 0) reject(new Error(`launcher exited with ${code} before it was ready: ${stderr}`));
    });
  });
  const startRecordPath = String(ready.start_record);
  const startRecord = await readJson(startRecordPath);
  const api: Launcher = {
    origin: String(ready.origin),
    port: Number(ready.port),
    pid: Number(ready.pid),
    instanceId: String(ready.instance_id),
    dataRevision: String(ready.data_revision),
    startRecord,
    stateDirectory,
    observationRoot: path.join(stateDirectory, 'observations'),
    stderr,
  };
  try {
    return await work(api);
  } finally {
    child.kill();
    const settled = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 30000))]);
    if (settled === 'timeout') throw new Error(`launcher pid ${String(child.pid)} did not exit after being killed`);
  }
}

async function fetchPerformance(api: Launcher, requestId: string, extra: Record<string, string> = {}) {
  const response = await fetch(`${api.origin}/api/performance`, {
    headers: identityHeaders(requestId, extra), signal: AbortSignal.timeout(15000),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes };
}

it('attests a real response with the exact bytes the client received', async () => {
  await withTestDirectory(async root => {
    await withObservedApi(root, async api => {
      const { response, bytes } = await fetchPerformance(api, 'request_sg055_ok');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const received = Buffer.from(bytes);
      expect(received.length).toBeGreaterThan(0);
      expect(JSON.parse(received.toString('utf8'))).toMatchObject({ data: { performance: { total_return: 0.1234 } } });

      const folder = path.join(api.observationRoot, RUN_ID, CHECK_ID, ATTEMPT_ID, 'request_sg055_ok');
      const observation = await readJson(path.join(folder, 'observation.json')) as unknown as BackendObservation;
      expect(validateSchema('backend-observation', observation).ok, JSON.stringify(observation)).toBe(true);
      expect(observation.run_id).toBe(RUN_ID);
      expect(observation.check_id).toBe(CHECK_ID);
      expect(observation.attempt_id).toBe(ATTEMPT_ID);
      expect(observation.request_id).toBe('request_sg055_ok');
      expect(observation.operation_key).toBe(OPERATION);
      expect(observation.status_code).toBe(200);
      expect(observation.media_type).toBe('application/json');
      expect(observation.digest_input_form).toBe('UNCOMPRESSED_UTF8_BODY_BYTES');
      expect(observation.excluded_fields).toEqual(['Authorization', 'Cookie', 'Set-Cookie']);

      // The recorded body is byte-identical to what the client got, and the digest recomputes over it.
      const stored = await fs.readFile(path.join(folder, 'response.bin'));
      expect(Buffer.compare(stored, received)).toBe(0);
      expect(observation.response_bytes).toBe(received.length);
      const recomputed = createHash('sha256').update(received).digest('hex');
      expect(observation.response_digest).toBe(recomputed);
      expect(createHash('sha256').update(stored).digest('hex')).toBe(recomputed);
      expect(observation.observation_path).toBe(
        `${RUN_ID}/${CHECK_ID}/${ATTEMPT_ID}/request_sg055_ok/response.bin`);

      // The completion index is only there because all three pieces committed, and it names them.
      const index = await readJson(path.join(folder, 'index.json'));
      expect(index.kind).toBe('stackgate-observation-index');
      expect(index.instance_id).toBe(api.instanceId);
      expect(index.data_revision).toBe(api.dataRevision);
      expect(index.body_digest).toBe(recomputed);
      expect(index.observation_digest).toBe(createHash('sha256').update(await fs.readFile(path.join(folder, 'observation.json'))).digest('hex'));
      expect(index.retained_bytes).toBe(received.length);
      await expect(fs.readdir(api.observationRoot)).resolves.toEqual([RUN_ID]);
      // Nothing half-finished is on disk: only the three committed names exist for this identity.
      expect((await fs.readdir(folder)).sort()).toEqual(['index.json', 'observation.json', 'response.bin']);
    });
  });
});

it('binds the observation to the launcher identity, never to a header the client sent', async () => {
  await withTestDirectory(async root => {
    await withObservedApi(root, async api => {
      const { response, bytes } = await fetchPerformance(api, 'request_sg055_forge', {
        'x-stackgate-instance-id': FORGED_INSTANCE, 'x-stackgate-data-revision': FORGED_REVISION,
      });
      // Exactly one advertised identity, and it is the server's own value.
      expect(response.headers.get('x-stackgate-instance-id')).toBe(api.instanceId);
      expect(response.headers.get('x-stackgate-data-revision')).toBe(api.dataRevision);

      const folder = path.join(api.observationRoot, RUN_ID, CHECK_ID, ATTEMPT_ID, 'request_sg055_forge');
      const observation = await readJson(path.join(folder, 'observation.json')) as unknown as BackendObservation;
      expect(observation.instance_id).toBe(api.instanceId);
      expect(observation.instance_id).toBe(api.startRecord.instance_id);
      expect(observation.instance_id).not.toBe(FORGED_INSTANCE);
      expect(observation.response_digest).toBe(createHash('sha256').update(Buffer.from(bytes)).digest('hex'));

      // The start record is a separate fact, and it names the process this file created.
      expect(api.startRecord.kind).toBe('stackgate-test-api-launch');
      expect(api.startRecord.pid).toBe(api.pid);
      expect(api.startRecord.pid).not.toBe(process.pid);
      expect(api.startRecord.instance_id).toBe(api.instanceId);
      expect(api.startRecord.data_revision).toBe(api.dataRevision);
      expect(api.startRecord.input_hash).toBe(INPUT_HASH);
      expect(api.startRecord.host).toBe('127.0.0.1');
      expect(api.startRecord.origin).toBe(api.origin);
      expect(api.startRecord.allowed_run_ids).toEqual([RUN_ID]);
      expect(api.startRecord.evidence_routes).toEqual([]);
      expect((api.startRecord.served_routes as string[]).filter(route => /observ|evidence|record/.test(route))).toEqual([]);
      const creation = api.startRecord.process_creation as Record<string, unknown>;
      expect(creation.pid).toBe(api.pid);
      expect(['observed', 'unsupported']).toContain(String(creation.status));
      if (creation.status === 'observed') {
        expect(String(creation.creation_identity)).toMatch(/^\d+$/);
        expect(String(creation.mechanism)).not.toBe('');
        expect(String(creation.created_at)).toMatch(/Z$/);
      }
      // The start record binds the bytes this service actually ran.
      const digests = api.startRecord.source_digests as Record<string, string>;
      expect(digests['presets/fastapi-react/scripts/stackgate_observation.py'])
        .toBe(createHash('sha256').update(await fs.readFile(path.resolve('presets/fastapi-react/scripts/stackgate_observation.py'))).digest('hex'));
      expect(digests['app/main.py'])
        .toBe(createHash('sha256').update(await fs.readFile(path.join(apiRoot, 'app', 'main.py'))).digest('hex'));

      // And no route serves the record tree back: the evidence is read from disk by the collector only.
      for (const guess of ['/observations', `/observations/${RUN_ID}`, '/api/observation', '/evidence',
                           `/${RUN_ID}/${CHECK_ID}/${ATTEMPT_ID}/request_sg055_forge/observation.json`]) {
        const probe = await fetch(`${api.origin}${guess}`, { signal: AbortSignal.timeout(15000) });
        expect(probe.status, guess).toBe(404);
      }
    });
  });
});

it('refuses a repeated request identity instead of overwriting the first record', async () => {
  await withTestDirectory(async root => {
    await withObservedApi(root, async api => {
      const folder = path.join(api.observationRoot, RUN_ID, CHECK_ID, ATTEMPT_ID, 'request_sg055_repeat');
      const first = await fetchPerformance(api, 'request_sg055_repeat');
      const before = await fingerprint(folder);
      expect(Object.keys(before).sort()).toEqual(['index.json', 'observation.json', 'response.bin']);

      const second = await fetchPerformance(api, 'request_sg055_repeat');
      const after = await fingerprint(folder);
      // V31: every byte the first request committed keeps its exact content and mtime, and the only new
      // file is the refusal itself.
      for (const [name, value] of Object.entries(before)) expect(after[name], `${name} changed`).toBe(value);
      expect(Object.keys(after).sort()).toEqual(['conflict.json', 'index.json', 'observation.json', 'response.bin']);
      expect(Buffer.compare(Buffer.from(second.bytes), Buffer.from(first.bytes))).toBe(0);
      const conflict = await readJson(path.join(folder, 'conflict.json'));
      expect(conflict.kind).toBe('stackgate-observation-conflict');
      expect(String(conflict.reason)).toContain('IDENTITY');
      expect(conflict.request_id).toBe('request_sg055_repeat');
      expect(conflict.check_id).toBe(CHECK_ID);
      expect(conflict.retained_bytes).toBe(0);
      expect(Number(conflict.discarded_bytes)).toBe(second.bytes.length);
      expect(conflict.instance_id).toBe(api.instanceId);
      // A conflict is not an attestation: exactly one observation document exists for this identity, and it
      // is the first request's, digests included.
      const attested = await readJson(path.join(folder, 'observation.json'));
      expect(attested.request_id).toBe('request_sg055_repeat');
      expect(attested.response_digest).toBe(createHash('sha256').update(Buffer.from(first.bytes)).digest('hex'));
      expect((await fs.readdir(folder)).filter(name => name === 'observation.json')).toEqual(['observation.json']);

      // A different identity in the same attempt is recorded independently, and nothing collided.
      await fetchPerformance(api, 'request_sg055_other');
      expect(await fs.readdir(path.join(api.observationRoot, RUN_ID, CHECK_ID, ATTEMPT_ID)))
        .toEqual(['request_sg055_other', 'request_sg055_repeat']);
    });
  });
});

it('serves an unauthorized run without creating any fact about it', async () => {
  await withTestDirectory(async root => {
    await withObservedApi(root, async api => {
      const response = await fetch(`${api.origin}/api/performance`, {
        headers: {
          'x-stackgate-run-id': OTHER_RUN, 'x-stackgate-check-id': CHECK_ID,
          'x-stackgate-attempt-id': ATTEMPT_ID, 'x-stackgate-request-id': 'request_sg055_unauthorized',
        },
        signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
      // Served, and nothing else: no record, no diagnostic, no advertised identity.
      expect(response.headers.get('x-stackgate-instance-id')).toBeNull();
      expect(response.headers.get('x-stackgate-data-revision')).toBeNull();
      await expect(fs.readdir(api.observationRoot)).resolves.toEqual([]);

      // A malformed identity is the same case: passed through, never filed under a guessed name.
      const malformed = await fetch(`${api.origin}/api/performance`, {
        headers: { ...identityHeaders('has space') }, signal: AbortSignal.timeout(15000),
      });
      expect(malformed.status).toBe(200);
      await malformed.arrayBuffer();
      await expect(fs.readdir(api.observationRoot)).resolves.toEqual([]);
    });
  });
});

it('keeps secret request headers out of the record tree and reclaims only its own process', async () => {
  const canary = 'sg055-canary-never-recorded';
  let observedPid = 0;
  await withTestDirectory(async root => {
    await withObservedApi(root, async api => {
      observedPid = api.pid;
      const response = await fetch(`${api.origin}/api/performance`, {
        headers: { ...identityHeaders('request_sg055_secret'), authorization: `Bearer ${canary}`,
          cookie: `session=${canary}` },
        signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      await response.arrayBuffer();

      const files: string[] = [];
      const walk = async (directory: string): Promise<void> => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const full = path.join(directory, entry.name);
          if (entry.isDirectory()) { await walk(full); continue; }
          files.push(full);
        }
      };
      await walk(api.stateDirectory);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const text = (await fs.readFile(file)).toString('utf8');
        expect(text, file).not.toContain(canary);
        // A partial file left behind would mean an interrupted commit; `_commit` unlinks its own temp file.
        expect(path.basename(file)).not.toMatch(/\.partial/);
      }
      expect(processAlive(observedPid), 'the service is running while its own test holds the handle').toBe(true);
    });
    // `finally` in the helper killed exactly the pid the start record named — the handle this file created.
    expect(processAlive(observedPid), 'the process this test created is gone after the case').toBe(false);
  });
});

/** Relative path -> `bytes:mtime`, so a same-size rewrite of an existing record stays visible. */
async function fingerprint(root: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(full, relative); continue; }
      const stat = await fs.stat(full);
      found[relative] = `${createHash('sha256').update(await fs.readFile(full)).digest('hex').slice(0, 16)}:${Math.round(stat.mtimeMs)}`;
    }
  };
  await walk(root, '');
  return found;
}
