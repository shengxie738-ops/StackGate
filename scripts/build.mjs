import { build } from 'esbuild';
import { cp, mkdir, access, readFile } from 'node:fs/promises';
import {packageTool} from './package-tool.mjs';
import { execFileSync } from 'node:child_process';
await mkdir('dist', { recursive: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.build.json'], { stdio: 'inherit' });
const entries = { cli: 'apps/cli/src/main.ts' };
for (const [name, file] of Object.entries({
  contracts: 'packages/contracts/src/index.ts',
  core: 'packages/core/src/index.ts',
  'playwright-reporter': 'packages/adapter-playwright/src/index.ts',
})) {
  try { await access(file); entries[name] = file; } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await build({ entryPoints: entries, bundle: true, platform: 'node', target: 'node24', define: {STACKGATE_BUNDLED:'true'},
  format: 'esm', outdir: 'dist', outExtension: { '.js': '.mjs' }, sourcemap: true,
  banner: { js: "import { createRequire as __sgCreateRequire } from 'node:module'; import { fileURLToPath as __sgFileUrl } from 'node:url'; import { dirname as __sgDirname } from 'node:path'; const require = __sgCreateRequire(import.meta.url); const __filename = __sgFileUrl(import.meta.url); const __dirname = __sgDirname(__filename);" } });
for (const dir of ['schemas', 'presets', 'integrations']) {
  try { await access(dir); await cp(dir, 'dist/' + dir, { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await cp('schemas', 'dist/types/schemas', { recursive: true });
await mkdir('dist/runner-local',{recursive:true});
for(const file of ['windows-job.ps1','windows-job.cs'])await cp('packages/runner-local/src/'+file,'dist/runner-local/'+file);
const capability=JSON.parse(await readFile('tools/oasdiff/capabilities.json','utf8'));
if(capability.platform===process.platform+'-'+process.arch){
  const tool=`tools/bin/oasdiff-${capability.version}/oasdiff${process.platform==='win32'?'.exe':''}`;
  const result=await packageTool({sourceRoot:'.',destinationRoot:'dist',relativePath:tool,expectedDigest:capability.expected_sha256});
  if(result==='NOT_INSTALLED')console.warn('oasdiff not installed; stale packaged copy removed, built CLI will report capability missing.');
}
console.log('Built: ' + Object.keys(entries).join(', '));
