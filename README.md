# StackGate — M1 本地静态检查

M0、M1（SG-001—SG-028）已完成；M1 完整出口退出 0，559 项测试通过，详见 [阶段实测记录](docs/implementation/evidence/M1-summary.md)。当前提供真实 Git 输入快照、安全契约比较、任务确认、仓库外本地授权、静态影响分析和验收输入漂移报告。业务执行器、真实浏览器验收和发行包属于后续阶段。

本机固定 oasdiff **1.32.1**，安装来源、校验和、实测范围见 [工具记录](tools/compatibility-lock.json)。首次部署到其他路径/平台需要重新核验工具身份；不能把缺失工具当作无差异。

本机已验证 Node **24.11.1**、pnpm **11.2.2**，完整记录见 [COMPATIBILITY](docs/COMPATIBILITY.md)。

```powershell
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm build
node dist/cli.mjs --help
pnpm verify:stage -- --stage M1
```

构建产物为 `dist/cli.mjs`、`dist/core.mjs`、`dist/contracts.mjs`、`dist/types/`、Schema 和预设。未知命令/参数返回 64。

```powershell
node dist/cli.mjs doctor --root G:/your-project --json
node dist/cli.mjs init --root G:/your-project --preset fastapi-react --dry-run --json
node dist/cli.mjs task validate --root G:/your-project --file .stackgate/tasks/example.json --json
node dist/cli.mjs trust --root G:/your-project --review --json
node dist/cli.mjs scan --root G:/your-project --base HEAD --task .stackgate/tasks/example.json --json
```

`init --apply` 应用展示的非冲突模板与独立 gitignore 补丁；模板任务始终 DRAFT，需填写真实目标契约。`task confirm --file PATH --confirm-digest SHA256` 只接受重新读取后匹配的审查摘要；`trust --review --confirm-digest SHA256` 只写本地授权记录。摘要不是签名，授权提示不是 OS 沙箱。

`scan` 不导出候选契约、不运行业务脚本；0 表示取得诊断数据，所有报告的 runtime 都是 `NOT_EXECUTED`。未确认任务、未知影响、不支持 Schema、缺失基线和保护输入漂移均在报告中保留。当前根仓库无提交，扫描自身会报告缺少基线；测试在独立真实 Git 仓库中验证。

`pnpm test:unit` 包含 Vitest 单测与 Node 原生开发工具反例；`pnpm test:contract` 实测 Ajv、TypeScript、esbuild、YAML 和生成声明。`pnpm verify:schemas` 同时检查类型生成漂移和 OpenAPI 夹具。未实现的验收/发布入口明确非零，不代表已验收。

续接入口：[进度与实测证据](docs/implementation/PROGRESS.md)、[任务账本](docs/implementation/tasks.json)、[模块边界](docs/implementation/architecture-map.md)、[阻塞与未验证范围](docs/implementation/BLOCKERS.md)。M1 出口通过后下一项为 **SG-029：Run 目录、原子存储和幂等事件日志**。原始文档与保留副本保持原字节。
