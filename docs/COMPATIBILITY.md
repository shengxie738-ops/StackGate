# 本机实测兼容性

测试日期：2026-09-20。实际平台：Windows `win32-x64`，OS release `10.0.26200`。只声明本机 M0—M2 开发基线；WSL2/Linux、Linux CI、macOS、生产环境和发行包均未验证。

精确版本、来源、校验和/锁完整性、测试能力、时间和真实证据引用保存在 [compatibility-lock.json](../tools/compatibility-lock.json)。

| 工具 | 实际版本 | 已运行能力 |
| --- | --- | --- |
| Node.js | 24.11.1 | ESM 构建产物、原生测试、无隐式 shell 子进程 |
| pnpm | 11.2.2 | frozen lockfile 安装、Windows JS 入口 |
| TypeScript / @types/node | 5.9.3 / 24.13.6 | 严格类型检查、声明生成与下游消费、真实错误退出 |
| Ajv / ajv-formats | 8.20.0 / 3.0.1 | JSON Schema 2020-12、格式校验、无类型强转、失败路径 |
| Vitest | 4.0.18 | 单元/合同/集成测试、空选择非零；集成并发上限见下 |
| esbuild | 0.28.2 | CLI/core/contracts ESM bundle、真实执行 |
| YAML | 2.9.1 | 解析与重复键错误 |
| ESLint / typescript-eslint | 9.39.2 / 8.70.0 | JavaScript/TypeScript 静态检查 |
| json-schema-to-typescript | 15.0.4 | 确定性生成与漂移检查 |

版本来自本机实际执行/已安装包，并与官方 npm 元数据或 [Node 发布目录](https://nodejs.org/download/release/v24.11.1/) 对照；完整来源 URL 逐项保存在 lock。依赖精确固定，pnpm-lock 保留 integrity。pnpm 11 的原生构建许可使用 `allowBuilds.esbuild: true`，没有全局放开安装脚本。

M0 阶段执行器运行 source、tasks、schemas、boundaries、build、typecheck、unit、lint、contract 九项真实命令，遇到非零立即保留失败命令并返回非零；不接受删除必检或未验证工具。最新阶段日志见 [PROGRESS](implementation/PROGRESS.md)。

M2 阶段在此基础上增加 integration 与 `m2-runner`/`m2-evidence`/`m2-gate` 三组实测注册检查，共 13 项，并固定 oasdiff 与 saxes 为必验工具。集成用例各自创建真实 Git 仓库、CLI 子进程与业务进程，并把证据 fsync 到同一卷；按默认 `cores-1` 并发时全部超时都表现为越过各自时限（同一用例单独 3.5 秒、并发下越过 15 秒时限），因此 `vitest.config.ts` 把 forks 并发上限固定为 2，属于测试调度设置：产品内配置的命令超时、必检集合与目标契约均未放宽。

## 未验证能力

- oasdiff **1.32.1** 状态为 `VERIFIED`，范围限于锁文件记录的实测能力：本机固定可执行文件身份与版本、真实 breaking JSON 输出解析、锁定支持子集与规则映射。未知规则、未知输出形态或不支持的 Schema 一律保守阻塞，不推断为支持。Playwright 仍为 `UNKNOWN`：未运行任何浏览器合同或端到端验证。docker-compose 仍为 `UNKNOWN`：只观测到版本输出，未启动服务、绑定身份或清理。依赖它们的能力不能据此通过。
- 进程执行来源认证目前只对 `win32-*` 平台成立（Windows Job Object、创建身份与 owner token）。Linux/WSL/macOS 的进程树、文件锁与取消语义未实现也未验证；Gate 在非 win32 平台不会把这些字段当作已验证事实。
- T01—T27 实际端到端验收、FastAPI/React 服务链路、Docker 生命周期、宿主加载、本地 tarball、发布和跨平台矩阵：`NOT_RUN`。现有静态三方夹具与 Gate 金样例不是这些流程的通过证据。
- 官方 OpenAPI 3.1 文档 meta-schema 已保留原始字节和摘要。Ajv 的[嵌套动态锚点限制](https://github.com/ajv-validator/ajv/issues/1745)使其不能直接正确解析该 meta-schema 的 `#meta`。夹具检查仅在内存副本中将这个已知锚点静态绑定到 `#/$defs/schema`；官方 meta-schema 的 authoring warnings 在该单独实例放宽，候选响应的校验器仍为严格模式且不强转。没有声明任意 `$dynamicRef` 支持；SG-019/022 必须按实测能力拒绝不支持的特性。

工具或版本变化须重新实测，不以已有版本日志推断新版本支持。完整发行认证和防漂移矩阵属于 SG-090。

## SG-011 本地存储补充

同一 Windows/Node 基线上，50 项存储测试通过：中文/空格与 CRLF 字节、目录 junction 边界、大小写歧义、严格 JSON、原子新建/按摘要替换、并发写和中途写入失败。未新增依赖。完整回归 253 项 Vitest + 24 项 Node 测试及 5 项工具合同测试通过，真实日志见 [SG-011 账本记录](implementation/tasks.json)。

这是单项开发验证，不是 M1 阶段认证。原始文件符号链接探测受 Windows 权限限制；Linux/WSL（包括反斜杠文件名及 `..` 链接目标）、网络文件系统、断电持久性未验证。同权限恶意目录竞争不属于这里的隔离保证。崩溃或清理失败可能留下锁/临时文件，必须确认归属后恢复。
