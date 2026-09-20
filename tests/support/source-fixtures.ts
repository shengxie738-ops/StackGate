import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
export function sourceFixture(section: '12.2' | '12.3'): unknown {
  const text = readFileSync('docs/specs/stackgate-v0.1.md', 'utf8');
  const block = text.slice(text.indexOf('## ' + section)).match(/\x60\x60\x60yaml\r?\n([\s\S]*?)\x60\x60\x60/);
  if (!block?.[1]) throw new Error('Missing original fixture');
  return parse(block[1]);
}
