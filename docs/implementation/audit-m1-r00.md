# M1-R00 审计基线

HEAD: `a651054b987a160f54bf43e7e1e9bc8dec84b625`；分支 V1。开始时只有用户提供的两份新 Markdown 未跟踪；其余 diff 为空。Node v24.11.1、pnpm 11.2.2、Windows x64。

所有基线命令在修改源码之前运行。原 recorder 只接受 SG 编号，因此以下记录沿用 SG-028 并使用 m1-r00 标签；它们属于本审计基线，不改变历史 SG-028 状态。

- `pnpm verify:boundaries` → 0；[证据](evidence/sg-028-m1-r00-boundaries-2026-09-20T13-31-15-536Z.json)
- `pnpm build` → 0；[证据](evidence/sg-028-m1-r00-build-2026-09-20T13-28-28-923Z.json)
- `pnpm test:contract` → 0；[证据](evidence/sg-028-m1-r00-contract-2026-09-20T13-29-13-736Z.json)
- `pnpm install --frozen-lockfile` → 0；[证据](evidence/sg-028-m1-r00-install-2026-09-20T13-28-28-353Z.json)
- `pnpm test:integration` → 0；[证据](evidence/sg-028-m1-r00-integration-2026-09-20T13-29-19-117Z.json)
- `pnpm lint` → 0；[证据](evidence/sg-028-m1-r00-lint-2026-09-20T13-28-43-608Z.json)
- `pnpm verify:schemas` → 0；[证据](evidence/sg-028-m1-r00-schemas-2026-09-20T13-31-12-722Z.json)
- `pnpm verify:stage -- --stage M1` → 0；[证据](evidence/sg-028-m1-r00-stage-2026-09-20T13-31-20-485Z.json)
- `pnpm verify:tasks` → 0；[证据](evidence/sg-028-m1-r00-tasks-2026-09-20T13-31-16-787Z.json)
- `pnpm typecheck` → 0；[证据](evidence/sg-028-m1-r00-typecheck-2026-09-20T13-28-38-907Z.json)
- `pnpm test:unit` → 0；[证据](evidence/sg-028-m1-r00-unit-2026-09-20T13-29-01-155Z.json)

完整阶段结果：434 项 Vitest 单元、25 项开发工具测试、36 项合同、64 项集成，共 559 项，零失败/跳过。该结果不是对新审计缺陷的验收。新反例另行记录。

Recorder 增量经实际 RED（拒绝 M1-R00，退出 64 而不是子进程 7）到 GREEN 验证；现在支持独立审计任务编号并保留 Git HEAD/工作区身份。Linux/macOS 和 M2 运行闭环尚未验证；未执行付费模型、公开发布、远程 push 或部署。
