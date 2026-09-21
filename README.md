# StackGate — M1 静态检查与 M2 本地执行

M0、M1（SG-001—SG-028）及 M1-R00—R07 审计修复已完成，修复后的 M1 完整出口退出 0、591 项测试通过，见 [审计修复实测记录](docs/implementation/evidence/M1-audit-summary.md)。M2（SG-029—SG-050）已完成：`pnpm verify:stage -- --stage M2` 的 13 项注册检查全部退出 0，独立覆盖 841 项（单元 518 + 开发工具反例 29 + 合同 57 + 集成 237），见 [M2 验收摘要](docs/implementation/evidence/M2-summary.md)。

当前提供真实 Git 输入快照、安全契约比较、任务确认、仓库外本地授权、静态影响分析，以及 M2 的本地真实执行：固定计划、跨进程资源锁、真实 Windows Runner、证据持久化与封存、封存后不可变、Gate 再认证与重新评估、四种只读报告、失败交接包与接手校验、安全清理预览。M2 只证明执行器与证据链可用，不等于全栈 MVP：真实后端来源、HTTP Probe 执行、浏览器与 Compose 链路仍属 M3 且未验证。

本机固定 oasdiff **1.32.1**，安装来源、校验和、实测范围见 [工具记录](tools/compatibility-lock.json)。首次部署到其他路径/平台需要重新核验工具身份；不能把缺失工具当作无差异。

本机已验证 Node **24.11.1**、pnpm **11.2.2**，完整记录见 [COMPATIBILITY](docs/COMPATIBILITY.md)。

```powershell
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm build
node dist/cli.mjs --help
pnpm verify:stage -- --stage M1
pnpm verify:stage -- --stage M2
```

`verify:stage -- --stage M2` 依次执行 source、tasks、schemas、boundaries、build、typecheck、unit、lint、contract、integration 与 `m2-runner`/`m2-evidence`/`m2-gate` 共 13 项注册检查，任一非零立即返回该退出码；缺少必检、未登记检查或未验证工具会在执行前被拒绝。集成用例各自创建真实仓库与子进程，测试调度并发上限固定在 2（`vitest.config.ts`），产品内命令超时不受此影响。

构建产物为 `dist/cli.mjs`、`dist/core.mjs`、`dist/contracts.mjs`、`dist/types/`、Schema 和预设。未知命令/参数返回 64。

```powershell
node dist/cli.mjs doctor --root G:/your-project --json
node dist/cli.mjs init --root G:/your-project --preset fastapi-react --dry-run --json
node dist/cli.mjs task validate --root G:/your-project --file .stackgate/tasks/example.json --json
node dist/cli.mjs trust --root G:/your-project --review --json
node dist/cli.mjs scan --root G:/your-project --base HEAD --task .stackgate/tasks/example.json --json
```

`init --apply` 应用展示的非冲突模板与独立 gitignore 补丁；模板任务始终 DRAFT，需填写真实目标契约。`task confirm --file PATH --confirm-digest SHA256` 只接受重新读取后匹配的审查摘要；`trust --review --confirm-digest SHA256` 只写本地授权记录。摘要不是签名，授权提示不是 OS 沙箱。

`scan` 不导出候选契约、不运行业务脚本；0 表示取得诊断数据，其 runtime 为 `NOT_EXECUTED`。未确认任务、未知影响、不支持 Schema、缺失基线和保护输入漂移均在报告中保留。根仓库已有 M1 提交 `a651054`；测试使用独立真实 Git 仓库，基线是否存在由实际仓库状态决定。

M2 的本地执行入口为 `plan`、`run`、`gate`、`report`、`handoff`、`clean`，以及带 `--run` 的只读 `doctor`。退出码固定为 0 ALLOW、1 业务失败、2 INCOMPLETE、3 证据/工具完整性错误、4 STALE、64 参数或配置错误；优先级 64→3→4→1→2→0 且保留全部原因。`report` 与 `handoff` 返回 0 只表示只读操作完成，不代表 Gate 通过；四种 renderer 只投影同一已验证视图，JUnit 展示不决定 job 状态，CI 必须使用 `run`/`gate` 的退出码。分类规则见 [检查结论分类](docs/diagnostics/check-classification.md)，崩溃、锁归属与清理语义见 [恢复说明](docs/diagnostics/recovery.md)。

`handoff --run RUN_ID --target codex|claude|manual` 只从已封存且验证通过的 Run 生成内容寻址的派生交接文件，写出 `handoff_id`、`handoff_json_path`、`handoff_markdown_path`、`freshness`，不修改 Run 事实；相同内容重复执行不覆盖既有字节。`handoff --validate PATH` 与 `--run` 互斥、只读、不重跑检查，输出 `valid_for_current_inputs`、`freshness`、`task_revision_matches`、`reasons`；身份不符时命令仍返回 0 表示诊断完成，损坏或摘要不符的包按结构/完整性以非零退出且不会输出伪 valid。交接包不是授权凭据，也不包含日志原文、凭证或全量源码。

```powershell
node dist/cli.mjs plan --root G:/your-project --task .stackgate/tasks/example.json --profile PROFILE_ID --json
node dist/cli.mjs run --root G:/your-project --plan PLAN_ID --json
node dist/cli.mjs gate --root G:/your-project --run RUN_ID --strict --json
node dist/cli.mjs report --root G:/your-project --run RUN_ID --format junit --json
node dist/cli.mjs handoff --root G:/your-project --run RUN_ID --target codex --json
node dist/cli.mjs handoff --root G:/your-project --validate .stackgate/handoffs/HANDOFF_ID.json --json
node dist/cli.mjs clean --root G:/your-project --run RUN_ID --dry-run --json
node dist/cli.mjs doctor --root G:/your-project --run RUN_ID --json
```

`run` 前必须已有匹配的任务确认与本地授权记录，且执行前重新认证计划、当前输入、工具字节与信任身份；执行后与封存后各有一次新鲜度复核。`clean` 默认只预览，`--apply` 需要预览摘要且只清理已核验归属的自有资源；无法证明归属时保留并告警，不终止历史 PID，不删除未知目录、封存证据或计划。`doctor --run` 为只读诊断。

`pnpm test:unit` 包含 Vitest 单测与 Node 原生开发工具反例；`pnpm test:contract` 实测 Ajv、TypeScript、esbuild、YAML 和生成声明。`pnpm verify:schemas` 同时检查类型生成漂移和 OpenAPI 夹具。未实现的验收/发布入口明确非零，不代表已验收。

续接入口：[进度与实测证据](docs/implementation/PROGRESS.md)、[任务账本](docs/implementation/tasks.json)、[模块边界](docs/implementation/architecture-map.md)、[阻塞与未验证范围](docs/implementation/BLOCKERS.md)。M2 按 v0.2 修复与执行计划推进；原始文档与保留副本保持原字节。
