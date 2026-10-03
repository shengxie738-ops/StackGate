import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Diagnostic, EffectivePolicy } from '../../packages/contracts/src/index.js';
import { accountBuildInputs, credentialBearing, loadComposeFile, parseComposeText, type ComposeParseResult } from '../../packages/adapter-compose/src/config.js';
import { COMPOSE_REFUSAL_CODES, preflightCompose, type ComposePreflightResult, type PreflightOptions } from '../../packages/adapter-compose/src/preflight.js';
import { authorizeBindingOrigin, CONTAINER_PORT_ORIGIN_RULE, planServiceBindings, recordObservedBindings } from '../../packages/adapter-compose/src/target-bindings.js';
import { withTestDirectory } from '../support/test-paths.js';

/** Observed count of preflight invocations, so the inventory comparison below cannot be vacuous. */
let preflightInvocations = 0;

const APPROVED_FILE = 'examples/contract-drift-demo/compose.test.yaml';
const PROJECT_PREFIX = 'examples/contract-drift-demo';
const CANARY_DB_PASSWORD = 'canary-db-password-9f2c41';
const CANARY_DB_URL = `postgresql://stackgate_app:${CANARY_DB_PASSWORD}@db:5432/stackgate_test`;
const PARSE_ENVIRONMENT = { STACKGATE_TEST_DATABASE_URL: CANARY_DB_URL, STACKGATE_TEST_DB_PASSWORD: CANARY_DB_PASSWORD };

/** Real bytes of the repository fixture: the tests below parse and preflight them, never bring them up. */
const APPROVED_TEXT = await fs.readFile(path.resolve(APPROVED_FILE), 'utf8');

const BASE_POLICY: EffectivePolicy = {
  schema_version: '0.1',
  policy_id: 'policy_sg057',
  policy_hash: 'a'.repeat(64),
  required_set: ['compose-smoke'],
  allowed_origins: [],
  allowed_paths: ['examples/contract-drift-demo/**', '.stackgate/**'],
  protected_inputs: ['examples/contract-drift-demo/compose.test.yaml'],
  minimum_provenance: 'DECLARED',
  approved_change_records: [],
  flaky_policy: 'incomplete',
  source: 'local-review',
  compose_writable_mount_roots: ['examples/contract-drift-demo/output'],
};

function codes(result: { diagnostics: Diagnostic[] }): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.rule_id ?? diagnostic.code);
}

function parse(text: string, environment: Readonly<Record<string, string>> = {}): ComposeParseResult {
  return parseComposeText({ source: 'inline/compose.test.yaml', text, environment });
}

function parsedConfig(text: string, environment: Readonly<Record<string, string>> = {}): unknown {
  return parse(text, environment).config;
}

function preflight(effectiveConfig: unknown, policy: EffectivePolicy = BASE_POLICY, options: PreflightOptions = {}): ComposePreflightResult {
  preflightInvocations += 1;
  return preflightCompose(effectiveConfig, policy, { repository_prefix: PROJECT_PREFIX, ...options });
}

function approvedParse(): ComposeParseResult {
  return parse(APPROVED_TEXT, PARSE_ENVIRONMENT);
}

function preflightApproved(policy: EffectivePolicy = BASE_POLICY, options: PreflightOptions = {}): ComposePreflightResult {
  const parsed = approvedParse();
  expect(parsed.ok).toBe(true);
  return preflight(parsed.config, policy, { restricted_pointers: parsed.restricted_pointers, ...options });
}

/** Minimal well-formed document; each test injects exactly one unsafe declaration into the body. */
function serviceDocument(serviceBody: string): string {
  return `services:\n  api:\n${serviceBody}\nnetworks:\n  testnet:\n    internal: true\nvolumes: {}\n`;
}

function expectRefused(result: ComposePreflightResult, code: string): void {
  expect(result.approved).toBe(false);
  expect(codes(result)).toContain(code);
}

/* ---------------------------------------------------------------------------------- the approved document ---------------------------------------------------------------------------------- */

it('approves the repository test compose document and plans only run-scoped resources', async () => {
  const parsed = await loadComposeFile({ file: APPROVED_FILE, environment: PARSE_ENVIRONMENT });
  expect(parsed.ok).toBe(true);
  expect(parsed.diagnostics).toEqual([]);
  const result = preflight(parsed.config, BASE_POLICY, { restricted_pointers: parsed.restricted_pointers });
  expect(result.approved).toBe(true);
  expect(result.diagnostics).toEqual([]);
  expect(result.resource_plan.ownership).toBe('run-scoped-only');
  expect(result.resource_plan.services.map((service) => service.name)).toEqual(['api', 'db']);
  expect(result.resource_plan.networks).toEqual([{ name: 'testnet', internal: true, declared: true }]);
  expect(result.resource_plan.volumes.map((volume) => volume.name).sort()).toEqual(['api-output', 'db-data']);
  expect(result.resource_plan.ports).toEqual([{ service: 'api', container_port: 8080, protocol: 'tcp', host_ip: '127.0.0.1', published: null }]);
  expect(result.resource_plan.mounts).toEqual([
    { service: 'api', kind: 'bind', source: 'examples/contract-drift-demo/apps/api', target: '/srv/api', read_only: true },
    { service: 'api', kind: 'bind', source: 'examples/contract-drift-demo/output', target: '/srv/output', read_only: false },
    { service: 'api', kind: 'volume', source: 'api-output', target: '/srv/artifacts', read_only: null },
    { service: 'api', kind: 'tmpfs', source: null, target: '/tmp', read_only: null },
    { service: 'db', kind: 'volume', source: 'db-data', target: '/var/lib/postgresql/data', read_only: null },
  ]);
  expect(result.resource_plan.exposed).toEqual([]);
  expect(result.resource_plan.builds).toEqual([]);
  expect(result.resource_plan.counts).toEqual({ services: 2, networks: 1, volumes: 2, ports: 1, mounts: 5, builds: 0 });
});

it('parses the approved document from disk through the repository YAML dependency', () => {
  expect(APPROVED_TEXT).toContain('services:');
  const parsed = parse(APPROVED_TEXT, PARSE_ENVIRONMENT);
  expect(parsed.config).toBeInstanceOf(Object);
  expect(parsed.interpolation.map((fact) => fact.variable).sort()).toEqual(['STACKGATE_TEST_DATABASE_URL', 'STACKGATE_TEST_DB_PASSWORD']);
});

it('records the container-port to origin rule without opening any localhost port', () => {
  const result = preflightApproved();
  expect(result.bindings).toEqual([
    {
      service: 'api',
      network_alias: 'api',
      container_port: 8080,
      protocol: 'tcp',
      host_ip: '127.0.0.1',
      host_port: null,
      observed: false,
      provenance: 'DECLARED',
      scheme: null,
      internal_target: 'api:8080',
      host_origin: null,
      authorization_rule: CONTAINER_PORT_ORIGIN_RULE,
    },
  ]);
});

it('refuses the same document when its writable mount is not the declared run output root', () => {
  expectRefused(preflightApproved({ ...BASE_POLICY, compose_writable_mount_roots: ['.stackgate/**'] }), COMPOSE_REFUSAL_CODES.MOUNT_WRITABLE_UNDECLARED);
});

it('approves the canonical shape docker compose config renders for a dynamic loopback port', () => {
  // Field shapes taken from a read-only `docker compose -p sg057probe config --no-interpolate` render
  // on this host (compose v5.1.4): published stays absent, mode materialises as ingress, network and
  // volume names are prefixed with the project namespace, bind sources become absolute.
  const rendered = parsedConfig(`name: sg057probe\nservices:\n  api:\n    image: python:3.12-slim\n    networks:\n      testnet: null\n    ports:\n      - host_ip: 127.0.0.1\n        mode: ingress\n        protocol: tcp\n        target: 8080\nnetworks:\n  testnet:\n    internal: true\n    name: sg057probe_testnet\nvolumes: {}\n`);
  const result = preflight(rendered, BASE_POLICY, { project_namespace: 'sg057probe' });
  expect(result.approved).toBe(true);
  expect(result.resource_plan.networks).toEqual([{ name: 'testnet', internal: true, declared: true }]);
  expect(result.resource_plan.project_namespace).toBe('sg057probe');
});

it('refuses a rendered resource name that is not inside the declared project namespace', () => {
  const rendered = parsedConfig(`name: sg057probe\nservices:\n  api:\n    image: python:3.12-slim\n    networks:\n      testnet: null\nnetworks:\n  testnet:\n    internal: true\n    name: someone_elses_network\nvolumes: {}\n`);
  expectRefused(preflight(rendered, BASE_POLICY, { project_namespace: 'sg057probe' }), COMPOSE_REFUSAL_CODES.RESOURCE_NAME_PINNED);
});

it('approves a fully rendered effective configuration whose bind sources are absolute host paths', () => {
  // This is the shape `docker compose -f examples/contract-drift-demo/compose.test.yaml -p <ns> config`
  // produces on this host: bind sources resolved to the project directory, resource names prefixed
  // with the project namespace, published ports left unassigned and restart rendered as "no".
  const repositoryRoot = path.resolve('.');
  const rendered = parsedConfig(`name: sg057run\nservices:\n  api:\n    image: python:3.12-slim\n    networks:\n      testnet: null\n    ports:\n      - host_ip: 127.0.0.1\n        mode: ingress\n        protocol: tcp\n        target: 8080\n    read_only: true\n    restart: "no"\n    tmpfs:\n      - /tmp\n    volumes:\n      - read_only: true\n        source: ${repositoryRoot}${path.sep}examples${path.sep}contract-drift-demo${path.sep}apps${path.sep}api\n        target: /srv/api\n        type: bind\n      - source: api-output\n        target: /srv/artifacts\n        type: volume\nnetworks:\n  testnet:\n    internal: true\n    name: sg057run_testnet\nvolumes:\n  api-output:\n    name: sg057run_api-output\n`);
  const result = preflight(rendered, BASE_POLICY, { project_directory: repositoryRoot, repository_prefix: '', project_namespace: 'sg057run' });
  expect(result.diagnostics).toEqual([]);
  expect(result.approved).toBe(true);
  expect(result.resource_plan.mounts).toEqual([
    { service: 'api', kind: 'bind', source: 'examples/contract-drift-demo/apps/api', target: '/srv/api', read_only: true },
    { service: 'api', kind: 'volume', source: 'api-output', target: '/srv/artifacts', read_only: null },
    { service: 'api', kind: 'tmpfs', source: null, target: '/tmp', read_only: null },
  ]);
  expect(result.resource_plan.project_namespace).toBe('sg057run');
});

/* ------------------------------------------------------------------------------------- refusals ------------------------------------------------------------------------------------- */

it('refuses a privileged service, matching the task card assertion literally', () => {
  const result = preflightCompose({ services: { api: { privileged: true } } }, BASE_POLICY);
  expect(result.approved).toBe(false);
  expect(codes(result)).toContain(COMPOSE_REFUSAL_CODES.PRIVILEGED);
});

it('refuses a privileged service parsed from real compose YAML text', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    privileged: true\n'))), COMPOSE_REFUSAL_CODES.PRIVILEGED);
});

it('refuses a docker socket bind mount written in short syntax', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n');
  expect(preflightCompose(parsedConfig(fixture), BASE_POLICY).approved).toBe(false);
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.DOCKER_SOCKET_MOUNT);
});

it('refuses a docker socket bind mount written in windows named-pipe form', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - \'\\\\.\\pipe\\docker_engine:\\\\.\\pipe\\docker_engine\'\n');
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.DOCKER_SOCKET_MOUNT);
});

it('refuses a long-syntax bind mount whose source is the docker socket', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - type: bind\n        source: /run/docker.sock\n        target: /docker.sock\n        read_only: true\n');
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.DOCKER_SOCKET_MOUNT);
});

it('refuses a fixed container name because identity must stay project-prefixed', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    container_name: stackgate_fixed_api\n'))), COMPOSE_REFUSAL_CODES.CONTAINER_NAME_FIXED);
});

it('refuses a pinned project name that the run did not choose', () => {
  const fixture = `name: stackgate_pinned\nservices:\n  api:\n    image: python:3.12-slim\n    networks: [testnet]\nnetworks:\n  testnet:\n    internal: true\nvolumes: {}\n`;
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.PROJECT_NAME_PINNED);
});

it('refuses an explicit resource name the run cannot scope', () => {
  const fixture = `services:\n  api:\n    image: python:3.12-slim\n    networks: [shared]\nnetworks:\n  shared:\n    internal: true\n    name: already_existing_network\nvolumes: {}\n`;
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.RESOURCE_NAME_PINNED);
});

it('refuses host network mode', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    network_mode: host\n'))), COMPOSE_REFUSAL_CODES.NETWORK_MODE_HOST);
});

it('refuses a port published in host mode because it bypasses the project network', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: 8080\n        host_ip: 127.0.0.1\n        mode: host\n'))), COMPOSE_REFUSAL_CODES.NETWORK_MODE_HOST);
});

it('refuses a network_mode that does not use this document networks', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    network_mode: "none"\n'))), COMPOSE_REFUSAL_CODES.NETWORK_MODE_UNSCOPED);
});

it('refuses host pid, ipc and uts namespace sharing', () => {
  for (const body of ['    pid: host\n', '    ipc: host\n', '    uts: host\n']) {
    expectRefused(preflight(parsedConfig(serviceDocument(`    image: python:3.12-slim\n    networks: [testnet]\n${body}`))), COMPOSE_REFUSAL_CODES.HOST_ISOLATION);
  }
});

it('refuses a dangerous kernel capability', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    cap_add: [SYS_ADMIN]\n'))), COMPOSE_REFUSAL_CODES.CAP_DANGEROUS);
});

it('refuses an unconfined security option', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    security_opt: ["seccomp=unconfined"]\n'))), COMPOSE_REFUSAL_CODES.SECURITY_UNCONFINED);
});

it('refuses host device passthrough', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    devices: ["/dev/sda:/dev/sda"]\n'))), COMPOSE_REFUSAL_CODES.DEVICE_PASSTHROUGH);
});

it('refuses a volume borrowed from another container', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes_from: ["someothercontainer"]\n'))), COMPOSE_REFUSAL_CODES.VOLUME_FROM);
});

it('refuses a restart policy that can outlive the run', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    restart: always\n'))), COMPOSE_REFUSAL_CODES.RESTART_OUTLIVES_RUN);
});

it('refuses a pull policy that fetches outside the declared inputs', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    pull_policy: always\n'))), COMPOSE_REFUSAL_CODES.PULL_POLICY);
});

it('refuses an extra_hosts entry that routes to the host gateway', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n'))), COMPOSE_REFUSAL_CODES.HOST_GATEWAY);
});

it('refuses a bind mount of the host root', () => {
  const posix = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - type: bind\n        source: /\n        target: /host\n        read_only: true\n');
  expectRefused(preflight(parsedConfig(posix)), COMPOSE_REFUSAL_CODES.PATH_HOST_ROOT);
  const drive = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - type: bind\n        source: C:\\\n        target: /host\n        read_only: true\n');
  expectRefused(preflight(parsedConfig(drive)), COMPOSE_REFUSAL_CODES.PATH_HOST_ROOT);
});

it('refuses a bind mount of the user profile directory', () => {
  const tilde = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - ~/.ssh:/root/.ssh:ro\n');
  expectRefused(preflight(parsedConfig(tilde)), COMPOSE_REFUSAL_CODES.PATH_HOME);
  const profile = os.homedir();
  const absolute = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - type: bind\n        source: ' + path.join(profile, '.ssh').replaceAll('\\', '/') + '\n        target: /root/.ssh\n        read_only: true\n');
  expectRefused(preflight(parsedConfig(absolute), BASE_POLICY, { project_directory: profile, repository_prefix: '', profile_directories: [profile] }), COMPOSE_REFUSAL_CODES.PATH_HOME);
});

it('refuses a bind mount that escapes the run own directory', () => {
  for (const source of ['../../../presets/fastapi-react', '../../../../etc/passwd']) {
    const fixture = serviceDocument(`    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - ${source}:/escape:ro\n`);
    expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.PATH_ESCAPES_RUN);
  }
  const withoutProjectRoot = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - type: bind\n        source: /etc\n        target: /etc\n        read_only: true\n');
  expectRefused(preflight(parsedConfig(withoutProjectRoot)), COMPOSE_REFUSAL_CODES.PATH_ESCAPES_RUN);
});

it('refuses an absolute host path inside the run root but outside the authorised paths', () => {
  const repositoryRoot = path.resolve('.').replaceAll('\\', '/');
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - type: bind\n        source: ' + repositoryRoot + '/presets/fastapi-react\n        target: /presets\n        read_only: true\n');
  expectRefused(preflight(parsedConfig(fixture), BASE_POLICY, { project_directory: path.resolve('.'), repository_prefix: '' }), COMPOSE_REFUSAL_CODES.PATH_OUTSIDE_POLICY);
});

it('refuses a volume declaration that cannot be parsed', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - "a:b:c:d"\n'))), COMPOSE_REFUSAL_CODES.VOLUME_MALFORMED);
});

it('refuses the repository working tree mounted writable', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - ./apps/api:/srv/api\n'))), COMPOSE_REFUSAL_CODES.MOUNT_WRITABLE_UNDECLARED);
});

it('refuses a bind mount that never declares read_only', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    volumes:\n      - type: bind\n        source: ./apps/api\n        target: /srv/api\n');
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.MOUNT_WRITABLE_UNDECLARED);
});

it('refuses an external volume as a resource this run does not own', () => {
  const fixture = `services:\n  api:\n    image: python:3.12-slim\n    networks: [testnet]\n    volumes: [shared-data:/data]\nnetworks:\n  testnet:\n    internal: true\nvolumes:\n  shared-data:\n    external: true\n`;
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.VOLUME_EXTERNAL);
});

it('refuses an external network as a resource this run does not own', () => {
  const fixture = `services:\n  api:\n    image: python:3.12-slim\n    networks: [shared]\nnetworks:\n  shared:\n    external: true\nvolumes: {}\n`;
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.NETWORK_EXTERNAL);
});

it('refuses a service attached to a network the document does not declare', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [ghost]\n'))), COMPOSE_REFUSAL_CODES.NETWORK_UNDECLARED);
});

it('refuses a network driver that is not the project-scoped bridge', () => {
  const fixture = `services:\n  api:\n    image: python:3.12-slim\n    networks: [hostnet]\nnetworks:\n  hostnet:\n    driver: host\nvolumes: {}\n`;
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.NETWORK_DRIVER);
});

it('refuses a fixed host port written in short syntax', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - "8081:8080"\n'))), COMPOSE_REFUSAL_CODES.PORT_FIXED_HOST);
});

it('refuses a fixed host port written in long syntax', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: 8080\n        published: "8081"\n        host_ip: 127.0.0.1\n'))), COMPOSE_REFUSAL_CODES.PORT_FIXED_HOST);
});

it('refuses an explicit zero published port instead of assuming it means dynamic', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: 8080\n        published: 0\n        host_ip: 127.0.0.1\n'))), COMPOSE_REFUSAL_CODES.PORT_FIXED_HOST);
});

it('refuses a published port that would leave the loopback interface', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: 8080\n        host_ip: 0.0.0.0\n'))), COMPOSE_REFUSAL_CODES.PORT_NOT_LOOPBACK);
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: 8080\n        host_ip: 192.168.1.20\n'))), COMPOSE_REFUSAL_CODES.PORT_NOT_LOOPBACK);
});

it('refuses a dynamic port that omits host_ip because compose publishes on every interface', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: 8080\n'))), COMPOSE_REFUSAL_CODES.PORT_NOT_LOOPBACK);
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - "8080"\n'))), COMPOSE_REFUSAL_CODES.PORT_NOT_LOOPBACK);
});

it('accepts a dynamic loopback port and records the binding as not yet observed', () => {
  const result = preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: 8080\n        host_ip: 127.0.0.1\n')));
  expect(result.approved).toBe(true);
  expect(result.bindings[0]).toMatchObject({ host_ip: '127.0.0.1', host_port: null, observed: false, provenance: 'DECLARED' });
});

it('refuses a malformed port declaration instead of guessing it', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - "127.0.0.1:8080:8080:8080"\n'))), COMPOSE_REFUSAL_CODES.PORT_MALFORMED);
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: not-a-port\n'))), COMPOSE_REFUSAL_CODES.PORT_MALFORMED);
});

it('refuses a connection string whose host is outside this run namespace', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    environment:\n      DATABASE_URL: postgresql://svc:svc@prod-db.example.internal:5432/orders\n');
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.DSN_EXTERNAL_HOST);
});

it('refuses an unpinned image reference', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: nginx\n    networks: [testnet]\n'))), COMPOSE_REFUSAL_CODES.IMAGE_UNPINNED);
  expectRefused(preflight(parsedConfig(serviceDocument('    image: nginx:latest\n    networks: [testnet]\n'))), COMPOSE_REFUSAL_CODES.IMAGE_UNPINNED);
});

it('refuses a hard-coded credential literal and never repeats it in the diagnostic', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    environment:\n      API_TOKEN: Bearer sk-live-3k4j5h6g\n');
  const result = preflight(parsedConfig(fixture));
  expectRefused(result, COMPOSE_REFUSAL_CODES.CREDENTIAL_HARDCODED);
  expect(JSON.stringify(result)).not.toContain('sk-live-3k4j5h6g');
});

/* --------------------------------------------------------------------------------- unknown shapes --------------------------------------------------------------------------------- */

it('refuses an unknown top-level configuration shape', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n') + 'unknown_section:\n  a: b\n';
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.TOPLEVEL_UNKNOWN);
});

it('refuses include, configs and secrets sections whose resources it cannot reason about', () => {
  for (const section of ['include', 'configs', 'secrets']) {
    const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n') + `${section}:\n  a: b\n`;
    expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.UNSUPPORTED_SECTION);
  }
});

it('refuses an unknown service field instead of ignoring it', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    privilege_mode: true\n'))), COMPOSE_REFUSAL_CODES.UNKNOWN_FIELD);
});

it('accepts inert x- extension fields without interpreting them', () => {
  const result = preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n') + 'x-notes:\n  owner: qa\n'));
  expect(result.approved).toBe(true);
});

it('refuses an effective configuration that is not a validated object', () => {
  for (const candidate of ['services', null, undefined, 7, [], {}, { services: 'api' }]) {
    const result = preflight(candidate);
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain(COMPOSE_REFUSAL_CODES.CONFIG_UNVALIDATED);
  }
});

it('refuses an empty resource plan that owns nothing', () => {
  expectRefused(preflight(parsedConfig('networks:\n  testnet:\n    internal: true\nvolumes: {}\n')), COMPOSE_REFUSAL_CODES.EMPTY_PLAN);
  expectRefused(preflight(parsedConfig('services: {}\nnetworks: {}\n')), COMPOSE_REFUSAL_CODES.EMPTY_PLAN);
});

it('refuses an effective policy that does not carry the decision inputs', () => {
  const withoutPaths = { ...BASE_POLICY } as Record<string, unknown>;
  delete withoutPaths.allowed_paths;
  expectRefused(preflight(approvedParse().config, withoutPaths as EffectivePolicy), COMPOSE_REFUSAL_CODES.POLICY_INVALID);
  expectRefused(preflight(approvedParse().config, { ...BASE_POLICY, compose_writable_mount_roots: 'output' }), COMPOSE_REFUSAL_CODES.POLICY_INVALID);
  expectRefused(preflight(approvedParse().config, null as unknown as EffectivePolicy), COMPOSE_REFUSAL_CODES.POLICY_INVALID);
});

/* ------------------------------------------------------------------------------------ interpolation ------------------------------------------------------------------------------------ */

it('refuses a value that only looks safe because it came from an unset variable', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    container_name: ${STACKGATE_API_NAME:-stackgate_api}\n');
  const result = parse(fixture, {});
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain(COMPOSE_REFUSAL_CODES.INTERPOLATION_UNRESOLVED);
  expect(result.interpolation).toEqual([{ pointer: '/services/api/container_name', variable: 'STACKGATE_API_NAME', declared: false, sensitivity: 'plain' }]);
});

it('never copies a resolved variable value into resolution output', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    environment:\n      TOKEN: ${SG_SET_TOKEN}\n      OTHER: ${SG_UNSET_TOKEN}\n');
  const result = parse(fixture, { SG_SET_TOKEN: 'canary-set-value-77' });
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain(COMPOSE_REFUSAL_CODES.INTERPOLATION_UNRESOLVED);
  expect(result.interpolation.find((fact) => fact.variable === 'SG_UNSET_TOKEN')).toMatchObject({ declared: false, pointer: '/services/api/environment/OTHER' });
  expect(JSON.stringify({ diagnostics: result.diagnostics, interpolation: result.interpolation })).not.toContain('canary-set-value-77');
});

it('resolves interpolation from the supplied environment and still refuses the fixed container name', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    container_name: ${STACKGATE_API_NAME}\n');
  const result = parse(fixture, { STACKGATE_API_NAME: 'stackgate_api_resolved' });
  expect(result.ok).toBe(true);
  expect(result.interpolation).toEqual([{ pointer: '/services/api/container_name', variable: 'STACKGATE_API_NAME', declared: true, sensitivity: 'plain' }]);
  expectRefused(preflight(result.config), COMPOSE_REFUSAL_CODES.CONTAINER_NAME_FIXED);
});

it('refuses an unexpanded interpolation token that survives into the effective configuration', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    ports:\n      - target: 8080\n        host_ip: ${STACKGATE_HOST_IP:-127.0.0.1}\n');
  expectRefused(preflight(parse(fixture, {}).config), COMPOSE_REFUSAL_CODES.INTERPOLATION_UNRESOLVED);
});

/* ---------------------------------------------------------------------------------------- secrets ---------------------------------------------------------------------------------------- */

it('keeps an interpolated credential as a restricted reference and never stores its value', () => {
  const parsed = approvedParse();
  expect(parsed.restricted_pointers).toEqual(['/services/api/environment/DATABASE_URL']);
  expect(JSON.stringify(parsed.interpolation)).not.toContain(CANARY_DB_PASSWORD);
  const result = preflight(parsed.config, BASE_POLICY, { restricted_pointers: parsed.restricted_pointers });
  expect(result.approved).toBe(true);
  const serialised = JSON.stringify({ diagnostics: result.diagnostics, resource_plan: result.resource_plan, bindings: result.bindings });
  expect(serialised).not.toContain(CANARY_DB_PASSWORD);
  expect(serialised).not.toContain(CANARY_DB_URL);
  expect(result.resource_plan.restricted_references).toContainEqual({ pointer: '/services/api/environment/DATABASE_URL', sensitivity: 'restricted', source: 'interpolation' });
});

it('classifies credentials with the repository redaction rule and URL userinfo syntax', () => {
  expect(credentialBearing('Bearer sk-live-123')).toBe(true);
  expect(credentialBearing('Authorization: Basic zz')).toBe(true);
  expect(credentialBearing('postgresql://app:secret@db:5432/test')).toBe(true);
  expect(credentialBearing('password=hunter2')).toBe(true);
  expect(credentialBearing('postgresql://db:5432/stackgate_test')).toBe(false);
  expect(credentialBearing('test')).toBe(false);
});

it('refuses an env_file outside the authorised paths and never reads its contents', () => {
  const escaping = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    env_file:\n      - ../../../etc/app.env\n');
  expectRefused(preflight(parsedConfig(escaping)), COMPOSE_REFUSAL_CODES.PATH_ESCAPES_RUN);
});

it('records an authorised env_file as a restricted reference by path only', () => {
  const fixture = serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    env_file:\n      - ./apps/api/test.env\n');
  const result = preflight(parsedConfig(fixture));
  expect(result.approved).toBe(true);
  expect(result.resource_plan.restricted_references).toContainEqual({ pointer: '/services/api/env_file/0', sensitivity: 'restricted', source: 'env_file' });
});

/* ----------------------------------------------------------------------------------------- build ----------------------------------------------------------------------------------------- */

it('refuses a remote build context that local inputs cannot cover', () => {
  const remote = serviceDocument('    build:\n      context: "https://github.com/example/remote.git"\n      dockerfile: Dockerfile\n    networks: [testnet]\n');
  expectRefused(preflight(parsedConfig(remote)), COMPOSE_REFUSAL_CODES.BUILD_CONTEXT_REMOTE);
  const imageContext = serviceDocument('    build:\n      context: ./apps/api\n      dockerfile: Dockerfile\n      additional_contexts:\n        base: docker-image://python:3.12-slim\n    networks: [testnet]\n');
  expectRefused(preflight(parsedConfig(imageContext)), COMPOSE_REFUSAL_CODES.BUILD_CONTEXT_REMOTE);
});

it('refuses a build context outside the authorised paths', () => {
  expectRefused(preflight(parsedConfig(serviceDocument('    build:\n      context: /etc\n      dockerfile: Dockerfile\n    networks: [testnet]\n'))), COMPOSE_REFUSAL_CODES.PATH_ESCAPES_RUN);
});

it('refuses ssh forwarding in a build', () => {
  const fixture = serviceDocument('    build:\n      context: ./apps/api\n      dockerfile: Dockerfile\n      ssh:\n        - default\n    networks: [testnet]\n');
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.BUILD_SSH);
});

it('refuses build secrets', () => {
  const fixture = serviceDocument('    build:\n      context: ./apps/api\n      dockerfile: Dockerfile\n      secrets:\n        - name: npmrc\n          source: registry-token\n    networks: [testnet]\n');
  expectRefused(preflight(parsedConfig(fixture)), COMPOSE_REFUSAL_CODES.BUILD_SECRET);
});

it('blocks a declared build whose actual inputs are not accounted and accepts a real accounted context', async () => {
  const unaccounted = preflight(parsedConfig(serviceDocument('    build:\n      context: .\n      dockerfile: Dockerfile\n    networks: [testnet]\n')), BASE_POLICY, { repository_prefix: 'examples/contract-drift-demo/apps/api' });
  expectRefused(unaccounted, COMPOSE_REFUSAL_CODES.BUILD_INPUTS_UNACCOUNTED);

  await withTestDirectory(async (root) => {
    await fs.mkdir(path.join(root, 'ctx'), { recursive: true });
    await fs.writeFile(path.join(root, 'ctx', 'Dockerfile'), 'FROM python:3.12-slim\n');
    await fs.writeFile(path.join(root, 'ctx', '.dockerignore'), 'output\n');
    await fs.writeFile(path.join(root, 'ctx', 'app.py'), 'print("test")\n');
    const accounted = await accountBuildInputs(root, 'ctx');
    expect(accounted).toEqual({ context: 'ctx', exists: true, is_directory: true, dockerignore_present: true, entry_count: 3, truncated: false, complete: true });

    const policy: EffectivePolicy = { ...BASE_POLICY, allowed_paths: ['ctx', 'ctx/**'], compose_writable_mount_roots: [] };
    const document = parse('services:\n  api:\n    image: local/api:test\n    build:\n      context: ctx\n      dockerfile: Dockerfile\n    networks: [testnet]\nnetworks:\n  testnet:\n    internal: true\nvolumes: {}\n');
    expect(document.ok).toBe(true);
    const result = preflightCompose(document.config, policy, { build_accounting: { api: accounted } });
    expect(result.approved).toBe(true);
    expect(result.resource_plan.builds).toEqual([{ service: 'api', context: 'ctx', dockerfile: 'Dockerfile', ignored_inputs_declared: true, accounted_entries: 3 }]);

    await fs.rm(path.join(root, 'ctx', '.dockerignore'));
    const incomplete = await accountBuildInputs(root, 'ctx');
    expect(incomplete).toMatchObject({ dockerignore_present: false, complete: false, entry_count: 2 });
    expectRefused(preflightCompose(document.config, policy, { build_accounting: { api: incomplete } }), COMPOSE_REFUSAL_CODES.BUILD_INPUTS_UNACCOUNTED);
  });
});

/* ----------------------------------------------------------------------------------- target bindings ----------------------------------------------------------------------------------- */

it('plans bindings from declared container ports only and never guesses a host port', () => {
  const bindings = planServiceBindings([{ service: 'api', network_alias: 'api', container_port: 8080, protocol: 'tcp', host_ip: '127.0.0.1' }]);
  expect(bindings).toHaveLength(1);
  expect(bindings[0]).toMatchObject({ host_port: null, host_ip: '127.0.0.1', observed: false, provenance: 'DECLARED' });
  expect(bindings[0]?.authorization_rule).toBe(CONTAINER_PORT_ORIGIN_RULE);
});

it('keeps an exposed container port unbound and out of the host binding set', () => {
  const result = preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    expose: ["8080"]\n')));
  expect(result.approved).toBe(true);
  expect(result.bindings).toEqual([]);
  expect(result.resource_plan.exposed).toEqual([{ service: 'api', container_port: 8080, protocol: 'tcp' }]);
});

it('refuses to authorise an origin while the host binding is still unobserved', () => {
  const binding = planServiceBindings([{ service: 'api', network_alias: 'api', container_port: 8080, protocol: 'tcp', host_ip: '127.0.0.1' }])[0]!;
  expect(authorizeBindingOrigin(binding, { ...BASE_POLICY, allowed_origins: ['http://127.0.0.1:8080'] })).toEqual({ decision: 'DENY', origin: null, reason: COMPOSE_REFUSAL_CODES.BINDING_NOT_OBSERVED });
});

it('records an observed loopback binding and authorises only an origin the policy already allows', () => {
  const declared = planServiceBindings([{ service: 'api', network_alias: 'api', container_port: 8080, protocol: 'tcp', host_ip: '127.0.0.1' }])[0]!;
  const observed = recordObservedBindings(declared, { host_ip: '127.0.0.1', host_port: 49_152, scheme: 'http' });
  expect(observed.diagnostics).toEqual([]);
  expect(observed.binding).toMatchObject({ observed: true, provenance: 'OBSERVED', host_port: 49_152, host_origin: 'http://127.0.0.1:49152' });
  expect(authorizeBindingOrigin(observed.binding, BASE_POLICY)).toEqual({ decision: 'DENY', origin: 'http://127.0.0.1:49152', reason: COMPOSE_REFUSAL_CODES.BINDING_ORIGIN_UNAUTHORIZED });
  expect(authorizeBindingOrigin(observed.binding, { ...BASE_POLICY, allowed_origins: ['http://127.0.0.1:49152'] })).toEqual({ decision: 'ALLOW', origin: 'http://127.0.0.1:49152', reason: 'policy-allowed-observed-loopback' });
});

it('refuses an observed binding reported on a non-loopback interface', () => {
  const declared = planServiceBindings([{ service: 'api', network_alias: 'api', container_port: 8080, protocol: 'tcp', host_ip: '127.0.0.1' }])[0]!;
  const observed = recordObservedBindings(declared, { host_ip: '0.0.0.0', host_port: 49_152, scheme: 'http' });
  expect(codes(observed)).toEqual([COMPOSE_REFUSAL_CODES.BINDING_HOST_NOT_LOOPBACK]);
  expect(observed.binding).toEqual(declared);
});

it('treats an observed host port without a declared scheme as still unauthorizable', () => {
  const declared = planServiceBindings([{ service: 'api', network_alias: 'api', container_port: 8080, protocol: 'tcp', host_ip: '127.0.0.1' }])[0]!;
  const observed = recordObservedBindings(declared, { host_ip: '127.0.0.1', host_port: 49_152 });
  expect(observed.binding.host_origin).toBeNull();
  expect(authorizeBindingOrigin(observed.binding, { ...BASE_POLICY, allowed_origins: ['http://127.0.0.1:49152'] })).toEqual({ decision: 'DENY', origin: null, reason: COMPOSE_REFUSAL_CODES.BINDING_SCHEME_UNDECLARED });
});

/* ------------------------------------------------------------------------------------------ purity ------------------------------------------------------------------------------------------ */

it('declares every refusal code it can emit under one shared prefix', () => {
  const values = Object.values(COMPOSE_REFUSAL_CODES);
  expect(values.length).toBeGreaterThan(30);
  expect(values.every((value) => value.startsWith('SG-POLICY-COMPOSE-'))).toBe(true);
  expect(new Set(values).size).toBe(values.length);
  const refused = preflight(parsedConfig(serviceDocument('    image: python:3.12-slim\n    networks: [testnet]\n    privileged: true\n')));
  for (const diagnostic of refused.diagnostics) {
    expect(values).toContain(diagnostic.rule_id);
    expect(diagnostic.location).toContain('services/api');
    expect(diagnostic.code).toBe('POLICY_WEAKEN_ATTEMPT');
  }
});

it('keeps preflight pure by containing no child-process, network or filesystem write call', async () => {
  const forbidden = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(|from ['"]node:child_process['"]|require\(['"]node:child_process['"]\)|\bprocess\s*\.\s*(?:exit|abort)\s*\(|createWriteStream|\bfetch\s*\(|\bhttps?\s*\.\s*(?:get|request)\s*\(/;
  for (const file of ['config.ts', 'preflight.ts', 'target-bindings.ts']) {
    const text = await fs.readFile(path.resolve('packages/adapter-compose/src', file), 'utf8');
    expect(text, file).not.toMatch(forbidden);
  }
});

it('creates no resource and leaves the repository fixture byte-identical', async () => {
  expect((await fs.readdir(path.resolve('packages/adapter-compose/src'))).sort()).toEqual(['config.ts', 'preflight.ts', 'target-bindings.ts']);
  const before = await fs.readFile(path.resolve(APPROVED_FILE));
  preflightApproved();
  expect(await fs.readFile(path.resolve(APPROVED_FILE))).toEqual(before);
});

/* ---------------------------------------------------------------------------- observed resource inventory ---------------------------------------------------------------------------- */

/**
 * Read-only capture of the host's real Docker inventory (`ps`, `images` and `compose ls` only list).
 * `before` is taken while this file loads, i.e. before any preflight call in the tests above, and
 * `after` is taken in the final test, so the comparison is an observation rather than a tautology.
 */
function captureResourceInventory(): { status: 'OK'; containers: string[]; images: string[]; projects: string[] } {
  const list = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort();
  return { status: 'OK', containers: list(['ps', '-q']), images: list(['images', '-q']), projects: list(['compose', 'ls']) };
}

const resourceInventoryBefore = captureResourceInventory();

// Measured on this host: the three read-only docker CLI round-trips inside this case took 593ms, so
// the budget here only covers the 30s ceiling already given to each execFileSync call; the
// assertion itself is unchanged and the product timeout policy is not involved.
it('leaves the observed host resource inventory unchanged after every preflight call', () => {
  expect(resourceInventoryBefore.status).toBe('OK');
  expect(preflightInvocations).toBeGreaterThan(30);
  const resourceInventoryAfter = captureResourceInventory();
  expect(resourceInventoryAfter).toEqual(resourceInventoryBefore);
}, 90_000);
