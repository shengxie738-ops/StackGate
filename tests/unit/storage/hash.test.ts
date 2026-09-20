import { expect, it } from 'vitest';
import { hashBytes } from '../../../packages/core/src/storage/hash.js';
import { canonicalJson } from '../../../packages/core/src/storage/canonical-json.js';

it('hashes exact bytes with the SHA-256 known answer and respects typed-array offsets', () => {
  expect(hashBytes(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(hashBytes(Buffer.from('xabcx').subarray(1,4))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(hashBytes(Buffer.from('中文\n'))).not.toBe(hashBytes(Buffer.from('中文\r\n')));
});
it('sorts object keys recursively while preserving arrays, Unicode and input objects', () => {
  const value={z:[{b:2,a:1},3,1],a:'中文'};
  expect(canonicalJson(value)).toBe('{"a":"中文","z":[{"a":1,"b":2},3,1]}');
  expect(Object.keys(value)).toEqual(['z','a']);
  expect(canonicalJson(JSON.parse('{"__proto__":{"z":1},"10":10,"2":2}'))).toBe('{"10":10,"2":2,"__proto__":{"z":1}}');
});
it.each([NaN, Infinity, -Infinity, undefined, 1n, () => 1, Symbol('x'), new Date(), /x/, new Map(), [undefined], {x:undefined}, Array(1), '\ud800'])('rejects lossy or executable JSON input %#', value => {
  expect(() => canonicalJson(value)).toThrowError(expect.objectContaining({code:'INVALID_JSON'}));
});
it('rejects cycles, accessors, symbol keys and array properties without executing getters', () => {
  const cycle: Record<string,unknown>={};cycle.self=cycle;
  let invoked=false;
  const getter={get value(){invoked=true;return 1;}};
  const array=Object.assign([1],{extra:2});
  for(const value of [cycle,getter,array,{[Symbol('key')]:1}]) expect(()=>canonicalJson(value)).toThrowError(expect.objectContaining({code:'INVALID_JSON'}));
  expect(invoked).toBe(false);
  const shared={x:1};expect(canonicalJson([shared,shared])).toBe('[{"x":1},{"x":1}]');
});
