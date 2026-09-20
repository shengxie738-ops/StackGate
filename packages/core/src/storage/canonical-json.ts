import { StorageError } from './storage-error.js';
/** Plain JSON only: stable key ordering, no toJSON/getters, no lossy substitutions. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();
  const invalid = (): never => { throw new StorageError('INVALID_JSON', 'Expected finite, lossless plain JSON without cycles or accessors'); };
  const text = (input: string): string => {
    if (Buffer.from(input, 'utf8').toString('utf8') !== input) invalid();
    return JSON.stringify(input);
  };
  function encode(input: unknown, depth: number): string {
    if (depth > 512) return invalid();
    if (input === null) return 'null';
    if (typeof input === 'string') return text(input);
    if (typeof input === 'boolean') return String(input);
    if (typeof input === 'number') return Number.isFinite(input) ? JSON.stringify(input) : invalid();
    if (typeof input !== 'object' || active.has(input)) return invalid();
    const array = Array.isArray(input);
    const prototype: unknown = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(input);
    if (keys.some(key => typeof key === 'symbol')) return invalid();
    for (const key of keys as string[]) {
      if (array && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return invalid();
    }
    active.add(input);
    try {
      if (array) {
        if (keys.length !== input.length + 1) return invalid();
        const values: string[] = [];
        for (let index = 0; index < input.length; index++) {
          const descriptor = descriptors[String(index)];
          if (!descriptor) return invalid();
          values.push(encode(descriptor.value, depth + 1));
        }
        return '[' + values.join(',') + ']';
      }
      return '{' + (keys as string[]).sort().map(key => text(key) + ':' + encode(descriptors[key]?.value, depth + 1)).join(',') + '}';
    } finally { active.delete(input); }
  }
  return encode(value, 0);
}
