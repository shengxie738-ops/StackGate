import common from '../../../schemas/0.1/common.schema.json';
export interface Operation { service_id: string; method: string; path: string }
export function parseOperationKey(value: string): Operation {
  if (!new RegExp(common.$defs.OperationKey.pattern).test(value) || /[\r\n]/.test(value)) throw new Error('Invalid operation key');
  const colon = value.indexOf(':');
  const space = value.indexOf(' ', colon);
  return { service_id: value.slice(0, colon), method: value.slice(colon + 1, space), path: value.slice(space + 1) };
}
export function formatOperationKey(value: Operation): string {
  const key = `${value.service_id}:${value.method} ${value.path}`;
  parseOperationKey(key);
  return key;
}
export function resolveOperationKey(value: string, services: readonly string[]): string {
  if (value.includes(':')) {
    const parsed = parseOperationKey(value);
    if (!services.includes(parsed.service_id)) throw new Error('Unknown service');
    return value;
  }
  if (services.length !== 1) throw new Error('Operation requires an unambiguous service');
  const key = `${services[0]}:${value}`;
  parseOperationKey(key);
  return key;
}
export function isSafeId(value: string): boolean { return new RegExp(common.$defs.SafeId.pattern).test(value) && !/[\r\n]/.test(value); }
export function isRelativePath(value: string): boolean { return new RegExp(common.$defs.RelativePath.pattern).test(value) && !/[\r\n]/.test(value); }
export function isSha256(value: string): boolean { return /^[a-f0-9]{64}$/.test(value) && value.length === 64; }
export function isGitOid(value: string, format: 'sha1' | 'sha256'): boolean { return /^[a-f0-9]+$/.test(value) && value.length === (format === 'sha1' ? 40 : 64); }
