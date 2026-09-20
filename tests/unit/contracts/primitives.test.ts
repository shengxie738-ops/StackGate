import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import common from '../../../schemas/0.1/common.schema.json';
import { parseOperationKey, formatOperationKey, resolveOperationKey, isSafeId, isRelativePath, isSha256, isGitOid } from '../../../packages/contracts/src/identifiers.js';

describe('stable identifiers and operation semantics', () => {
  it('freezes the diagnostic reason catalogue independently of display text', () => {
    const ajv = new Ajv2020({ strict: true }); ajv.addSchema(common);
    const validate = ajv.compile({ $ref: 'https://stackgate.local/schemas/0.1/common.schema.json#/$defs/ReasonCode' });
    expect(validate('CONFIG_INVALID')).toBe(true);
    expect(validate('ENV_PROVENANCE_INSUFFICIENT')).toBe(true);
    expect(validate('SUCCESS_WHATEVER')).toBe(false);
  });
  it.each(['api:GET /api/performance', 'api:POST /Users/', 'api:GET /users/{id}'])('round trips %s', key => {
    expect(formatOperationKey(parseOperationKey(key))).toBe(key);
  });
  it.each(['api:get /x', 'api:/x', 'api:GET /x\n', 'api:GET https://example.com/x', 'GET /x'])('rejects malformed key %s', key => expect(() => parseOperationKey(key)).toThrow());
  it('requires a unique service to expand shorthand', () => {
    expect(resolveOperationKey('GET /x', ['api'])).toBe('api:GET /x');
    expect(() => resolveOperationKey('GET /x', ['api', 'admin'])).toThrow();
  });
  it('rejects traversal, absolute, backslash and control paths', () => {
    for (const path of ['../secret', 'a/../b', '/tmp/x', 'C:/x', 'a\\b', 'a\n', 'a//b', 'a/./b']) expect(isRelativePath(path), path).toBe(false);
    expect(isRelativePath('apps/中文 path/index.ts')).toBe(true);
    expect(isSafeId('run_fixture')).toBe(true);
    expect(isSafeId('C:\\user\\token')).toBe(false);
  });
  it('keeps content hashes separate from Git object formats', () => {
    expect(isSha256('a'.repeat(64))).toBe(true);
    expect(isSha256('a'.repeat(40))).toBe(false);
    expect(isGitOid('a'.repeat(40), 'sha1')).toBe(true);
    expect(isGitOid('a'.repeat(64), 'sha256')).toBe(true);
    expect(isGitOid('a'.repeat(40), 'sha256')).toBe(false);
  });
  it('does not accept verdict INCOMPLETE as a check status', () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(common);
    const check = ajv.compile({ $ref: 'https://stackgate.local/schemas/0.1/common.schema.json#/$defs/CheckStatus' });
    expect(check('BLOCKED')).toBe(true);
    expect(check('INCOMPLETE')).toBe(false);
  });
});
