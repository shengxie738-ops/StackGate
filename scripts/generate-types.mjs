import { compile } from 'json-schema-to-typescript';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
const dir = 'schemas/0.1';
const output = 'packages/contracts/src/generated';
export async function generateTypes(check = false) {
  await mkdir(output, { recursive: true });
  const names = (await readdir(dir)).filter(name => name.endsWith('.schema.json')).sort();
  let registry = '// Generated from schemas/0.1; do not edit.\n';
  for (const [index, name] of names.entries()) {
    const schema = JSON.parse(await readFile(dir + '/' + name, 'utf8'));
    const input = name === 'common.schema.json' ? { ...schema, anyOf: Object.keys(schema.$defs).map(key => ({ $ref: '#/$defs/' + key })) } : schema;
    const content = await compile(input, schema.title, { cwd: dir + '/', bannerComment: '/* Generated from JSON Schema; do not edit. */', additionalProperties: false, format: true });
    const target = output + '/' + name.replace('.schema.json', '.ts');
    if (check) {
      if (await readFile(target, 'utf8') !== content) throw new Error('Generated type drift: ' + target);
    } else await writeFile(target, content);
    registry += `import schema${index} from '../../../../schemas/0.1/${name}';\n`;
  }
  registry += `export const schemas = [${names.map((_, index) => 'schema' + index).join(', ')}];\n`;
  const target = output + '/schema-registry.ts';
  if (check) { if (await readFile(target, 'utf8') !== registry) throw new Error('Schema registry drift'); }
  else await writeFile(target, registry);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/generate-types.mjs')) {
  await generateTypes(process.argv.includes('--check'));
  console.log('Schema-derived types ' + (process.argv.includes('--check') ? 'verified' : 'generated'));
}
