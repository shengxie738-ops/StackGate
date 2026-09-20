import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const [id, status, nextAction, ...files] = process.argv.slice(2);
const ledgerPath = 'docs/implementation/tasks.json';
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const task = ledger.tasks.find(item => item.task_id === id);
if (!task || !['IN_PROGRESS', 'DONE', 'BLOCKED', 'IMPLEMENTED_UNVERIFIED'].includes(status)) throw new Error('Invalid task/status');
const evidenceDir = 'docs/implementation/evidence';
task.verification = readdirSync(evidenceDir).filter(file => file.startsWith(id.toLowerCase() + '-') && file.endsWith('.json'))
  .map(file => JSON.parse(readFileSync(evidenceDir + '/' + file, 'utf8'))).sort((a, b) => a.started_at.localeCompare(b.started_at));
if (status === 'DONE' && (!task.verification.some(item => item.exit_code === 0) || !task.dependencies.every(dep => ledger.tasks.find(item => item.task_id === dep)?.status === 'DONE'))) throw new Error('Missing verification or incomplete dependencies');
task.status = status;
task.next_action = nextAction;
task.actual_files = [...new Set([...task.actual_files, ...files])];
for (const candidate of ledger.tasks) if (candidate.status === 'NOT_STARTED' && candidate.dependencies.every(dep => ledger.tasks.find(item => item.task_id === dep)?.status === 'DONE')) candidate.status = 'READY';
writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
const done = ledger.tasks.filter(item => item.status === 'DONE').map(item => item.task_id);
const latest = task.verification.slice(-5).map(item => `- ${item.command} → ${item.exit_code} (${item.result}); [evidence](${item.evidence_path.replace('docs/implementation/', '')})`).join('\n');
writeFileSync('docs/implementation/PROGRESS.md', `# StackGate implementation progress\n\n当前阶段：${task.phase}；阶段完成以实际 stage 出口为准。\n\n完成：${done.join(', ')}\n\n当前：${id} ${status}\n\n下一步：${nextAction}\n\n## 最近真实验证\n\n${latest}\n\n## 限制与续接\n\n- 原稿、计划保持原字节；提交字段为 null，尚未创建提交。\n- 未执行的工具/平台/产品流程不视为通过；详见 BLOCKERS.md 与 tools/compatibility-lock.json。\n- 每项完整红绿记录见 tasks.json；失败的历史记录保留，不代表修复后的当前状态。\n`);
console.log(`${id}: ${status}`);
