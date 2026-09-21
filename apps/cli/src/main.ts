import { pathToFileURL } from 'node:url';
import pkg from '../../../package.json';
import { doctor } from './commands/doctor.js';
import { parseArguments } from './arguments.js';
import {errorResult,writeOutput,type CommandResult} from './output.js';
import path from 'node:path';
import { configurationError } from '../../../packages/core/src/services/service-error.js';
import { initCommand } from './commands/init.js';
import { taskCommand } from './commands/task.js';
import { trustCommand } from './commands/trust.js';
import { scanCommand } from './commands/scan.js';
import {planCommand,runCommand,gateCommand,reportCommand,handoffCommand,handoffValidateCommand,cleanCommand} from './commands/execution.js';
async function dispatch(argv: string[]): Promise<CommandResult> {
  if (argv.length === 0 || argv[0] === '--help') {
    parseArguments(argv.slice(1),[],['--json']);
    const help='StackGate 0.1\nUsage: stackgate --help | --version\n  doctor [--root PATH] [--json]\n  init --preset fastapi-react [--dry-run | --apply] [--root PATH] [--json]\n  task validate --file PATH [--root PATH] --json\n  task confirm --file PATH --confirm-digest SHA256 [--root PATH] --json\n  trust --review [--confirm-digest SHA256] [--root PATH] --json\n  scan [--base REF] [--task PATH] [--profile ID] [--root PATH] --json\nStatic operations never execute repository scripts.\n';
    const allHelp=help+'  plan --task PATH --profile ID [--base REF] [--root PATH] --json\n  run --plan PLAN_ID [--root PATH] --json\n  gate --run RUN_ID [--strict] [--root PATH] --json\n  report --run RUN_ID --format json|terminal|markdown|junit [--output PATH] [--root PATH]\n  handoff --run RUN_ID --target codex|claude|manual [--output PATH] [--root PATH]\n  handoff --validate PATH [--root PATH] --json\n  clean --run RUN_ID [--dry-run | --apply --confirm-digest SHA256] [--root PATH] --json\nHandoff accepts either --run or --validate, never both. Validation is readonly and never reruns checks.\n';
    return {data:{help:allHelp},text:allHelp,exit_code:0,diagnostics:[]};
  }
  if (argv[0] === '--version') {
    parseArguments(argv.slice(1),[],['--json']);
    return {data:{version:pkg.version},text:pkg.version,exit_code:0,diagnostics:[]};
  }
    if(argv[0]==='plan'){
      const o=parseArguments(argv.slice(1),['--root','--task','--profile','--base'],['--json']);if(typeof o['--task']!=='string'||typeof o['--profile']!=='string')throw configurationError('plan requires --task and --profile');return planCommand(typeof o['--root']==='string'?o['--root']:process.cwd(),o['--task'],o['--profile'],typeof o['--base']==='string'?o['--base']:undefined);
    }
    if(argv[0]==='run'){
      const o=parseArguments(argv.slice(1),['--root','--plan','--previous-run'],['--json']);if(typeof o['--plan']!=='string'||!/^plan_[a-f0-9]{64}$/.test(o['--plan'])||typeof o['--previous-run']==='string'&&!/^run_[A-Za-z0-9_-]+$/.test(o['--previous-run']))throw configurationError('run requires valid plan and optional previous run IDs');return runCommand(typeof o['--root']==='string'?o['--root']:process.cwd(),o['--plan'],typeof o['--previous-run']==='string'?o['--previous-run']:undefined);
    }
    if(['gate','report','handoff','clean'].includes(argv[0]??'')){
      const command=argv[0]!,values=['--root','--run',...(command==='report'?['--format','--output']:command==='handoff'?['--target','--output','--validate']:command==='clean'?['--confirm-digest']:[])],flags=['--json',...(command==='gate'?['--strict']:command==='clean'?['--dry-run','--apply']:[])],o=parseArguments(argv.slice(1),values,flags),root=typeof o['--root']==='string'?o['--root']:process.cwd();
      if(command==='handoff'&&typeof o['--validate']==='string'){if(typeof o['--run']==='string'||typeof o['--output']==='string')throw configurationError('handoff --validate is mutually exclusive with --run and writes nothing, so it cannot take --output');return handoffValidateCommand(root,o['--validate']);}
      if(typeof o['--run']!=='string'||!/^run_[A-Za-z0-9_-]+$/.test(o['--run']))throw configurationError('A valid --run is required');
      if(command==='gate')return gateCommand(root,o['--run']);
      if(command==='report'){const format=o['--format']??'terminal';if(!['json','terminal','markdown','junit'].includes(String(format)))throw configurationError('Unsupported report format');return reportCommand(root,o['--run'],format as 'json'|'terminal'|'markdown'|'junit',typeof o['--output']==='string'?o['--output']:undefined);}
      if(command==='handoff'){const target=o['--target']??'manual';if(!['codex','claude','manual'].includes(String(target)))throw configurationError('Unsupported handoff target');return handoffCommand(root,o['--run'],target as 'codex'|'claude'|'manual',typeof o['--output']==='string'?o['--output']:undefined);}
      if(o['--apply']&&o['--dry-run']||o['--apply']&&(typeof o['--confirm-digest']!=='string'||! /^[a-f0-9]{64}$/.test(o['--confirm-digest'])))throw configurationError('clean --apply requires the reviewed --confirm-digest and cannot combine --dry-run');return cleanCommand(root,o['--run'],o['--apply']===true,typeof o['--confirm-digest']==='string'?o['--confirm-digest']:undefined);
    }
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
      const options=parseArguments(argv.slice(1),['--root','--run'],['--json']),root=typeof options['--root']==='string'?options['--root']:process.cwd();
      if(typeof options['--run']==='string'&&!/^run_[A-Za-z0-9_-]+$/.test(options['--run']))throw configurationError('Invalid diagnostic run ID');
      const report=await doctor(root);if(typeof options['--run']!=='string')return report;
      const resources=await cleanCommand(root,options['--run'],false);return {...report,data:{...report.data,resources:resources.data},exit_code:report.exit_code||resources.exit_code,diagnostics:[...report.diagnostics,...resources.diagnostics]};
    }
  throw configurationError('Unknown or unsupported command/arguments. Use --help.');
}
export async function main(argv:string[]):Promise<number> {
  const operation=argv[0]==='--help'||argv.length===0?'help':argv[0]==='--version'?'version':argv[0]==='task'&&['validate','confirm'].includes(argv[1]??'')?'task '+argv[1]:argv[0]??'help';
  let result:CommandResult;
  try {result=await dispatch(argv);} catch(error){result=errorResult(error);}
  return writeOutput(operation,result,argv.includes('--json'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
