import fs from 'node:fs/promises';
import path from 'node:path';
import { makeRepo } from './git-repo.js';
export async function taskProject(){
  const repo=await makeRepo('stackgate-task-');
  const config=JSON.parse(await fs.readFile('tests/fixtures/config/original.json','utf8'));
  const task=JSON.parse(await fs.readFile('tests/fixtures/tasks/draft.json','utf8'));
  await fs.mkdir(path.join(repo.root,'contracts'));await fs.mkdir(path.join(repo.root,'.stackgate','tasks'),{recursive:true});
  await fs.mkdir(path.join(repo.root,'tests','acceptance'),{recursive:true});
  await fs.writeFile(path.join(repo.root,'tests','acceptance','performance.test.ts'),'test("performance",()=>expect(1).toBe(1));');
  await fs.writeFile(path.join(repo.root,'contracts','openapi.json'),await fs.readFile('tests/fixtures/contracts/target.json'));
  await fs.writeFile(path.join(repo.root,'.stackgate.yaml'),JSON.stringify(config));
  const taskFile=path.join(repo.root,'.stackgate','tasks','performance.json');await fs.writeFile(taskFile,JSON.stringify(task));
  await repo.git('add','--','.');await repo.git('commit','-m','task fixtures');
  return {...repo,config,task,taskFile};
}
