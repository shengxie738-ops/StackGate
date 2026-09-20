import { pathToFileURL } from 'node:url';
import pkg from '../../../package.json';
import { doctor } from './commands/doctor.js';
import { parseArguments } from './arguments.js';
import { ServiceError } from '../../../packages/core/src/services/service-error.js';
import path from 'node:path';
import { configurationError } from '../../../packages/core/src/services/service-error.js';
import { initCommand } from './commands/init.js';
import { taskCommand } from './commands/task.js';
import { trustCommand } from './commands/trust.js';
import { scanCommand } from './commands/scan.js';
export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
    process.stdout.write('StackGate 0.1\nUsage: stackgate --help | --version\n  doctor [--root PATH] [--json]\n  init --preset fastapi-react [--dry-run | --apply] [--root PATH] [--json]\n  task validate --file PATH [--root PATH] --json\n  task confirm --file PATH --confirm-digest SHA256 [--root PATH] --json\n  trust --review [--confirm-digest SHA256] [--root PATH] --json\n  scan [--base REF] [--task PATH] [--profile ID] [--root PATH] --json\nStatic operations never execute repository scripts.\n');
    return 0;
  }
  if (argv.length === 1 && argv[0] === '--version') {
    process.stdout.write(pkg.version + '\n');
    return 0;
  }
  try {
    if(argv[0]==='scan'){
      const o=parseArguments(argv.slice(1),['--root','--base','--task','--profile'],['--json']);
      return await scanCommand(typeof o['--root']==='string'?o['--root']:process.cwd(),{...(typeof o['--base']==='string'?{base:o['--base']}:{}),...(typeof o['--task']==='string'?{task:o['--task']}:{}),...(typeof o['--profile']==='string'?{profile:o['--profile']}:{})});
    }
    if(argv[0]==='init'){
      const o=parseArguments(argv.slice(1),['--root','--preset'],['--json','--dry-run','--apply']);if(o['--preset']!=='fastapi-react'||(o['--apply']&&o['--dry-run']))throw configurationError('Expected --preset fastapi-react and either --dry-run or --apply');return await initCommand(typeof o['--root']==='string'?o['--root']:process.cwd(),o['--apply']===true);
    }
    if(argv[0]==='task'){
      const action=argv[1];if(action!=='validate'&&action!=='confirm')throw configurationError('Expected task validate or confirm');
      const o=parseArguments(argv.slice(2),['--root','--file',...(action==='confirm'?['--confirm-digest']:[])],['--json']),root=typeof o['--root']==='string'?o['--root']:process.cwd();
      if(typeof o['--file']!=='string')throw configurationError('Task --file is required');if(action==='confirm'&&typeof o['--confirm-digest']!=='string')throw configurationError('CONFIRMATION_REQUIRED: provide the reviewed --confirm-digest');
      return await taskCommand(root,action,path.resolve(root,o['--file']),typeof o['--confirm-digest']==='string'?o['--confirm-digest']:undefined);
    }
    if(argv[0]==='trust'){
      const o=parseArguments(argv.slice(1),['--root','--confirm-digest'],['--json','--review']);if(!o['--review'])throw configurationError('trust requires --review');return await trustCommand(typeof o['--root']==='string'?o['--root']:process.cwd(),typeof o['--confirm-digest']==='string'?o['--confirm-digest']:undefined);
    }
    if(argv[0]==='doctor'){
      const options=parseArguments(argv.slice(1),['--root'],['--json']);
      return await doctor(typeof options['--root']==='string'?options['--root']:process.cwd(),options['--json']===true);
    }
  }catch(error){
    if(error instanceof ServiceError){process.stderr.write(error.message+'\n');if(argv.includes('--json'))process.stdout.write(JSON.stringify({diagnostics:error.diagnostics,runtime:'NOT_EXECUTED'})+'\n');return error.exit_code;}
    process.stderr.write('Unable to inspect project safely.\n');return 3;
  }
  process.stderr.write('Unknown or unsupported command/arguments. Use --help.\n');
  return 64;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
