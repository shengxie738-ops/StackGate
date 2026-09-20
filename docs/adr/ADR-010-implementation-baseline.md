# ADR-010：M0 实现与工具基线

日期：2026-09-20。状态：采用；仅限已实测的 M0 范围。

初始目录只有用户提供的两份 Markdown，未有 Git 或代码。初始化单个本地 `main` 仓库、单一私有 pnpm workspace；未重建第二套脚手架，未修改原稿，未提交或推送。

采用实际 Node 24.11.1 / pnpm 11.2.2，全部依赖精确锁定。TypeScript 严格编译生成声明，esbuild 生成可执行 ESM 和库入口。Schema 2020-12 是结构真源，TypeScript 从 Schema 生成并逐字节检查漂移。

Gate 只接收领域事实、必检集合和前置条件，独立计算 verdict/freshness/decision/exit_code；不使用系统时间、文件系统、模型或进程。Run 与重新评估文档分离。业务确认与执行信任分离；M0 的结构有效性不等于密码学认证或可信 CI 来源。

端口与生产纯逻辑分离；fake 仅在 tests 内。AST 边界检查拒绝核心 I/O、环境/时间访问、产品导入测试替身和 reporter 执行业务。开发用 record/stage 脚本记录真实子进程，不是产品运行器。

三方样例保持 baseline/target/candidate 语义：故障候选不反向放宽 target。五类 Gate 金样例为显式预期值，测试实际调用纯函数比对；它们不冒充产品 Run 证据。真实应用演示留待 M3。

OpenAPI 官方文档 meta-schema 的已知 Ajv 动态锚点限制通过仅夹具使用的静态绑定处理，原始 Schema 字节、响应校验目标和严格响应验证均不改变。限制详见 [COMPATIBILITY](../COMPATIBILITY.md)；SG-019/022 不可据此宣称完整动态引用支持。

每项任务先保留失败反例，再保存实现后命令与退出码。失败历史不删除。M0 出口执行九项登记必检；工具能力缺失保持 UNKNOWN，后续未实现入口非零。兼容性 lock 中的开发证据不是防篡改的可信 CI 认证，后续可信路径按计划实现。
