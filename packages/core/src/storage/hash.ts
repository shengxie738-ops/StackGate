import { createHash } from 'node:crypto';
/** Digest the supplied view's raw bytes. Never decode or normalize source text. */
export function hashBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('hashBytes requires bytes');
  return createHash('sha256').update(bytes).digest('hex');
}
