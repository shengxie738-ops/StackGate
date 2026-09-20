import { afterEach, expect, it, vi }  from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
// Real Git fixture work includes several snapshots and bounded subprocesses.
vi.setConfig({testTimeout:60000});
import { taskProject } from '../../support/task-project.js';
import { TaskService } from '../../../packages/core/src/services/task-service.js';
afterEach(()=>vi.restoreAllMocks());
it('does not treat a YAML CONFIRMED status as a confirmation record',async()=>{
  const repo=await taskProject();try{repo.task.status='CONFIRMED';await fs.writeFile(repo.taskFile,JSON.stringify(repo.task));const service=new TaskService(repo.root);
    const validated=await service.validate(repo.taskFile);expect(validated.valid).toBe(true);expect(validated.confirmation_digest).toMatch(/^[a-f0-9]{64}$/);
    await expect(service.loadConfirmed('performance',1)).rejects.toThrow();
  }finally{await repo.cleanup();}
});
it('confirms exact input into an immutable revision and repeats idempotently',async()=>{
  const repo=await taskProject();try{const service=new TaskService(repo.root),preview=await service.validate(repo.taskFile);
    const result=await service.confirm(repo.taskFile,preview.confirmation_digest!,{authorized:true,source:'local-review'});
    const before=await fs.readFile(path.join(repo.root,result.confirmation_ref));
    const again=await service.confirm(repo.taskFile,preview.confirmation_digest!,{authorized:true,source:'local-review'});
    expect(again.confirmation_ref).toBe(result.confirmation_ref);expect(await fs.readFile(path.join(repo.root,result.confirmation_ref))).toEqual(before);
    const stored=await service.loadConfirmed('performance',1);expect(stored.task.goal).toBe(repo.task.goal);expect(stored.confirmation.confirmation_source).toBe('local-review');
    expect(stored.protected_inputs).toMatchObject({check_contracts:repo.config.checks});
    expect(stored.target_bytes).toEqual(await fs.readFile(path.join(repo.root,'contracts/openapi.json')));
    expect(JSON.parse(await fs.readFile(repo.taskFile,'utf8')).status).toBe('DRAFT');
  }finally{await repo.cleanup();}
});
it('rejects missing authorization, a changed target and mutated protected inputs',async()=>{
  const repo=await taskProject();try{const service=new TaskService(repo.root),preview=await service.validate(repo.taskFile);
    await expect(service.confirm(repo.taskFile,preview.confirmation_digest!,{authorized:false,source:'local-review'})).rejects.toThrow();
    await fs.appendFile(path.join(repo.root,'contracts/openapi.json'),'\n');
    await expect(service.confirm(repo.taskFile,preview.confirmation_digest!,{authorized:true,source:'local-review'})).rejects.toThrow();
    const latest=await service.validate(repo.taskFile);await fs.appendFile(path.join(repo.root,'tests/acceptance/performance.test.ts'),'\n// drift');
    await expect(service.confirm(repo.taskFile,latest.confirmation_digest!,{authorized:true,source:'local-review'})).rejects.toThrow();
  }finally{await repo.cleanup();}
});
it('returns a null digest for missing target/check references',async()=>{
  const repo=await taskProject();try{repo.task.required_checks=['absent'];await fs.writeFile(repo.taskFile,JSON.stringify(repo.task));const report=await new TaskService(repo.root).validate(repo.taskFile);expect(report.valid).toBe(false);expect(report.confirmation_digest).toBeNull();}finally{await repo.cleanup();}
});
it('rejects changes during confirm and never seals a stale revision',async()=>{
  const repo=await taskProject();try{const service=new TaskService(repo.root),preview=await service.validate(repo.taskFile);const mkdir=fs.mkdir.bind(fs);let changed=false;
    vi.spyOn(fs,'mkdir').mockImplementation((async(...args:Parameters<typeof fs.mkdir>)=>{const result=await mkdir(...args);if(!changed&&String(args[0]).includes('revisions')){changed=true;await fs.appendFile(path.join(repo.root,'contracts/openapi.json'),'\n');}return result;}) as typeof fs.mkdir);
    await expect(service.confirm(repo.taskFile,preview.confirmation_digest!,{authorized:true,source:'local-review'})).rejects.toThrow();
    await expect(service.loadConfirmed('performance',1)).rejects.toThrow();
  }finally{await repo.cleanup();}
});
it('rejects tampered immutable target and forces a new revision for changed task content',async()=>{
  const repo=await taskProject();try{const service=new TaskService(repo.root),preview=await service.validate(repo.taskFile);const result=await service.confirm(repo.taskFile,preview.confirmation_digest!,{authorized:true,source:'local-review'});
    repo.task.goal='different';await fs.writeFile(repo.taskFile,JSON.stringify(repo.task));const next=await service.validate(repo.taskFile);
    await expect(service.confirm(repo.taskFile,next.confirmation_digest!,{authorized:true,source:'local-review'})).rejects.toThrow();
    await fs.appendFile(path.join(path.dirname(path.join(repo.root,result.confirmation_ref)),'target.contract'),'\n');await expect(service.loadConfirmed('performance',1)).rejects.toThrow();
  }finally{await repo.cleanup();}
});
it('binds ignored protected inputs into the reviewed confirmation digest',async()=>{
  const repo=await taskProject();try{const service=new TaskService(repo.root);const ignored=path.join(repo.root,'tests','acceptance','ignored.test.ts');
    await fs.writeFile(path.join(repo.root,'.gitignore'),'tests/acceptance/ignored.test.ts\n');await fs.writeFile(ignored,'original acceptance');
    const before=await service.validate(repo.taskFile);expect(before.valid).toBe(true);await fs.writeFile(ignored,'weakened acceptance');
    const after=await service.validate(repo.taskFile);expect(after.valid).toBe(true);expect(after.confirmation_digest).not.toBe(before.confirmation_digest);
    await expect(service.confirm(repo.taskFile,before.confirmation_digest!,{authorized:true,source:'local-review'})).rejects.toThrow();
  }finally{await repo.cleanup();}
});
it('rejects tampered task-derived preview fields and sealed local identity',async()=>{
  const repo=await taskProject();try{const service=new TaskService(repo.root),preview=await service.validate(repo.taskFile);const result=await service.confirm(repo.taskFile,preview.confirmation_digest!,{authorized:true,source:'local-review'});
    const file=path.join(repo.root,path.dirname(result.confirmation_ref),'preview.json'),original=JSON.parse(await fs.readFile(file,'utf8'));
    for(const patch of [{required_checks:[]},{task_id:'other'},{revision:999},{configuration_hash:'b'.repeat(64)},{repo_id:'c'.repeat(64)},{worktree_id:'d'.repeat(64)}]){await fs.writeFile(file,JSON.stringify({...original,...patch}));await expect(service.loadConfirmed('performance',1)).rejects.toThrow();}
  }finally{await repo.cleanup();}
});
it('rejects unsupported root-leading protected globs instead of omitting ignored files',async()=>{
  const repo=await taskProject();try{repo.config.security.protected_inputs.push('**/secret-check.ts');await fs.writeFile(path.join(repo.root,'.stackgate.yaml'),JSON.stringify(repo.config));
    const result=await new TaskService(repo.root).validate(repo.taskFile);expect(result.valid).toBe(false);expect(result.confirmation_digest).toBeNull();
  }finally{await repo.cleanup();}
});
it('rejects a required operation naming a service other than the target contract service',async()=>{
  const repo=await taskProject();try{repo.task.required_operations=['other:GET /api/performance'];await fs.writeFile(repo.taskFile,JSON.stringify(repo.task));
    const result=await new TaskService(repo.root).validate(repo.taskFile);expect(result.valid).toBe(false);expect(result.confirmation_digest).toBeNull();
  }finally{await repo.cleanup();}
});
