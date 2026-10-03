import type { EnvironmentManifest } from '../../contracts/src/index.js';
import { parseStrictDocument } from '../../core/src/services/strict-document.js';
import { isLoopbackAddress } from './target-bindings.js';
import type { ComposeCommandPort, ComposeCommandRequest } from './start.js';

/**
 * Independent inspection for SG-058 (plan §2.6, spec §15.2).
 *
 * Everything here is read back from the daemon *after* this run created something, and the only input to
 * a command is an id this run enumerated itself. Published host ports come from `docker inspect`, never
 * from the compose document, never from a log line and never from a default: an empty binding list is
 * reported as absent, and an absent binding authorises no origin.
 */

/** One raw `docker inspect` element. Kept unstructured on purpose: fields are read where they are used. */
export type InspectedObject = Record<string, unknown>;

export type BindingStatus = 'OBSERVED' | 'ABSENT' | 'AMBIGUOUS' | 'NOT_LOOPBACK' | 'NOT_A_CONTAINER';

export interface PublishedBinding {
  status: BindingStatus;
  host_ip: string | null;
  host_port: number | null;
  candidate_count: number;
  /** Every candidate the daemon reported, so an ambiguous answer is visible instead of silently chosen. */
  candidates: { host_ip: string | null; host_port: string | null }[];
}

export interface ContainerFacts {
  container_id: string;
  state: string;
  image_id: string;
  project: string;
  service: string;
  config_hash: string;
  stackgate_run_id: string | null;
  stackgate_managed: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function labelsOf(object: InspectedObject): Record<string, string> {
  const config = asRecord(object.Config);
  const labels = asRecord(config?.Labels);
  if (!labels) return {};
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) if (typeof value === 'string') output[key] = value;
  return output;
}

export const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
export const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
export const COMPOSE_CONFIG_HASH_LABEL = 'com.docker.compose.config-hash';
export const COMPOSE_IMAGE_LABEL = 'com.docker.compose.image';
export const STACKGATE_RUN_LABEL = 'stackgate.run_id';
export const STACKGATE_MANAGED_LABEL = 'stackgate.managed';

/** Facts this run needs about one container, all read from the inspected object. */
export function containerFacts(object: InspectedObject): ContainerFacts {
  const labels = labelsOf(object);
  const state = asRecord(object.State);
  return {
    container_id: typeof object.Id === 'string' ? object.Id : '',
    state: typeof state?.Status === 'string' ? state.Status : 'unknown',
    image_id: typeof object.Image === 'string' ? object.Image : '',
    project: labels[COMPOSE_PROJECT_LABEL] ?? '',
    service: labels[COMPOSE_SERVICE_LABEL] ?? '',
    config_hash: labels[COMPOSE_CONFIG_HASH_LABEL] ?? '',
    stackgate_run_id: labels[STACKGATE_RUN_LABEL] ?? null,
    stackgate_managed: labels[STACKGATE_MANAGED_LABEL] ?? null,
  };
}

export function networkFacts(object: InspectedObject): { network_id: string; name: string; internal: boolean; project: string } {
  const labels = asRecord(object.Labels);
  return {
    network_id: typeof object.Id === 'string' ? object.Id : '',
    name: typeof object.Name === 'string' ? object.Name : '',
    internal: object.Internal === true,
    project: typeof labels?.[COMPOSE_PROJECT_LABEL] === 'string' ? String(labels[COMPOSE_PROJECT_LABEL]) : '',
  };
}

/**
 * Read the host side of one published container port from a real inspect element.
 *
 * `{"8080/tcp":[]}` is what the daemon reports when compose silently drops a mapping (an `internal: true`
 * network does exactly that), so an empty list is `ABSENT` rather than a port of zero, and more than one
 * binding is `AMBIGUOUS` rather than the first one.
 */
export function readPublishedBinding(object: InspectedObject | null | undefined, container_port: number, protocol: 'tcp' | 'udp'): PublishedBinding {
  const empty: PublishedBinding = { status: 'NOT_A_CONTAINER', host_ip: null, host_port: null, candidate_count: 0, candidates: [] };
  if (!object) return empty;
  const settings = asRecord(object.NetworkSettings);
  if (!settings) return empty;
  const ports = asRecord(settings.Ports);
  if (!ports) return { status: 'ABSENT', host_ip: null, host_port: null, candidate_count: 0, candidates: [] };
  const key = `${container_port}/${protocol}`;
  if (!Object.hasOwn(ports, key)) return { status: 'ABSENT', host_ip: null, host_port: null, candidate_count: 0, candidates: [] };
  const entries = ports[key];
  if (!Array.isArray(entries) || entries.length === 0) return { status: 'ABSENT', host_ip: null, host_port: null, candidate_count: 0, candidates: [] };
  const candidates = entries.map((entry) => {
    const record = asRecord(entry);
    return { host_ip: typeof record?.HostIp === 'string' ? record.HostIp : null, host_port: typeof record?.HostPort === 'string' || typeof record?.HostPort === 'number' ? String(record.HostPort) : null };
  });
  const base = { candidate_count: candidates.length, candidates };
  if (candidates.length !== 1) return { ...base, status: 'AMBIGUOUS', host_ip: null, host_port: null };
  const [candidate] = candidates;
  if (!candidate || typeof candidate.host_ip !== 'string' || candidate.host_ip.length === 0) return { ...base, status: 'ABSENT', host_ip: null, host_port: null };
  const port = Number(candidate.host_port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return { ...base, status: 'ABSENT', host_ip: candidate.host_ip, host_port: null };
  if (!isLoopbackAddress(candidate.host_ip)) return { ...base, status: 'NOT_LOOPBACK', host_ip: candidate.host_ip, host_port: port };
  return { ...base, status: 'OBSERVED', host_ip: candidate.host_ip, host_port: port };
}

/** Inspect real objects by id. The parsed bytes are the daemon's own output for this command only. */
export async function inspectObjects(port: ComposeCommandPort, ids: readonly string[], scope: ComposeCommandRequest['scope'], signal: AbortSignal = new AbortController().signal): Promise<InspectedObject[]> {
  const collected: InspectedObject[] = [];
  // chunked so one huge argv cannot exceed the reviewed command budget or blur which ids were asked for
  for (let offset = 0; offset < ids.length; offset += 16) {
    const chunk = ids.slice(offset, offset + 16);
    if (chunk.length === 0) continue;
    const result = await port.run({ purpose: 'inspect', argv: ['inspect', ...chunk], project_namespace: null, signal, scope });
    if (result.exit_code !== 0 || result.stdout.trim().length === 0) {
      throw new ComposeInspectionError(chunk, result.exit_code, result.stderr);
    }
    const parsed = parseStrictDocument(Buffer.from(result.stdout, 'utf8'), `docker-inspect/${String(chunk[0])}`);
    if (!Array.isArray(parsed)) throw new ComposeInspectionError(chunk, result.exit_code, 'the inspect output is not a JSON array');
    for (const entry of parsed) {
      const record = asRecord(entry);
      if (!record) throw new ComposeInspectionError(chunk, result.exit_code, 'an inspect element is not a mapping');
      collected.push(record);
    }
  }
  if (collected.length !== ids.length) throw new ComposeInspectionError(ids, 0, `asked for ${String(ids.length)} objects and the daemon returned ${String(collected.length)}`);
  return collected;
}

export class ComposeInspectionError extends Error {
  constructor(readonly ids: readonly string[], readonly exit_code: number | null, detail: string) {
    super(`docker inspect of ${String(ids.length)} id(s) failed (exit ${String(exit_code)}): ${detail}`);
    this.name = 'ComposeInspectionError';
  }
}

/**
 * Ask the daemon for the identity of an image reference this run intends to use. A reference the local
 * daemon does not have is reported as not found: this adapter never fetches it to make a run proceed.
 */
export async function resolveLocalImageIdentity(port: ComposeCommandPort, reference: string, scope: ComposeCommandRequest['scope'], signal: AbortSignal = new AbortController().signal): Promise<{ found: boolean; image_id: string | null; repo_digests: string[]; exit_code: number | null }> {
  const result = await port.run({ purpose: 'image-inspect', argv: ['image', 'inspect', reference], project_namespace: null, signal, scope });
  if (result.exit_code !== 0) return { found: false, image_id: null, repo_digests: [], exit_code: result.exit_code };
  const parsed = parseStrictDocument(Buffer.from(result.stdout, 'utf8'), `docker-image-inspect/${reference}`);
  const first = Array.isArray(parsed) ? asRecord(parsed[0]) : null;
  if (!first) return { found: false, image_id: null, repo_digests: [], exit_code: result.exit_code };
  const digests = Array.isArray(first.RepoDigests) ? first.RepoDigests.filter((entry): entry is string => typeof entry === 'string') : [];
  return { found: true, image_id: typeof first.Id === 'string' ? first.Id : null, repo_digests: digests, exit_code: result.exit_code };
}

export interface ImageClaim {
  claimed_image_id: string;
  container: InspectedObject | null | undefined;
  daemon_image_ids: readonly string[];
}

/**
 * Does an image identity claim hold for the container this run created? It only does when the claim is a
 * well-formed digest, equals the id the inspected container actually runs, and is among the ids recorded
 * for this run. An unknown, truncated or merely plausible claim is not satisfied.
 */
export function verifyImageClaim(claim: ImageClaim): { satisfied: boolean; reason: string; observed_image_id: string | null } {
  const observed = claim.container ? (typeof claim.container.Image === 'string' ? claim.container.Image : null) : null;
  if (typeof claim.claimed_image_id !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(claim.claimed_image_id)) {
    return { satisfied: false, reason: 'IMAGE_CLAIM_MALFORMED', observed_image_id: observed };
  }
  if (observed === null) return { satisfied: false, reason: 'CONTAINER_IMAGE_IDENTITY_UNAVAILABLE', observed_image_id: null };
  if (claim.claimed_image_id !== observed) return { satisfied: false, reason: 'IMAGE_CLAIM_NOT_OBSERVED', observed_image_id: observed };
  if (!claim.daemon_image_ids.includes(claim.claimed_image_id)) return { satisfied: false, reason: 'IMAGE_CLAIM_NOT_IN_RUN_INPUTS', observed_image_id: observed };
  return { satisfied: true, reason: 'IMAGE_CLAIM_MATCHES_INSPECTION', observed_image_id: observed };
}

/** The id set a manifest should carry: the images the created containers actually run, deduplicated. */
export function observedImageIds(objects: readonly InspectedObject[]): EnvironmentManifest['image_ids'] {
  const ids = new Set<string>();
  for (const object of objects) {
    const facts = containerFacts(object);
    // the container's own image id first; the compose label is only a fallback for an unreadable element
    if (facts.image_id.length > 0) ids.add(facts.image_id);
    else {
      const label = labelsOf(object)[COMPOSE_IMAGE_LABEL];
      if (typeof label === 'string' && label.length > 0) ids.add(label);
    }
  }
  return [...ids].sort();
}
