# StackGate V2 分支：代码与任务审计报告 v0.4

**审计日期：** 2026-09-26  
**仓库：** `shengxie738-ops/StackGate`  
**唯一目标分支：** `V2`  
**固定提交：** `2791cf5f221d6f917101079332f4231c6a450fa7`  
**提交时间：** 2026-09-26T02:13:30Z  
**父提交：** `c31b4e0e2e4ca2943363855e6099d2f24920a4e8`  
**配套执行计划：** `StackGate_V2_Execution_Plan_v0.4.md`

> 这是对指定 V2 提交的审计，不是上次 main 审计的改名副本。下面分别注明源码事实、仓库历史记录、局部实测和未验证项。新计划不直接进入 M4：先恢复构建，修复新增模块的边界问题，再完成 M3 的真实产品执行链。

## 1. 结论

V2 已明显领先于此前审计的 main：新增 React 示例、受限 HTTP Probe、声明式断言重算、环境准备/收尾/清理/评估结构，以及 Playwright Reporter 初步实现。`PROGRESS.md` 记录 SG-001—052、SG-054 为 DONE，AUD-003 为 DONE。[S01]

但当前不能把它称为“整个 M3 已完成”：

- Playwright Reporter 导入了不存在的命名导出，独立 ESM 加载失败。
- 新环境评估和请求/断言模块存在本报告实测的错误接受情形，必须在接入 Gate 前修复。
- 默认适配器注册表仍只提供 command/JUnit；Plan/Run 的 M2 执行限制仍在，Probe 原 collector 仍不产生可信的成功执行结果。
- `adapter-playwright` 目前只有 inventory/reporter，没有完整的公开入口与 collector；未发现 `adapter-compose` 目录。
- `verify-stage.mjs` 只接受 M0/M1/M2；`test:acceptance` 仍指向 SG-073 的未实现入口。[S02—S06]

**建议顺序：V2-R00—R07 → SG-053 完成与 SG-055—061 → SG-062 集成 → SG-063—077 验收。** 已有 SG-052/054 和 AUD-001/002/003 的实现应复用，新增缺陷通过补充修复任务追踪，不抹掉历史记录，也不把历史 DONE 当成当前全量通过。

## 2. 方法、验证范围与证据等级

### 2.1 实際完成的审计工作

通过 GitHub 连接读取 V2 分支身份、提交差异、目录树、进度、实现文档、关键源码、Schema、测试和阶段入口，全部以同一个提交 SHA 固定。重点检查：新代码能否加载；权限约束是否对应真实请求；响应字段是否来自真实 JSON；环境事实是否足以支持结论；新增适配器是否贯通 Plan/Run/Gate。

从连接返回的源码恢复了六个原始文件，逐个计算 Git blob SHA-1，并与 GitHub 返回的 blob SHA 一致性比较。原始文件没有改写。随后只做 TypeScript 转译并执行局部函数与模块加载，另用原始 Python helper 对本机回环监听器执行真实请求。

共记录 **16 个模块/回调观察 + 3 个真实 HTTP 观察**。这不是仓库测试用例通过数量，而是对特定问题行为的独立复现数量。详见配套 `results/`、`tests/` 与 `source-manifest.json`。

### 2.2 没有完成、因此不作声明的事项

本次没有成功克隆完整仓库；容器的 Git 网络访问发生域名解析错误。没有执行完整 `pnpm build`、`pnpm typecheck`、M1/M2/M3 全套测试、真实 Playwright 浏览器、Docker Compose 或 Windows Job Object 流程。GitHub 连接读取不受这一容器网络限制影响。

本次局部环境为 Node 22.16.0、TypeScript 5.8.3、Python 3.13.5；仓库根工程锁定 Node 24.11.1、pnpm 11.2.2、TypeScript 5.9.3。局部结果不能替代目标版本与目标平台验证。缺失命名导出的源码事实不依赖这些小版本差异；具体执行行为仍要求 Codex 在锁定环境回归。

六个源码恢复文件：

| 恢复文件 | Git blob SHA-1 | 字节数 |
|---|---|---|
| `packages/core/src/services/environment-assessment.ts` | `00fdf8addfa90d4a5624c101a6bcdd80d02d4ea4` | 6899 |
| `packages/core/src/services/http-policy.ts` | `8f1c97785d080239610abd41b97585acee5134b6` | 4822 |
| `packages/core/src/services/probe-assertions.ts` | `2ae0ec5763ce770d46bd76b5bc69ef26c835b3b3` | 5422 |
| `packages/adapter-playwright/src/inventory.ts` | `85e327385e331abecf318d478c2f846a4730ccc8` | 3022 |
| `packages/adapter-playwright/src/reporter.ts` | `2bec83afeafce85bc2a81afeb331136a47056f46` | 8791 |
| `presets/fastapi-react/scripts/probe_helpers.py` | `ba64197f0b3bdfdb20199eec39e1bb1a78404636` | 8706 |

### 2.3 证据等级

| 标记 | 含义 | 可以支持的表述 |
|---|---|---|
| SOURCE | 固定提交中的源码/结构直接支持 | 存在某导入、条件、缺少某入口 |
| REPRO | 本次对字节匹配的源码实际运行 | 特定输入在局部测试产生某结果 |
| HISTORICAL | 仓库保存的历史命令与记录 | 开发者记录过某验证；不代表本次重跑 |
| PENDING | 调用链/风险分析，尚未动态证明 | 应加反例；不能直接称已利用漏洞 |

## 3. 与上次 main 审计的差异

| 范围 | V2 当前事实 | 本次处理 |
|---|---|---|
| 验证源码身份 | `record.mjs` 已写 source_before/source_after、verification_attributable，并标注旧路径摘要含义 | 保留；补本次基线，不重复实现 AUD-001 |
| Gate 认证中途变化 | Gate 已有首尾输入观察与 `INPUT_CHANGED_DURING_AUTHENTICATION` | 保留；本次未独立重跑其完整 Windows 反例 |
| M3 共享协议 | ADR-012、环境/观察 Schema、注册表已加入 | 审计具体实现，不把接口存在等同于流程已接通 |
| React 示例 | `apps/web/package.json` 已存在，并明确示例有意读取旧字段 | 不把演示故障本身当产品缺陷；复用修复补丁流程 |
| Probe | helper、declaration 与 HTTP 集成测试已加入 | 复用，补 slow-drip、代理、操作路径与 JSON 字段边界 |
| Playwright | 有 reporter/inventory 源码，尚有加载缺陷 | SG-053 按“部分实现待收口”继续 |
| Compose / Linux | 未发现 Compose 包；Windows Runner 没有在本次提交新增 Linux 实现 | 继续按原 AUD-004/SG-057+ 落地，不外推平台支持 |

来源：[S01—S10]。这里不声称所有此前修复都已由本次完整实测证明。

## 4. 问题总表

优先级为本项目推进顺序，不是 CVSS 评分；“P0”表示阻断当前工程继续构建，“P1”表示必须在接入真实验收前修复。

| ID | 优先级 | 问题 | 证据 | 修复任务 |
|---|---|---|---|---|
| V2-F01 | P0 | Reporter 导入不存在的 `assertNoCompletedReport` | SOURCE + REPRO R01 | V2-R01 |
| V2-F02 | P1 | 环境 BLOCKED/ERROR/UNKNOWN 仍 satisfied；来源等级/无环境分支判断不完整 | SOURCE + REPRO R02—R04 | V2-R05 |
| V2-F03 | P1 | request ID 混作 artifact ref；成功评估与引用认证自相矛盾 | SOURCE + REPRO R05 | V2-R06 |
| V2-F04 | P1 | HTTP 授权未绑定声明操作的实际路径；空声明和 fragment 可通过 | SOURCE + REPRO R06/R13 | V2-R02 |
| V2-F05 | P1 | Probe 总期限变成单次 socket 等待；默认环境代理改变实际访问路线 | SOURCE + REPRO R11/R12 | V2-R03 |
| V2-F06 | P1 | JSON Pointer 可读取继承属性；number 接受 Infinity | SOURCE + REPRO R07/R08 | V2-R04 |
| V2-F07 | P1 | Reporter retry 字段、Bearer 脱敏与既有报告覆盖不正确 | SOURCE + 回调体 REPRO R09/R10 | V2-R01、SG-053 |
| V2-F08 | 阶段缺口 | 新能力尚未完整注册和接入 Run/Gate；M3 stage 缺失 | SOURCE | SG-055—077 |

**范围警告：** F02—F06 多数还处于尚未接入完整产品路径的新模块。它们证明模块边界不安全或语义不一致，不能直接扩大为“当前 CLI 已能绕过完整 Gate”。

## 5. V2-F01：Reporter 不能通过命名导出解析

**位置：** `packages/adapter-playwright/src/reporter.ts:3`；`inventory.ts:1—80`；根 `tsconfig.json` 的 `include`。

Reporter 导入 `assertNoCompletedReport`，但 inventory 只提供 `completedReportExists`、`atomicWriteJson` 等导出，没有该函数。根类型检查范围包含 `packages/**/*.ts`。局部 ESM 转译后的导入实际抛出：

```text
SyntaxError: The requested module './inventory.js' does not provide an export named 'assertNoCompletedReport'
```

这是恢复后的原始源码加载反例，不是完整 `pnpm build` 运行记录。不能通过排除 `adapter-playwright`、改 tsconfig 范围、动态忽略错误或伪造空函数恢复“绿色”。应实现明确的 no-overwrite 检查并给出构建后 Reporter 加载测试。仅补空函数还不能修复 F07 的写入行为。[S11—S13]

## 6. V2-F02：环境 satisfied 缺少必要条件

**位置：** `packages/core/src/services/environment-assessment.ts` 的 `assessEnvironment` 与 `observedLevel`。

### 6.1 已复现

在 run/input/data revision/instance/ref 保持一致的直接函数输入中，仅将 prepare.status 改为 BLOCKED、ERROR 或 UNKNOWN，输出仍为 `satisfied:true`、无对应拒绝原因。

将 prepare.provenance=OBSERVED、finalization.provenance=CONTROLLED，结果同时为 `satisfied:true` 和 `provenance:DECLARED`。函数接口没有显式 `minimum_provenance`，无法完整实现 profile 的等级门槛。

`required_by_task:false` 且无环境文档的快捷分支会直接成功，即使 `requires_backend_observation:true`。不能依靠调用方“永远不会传这种组合”掩盖矛盾，核心应拒绝或归并需求。

### 6.2 源码可见、需进一步回归

cleanup 仅明确检查总体 FAILED/UNKNOWN、某些 PENDING/误删条件；未完整核对 prepare 创建资源与 cleanup 资源的集合、个人资源 FAILED/UNKNOWN、PARTIAL 含义、native ID 与 owner identity。现有环境协议允许这些状态，不能只看总体标签。

### 6.3 修复目标

从确认 profile、任务约束、prepare/finalization、独立资源检查与 cleanup 推导结果。READY、实例和 origin 连续性、数据版本、最低来源、证据引用、资源收尾必须全部满足。混合 OBSERVED/CONTROLLED 应取较弱但足够的 OBSERVED，而不是返回 DECLARED 又允许成功。CONTROLLED 还需可信执行上下文，不得由应用 JSON 自报升级。[S14—S17]

## 7. V2-F03：证据引用与请求身份混淆

**位置：** `environment-assessment.ts` 的 `observeRequests`：`refs.add(observation.request_id)`。

真实 EvidenceStore 的 artifact ID 和 HTTP request ID 是不同身份。给函数提供经过认证的 artifact IDs 和 request→body digest，assessment 可以成功，却把 request_id 写入 observation_refs，随后 `assessmentReferencesAuthentic` 返回 false。

现有 `m3-runtime-contracts.test.ts` 的 baseInput 把 `observation.request_id` 填到 authenticated_refs，导致测试人工制造了“两个 ID 相同”的条件，未检验真实存储联通。[S18]

修复需从 EvidenceStore 读取实际 artifact，把 request_id 与 observation_artifact_id、response_artifact_id、run/check/attempt/instance/operation/status/media/time/digest 分开绑定；所有引用都必须解析到本 run 的正确类型和完整字节。声明哈希相同不等于具备独立环境来源。一个贯通的正例应同时满足 assessment.satisfied 与引用校验；缺任一证据必须拒绝。

## 8. V2-F04：请求授权没有核对实际操作路径

**位置：** `packages/core/src/services/http-policy.ts:authorizeRequest`。

函数检查 method 与声明的 method 前缀，但没有对比实际 path 与声明 operation 的 path。本次直接调用得到：

| 声明操作 | 实际请求 path | 当前结果 |
|---|---|---|
| `api:GET /api/performance` | `/different-operation` | allowed=true |
| null | `/api/performance` | allowed=true |
| `api:GET /api/performance` | `/api/performance#ignored` | allowed=true |

Python 原始 helper 的真实请求也证明 fragment 不会发送上网：声明 `/api/performance#changed`，服务器实际看到 `/api/performance`。这破坏“已确认操作就是实际操作”的前提。

修复时由已确认 declaration 生成唯一 method/path/origin，不让调用端同时提供不一致的两份对象；仍兼容现有 API 时严格比较。查询、fragment、路径规范化歧义和不支持的模板必须明确拒绝，不应静默变换到不同端点。额外检查 deadline/bytes 必须是有限安全整数。静态能力不允许的情况应在请求发出前零访问拒绝。[S19]

## 9. V2-F05：HTTP 的绝对期限和代理边界

### 9.1 总 deadline 未生效

helper 把 `deadline_ms` 换成 `opener.open(...timeout=...)` 的一次等待值，但 `_read_bounded` 不检查整个请求已经经过多久。测试监听器每 20ms 返回一点响应，在 100ms 期限下仍约 **614ms** 后成功返回 200，完整读取 31 bytes。具体浮点耗时见证据 JSON，不当作性能基准。

现有测试只让监听器完全不响应，能测出空闲超时，不能证明不断有数据到来时的总 deadline。[S20]

### 9.2 默认环境代理改变路线

`build_opener(_RejectRedirects())` 会引入默认代理处理。设置仅用于测试的 `http_proxy` 和合成凭证后，本次目标监听器访问数=0，未列入目标 allowlist 的本地代理访问数=1，并出现合成 Proxy-Authorization。

这不意味着访问了公网或泄露了用户凭证：测试只用了本机回环服务器与虚构账户。它证明 helper 的“不会读取环境凭证”说明与默认网络行为不一致。

Python 官方文档说明 timeout 约束阻塞操作，ProxyHandler 默认发现环境/系统代理；传入空代理字典才禁用自动代理。修复必须同时关闭环境与系统自动代理，不能只在测试里删 `http_proxy`。[W02]

### 9.3 修复要求

以单调时钟计算硬截止时间，覆盖连接、响应头、响应体及拒绝路径。慢速 header/body、不断到达的小包、HTTP 错误响应和 DNS 等不可中断阶段均需有明确的可取消/有界策略。只在 read 返回后检查时间仍不能限制阻塞读取；采用一个可硬取消的私有工作进程或等价可证实边界，外层 Runner timeout 另作最后保护。默认不采用隐式代理，不继承凭证。保留当前 API 所需的真实错误分类。

## 10. V2-F06：断言把原型属性当作响应字段

`probe-assertions.ts` 的对象查找使用 `token in current`。对 `JSON.parse('{}')`，路径 `/constructor`、`/__proto__`、`/toString` 的 exists 均返回 true；Python 字典没有同样行为。这不是原型污染写入测试，而是继承属性误判。

`type:number` 分支又显式接受 Infinity/-Infinity。JavaScript 解析 `{"value":1e400}` 后会得到非有限值，本次 type 断言通过。后续 schema 校验可能再次拒绝，但不能依赖未接通的其他层补救本层错误。

修复采用 Object.hasOwn、有限 JSON 数字、明确 Pointer 语法和跨语言共同夹具。RFC6901 的空键、转义 `~0/~1`、数组下标等应按声明的支持范围处理；不支持时返回显式错误，不以非标准语义继续执行。不得简单禁用名为 `constructor` 的真实 JSON 自有字段。[S21][W03]

## 11. V2-F07：Reporter 的重试、脱敏、覆盖和收集边界

### 11.1 已复现的回调体问题

由于 F01 导致 ESM 无法加载，为检查其余代码，本次对**未修改源码**额外做 CommonJS 转译。CJS 将缺失导出解析为 undefined，构造器会捕获相关异常；这只用于执行原始回调体，并非一个正常的 Playwright ESM 加载。

- 向 `onTestEnd` 传入官方字段 `retry:1`，记录仍是 retry=0。源码使用的是 `result.retries`；官方接口是 `TestResult.retry`。[W01]
- 错误消息 `Authorization: Bearer audit_canary_123` 经过正则脱敏后仍保留 canary token。测试只使用合成标识。
- 即使目标 `playwright.json` 已有 completed=true 的记录，`onEnd` 的 rename 仍将它覆盖。仅在构造器记录错误不足以保护旧字节。

第一次回调测试的工具脚本未开启 esModuleInterop，产生了测试环境 path 导入错误；已修正**测试转译选项**后复跑，源文件未改。初始错误日志保留，不算产品缺陷。

### 11.2 需补的真实框架验收

源码还显示附件路径直接来自框架回调、body 附件未实际落盘、requests 使用未限额同步读取、trace ZIP 可能被归为 regular、console 集合缺少真实采集入口等问题。它们需要真实 Playwright 合同测试，不能仅构造回调参数宣称完成。

修复用已锁定 Playwright 官方类型；保存稳定 test ID + repeat/project/attempt/retry；总是保留先失败后成功；报告完成与所有必检完成分开；附件只读当前输出/框架授权目录且检查大小/链接/摘要；截图、trace、video 默认 restricted；常规文本统一使用现有脱敏组件；写入拒绝覆盖并测试并发。

## 12. V2-F08：M3 的主要任务是接通，不是再创建目录

### 12.1 已可复用

RunnerPort、EvidenceStore、schema 生成、Task/Trust、Git 输入身份、M2 的命令/JUnit、实际 Run 与 Gate 重认证、前后输入记录、React/API 示例和失败合同均已有基础。保留它们，不能另造 `M3RunnerV2` 或浏览器演示专用 PASS 通道。

### 12.2 尚需贯通

`RuntimeAdapterRegistry` 的工厂存在并不代表浏览器已经安装。需要分清：工厂安装、配置支持、工具可用、环境已准备、当前运行已验证。注册表要同时提供执行与重收集入口。

真实链路应是：

```text
固定 task/plan/inputs/tool identity
  → 环境 prepare/readiness（当时可运行，不是最后整体通过）
  → candidate export / compatibility / implementation alignment
  → probe + browser + independent backend observation
  → 环境 finalization
  → cleanup
  → 核心重算 environment assessment
  → 封存 evidence
  → Gate 重新收集所有 required checks 与环境事实
```

不能让“准备环境”步骤等待只有测试完成后才产生的最终 assessment，否则 DAG 循环。也不能在创建 Run 后修改不可变 data_revision，或把清理后的 CLEANED 覆盖准备时的 READY。保持 ADR-012 的多个不覆盖文档设计。

### 12.3 阶段出口

现有 stage 明确不接受 M3，这是正确的未实现表现。完成 SG-062 还不等于 SG-077。必须经过真实负例→合法修复→新 run、未验证项拒绝、平台证据、T01—T27 覆盖与基准记录后，才注册真实的 M3 出口。[S06]

## 13. 本次局部复现清单

| 观察 ID | 实测行为 |
|---|---|
| `R01-reporter-esm-import` | ESM 缺失命名导出错误 |
| `R02-environment-BLOCKED` | satisfied=true；provenance=OBSERVED |
| `R02-environment-ERROR` | satisfied=true；provenance=OBSERVED |
| `R02-environment-UNKNOWN` | satisfied=true；provenance=OBSERVED |
| `R03-mixed-provenance` | satisfied=true；provenance=DECLARED |
| `R04-no-env-backend-required` | satisfied=true；provenance=DECLARED |
| `R05-request-id-is-not-artifact-id` | satisfied=true，但 references_authentic=false |
| `R06-path-mismatch` | allowed=true |
| `R06-no-declaration` | allowed=true |
| `R06-fragment` | allowed=true |
| `R07-inherited-/constructor` | passed=true |
| `R07-inherited-/__proto__` | passed=true |
| `R07-inherited-/toString` | passed=true |
| `R08-nonfinite-number` | passed=true |
| `R09-reporter-callbacks` | retry=0；Bearer canary 未清除（CJS 回调体） |
| `R10-reporter-overwrite` | 已完成报告被覆盖（CJS 回调体） |
| `R11-total-deadline` | 100ms deadline，613.99ms 后成功返回 |
| `R12-inherited-proxy` | proxy hits=1，target hits=0，合成代理凭证被使用 |
| `R13-fragment-wire-mismatch` | 声明路径 fragment 与实际 wire path 不一致 |

“复现脚本退出 0”表示它成功观察到报告中描述的问题，不表示待审产品已通过测试。修复后应将对应案例改为“拒绝错误输入/保持旧证据”的正向产品断言，不能把本证据脚本直接当作长期绿色测试。

## 14. 交付后执行建议

本次不提交或推送任何仓库变更。将配套执行计划加入 V2 的 `docs/plans/` 后，Codex 先核对 SHA 与本地未提交变更，实际跑根 typecheck/build。先修 F01，再对新增安全模块跑对照反例，之后收口真实 Reporter 和环境适配。

本报告的源码 SHA 和测试结果只代表固定提交。V2 后续更新时先比较相关路径，已修复项直接回归关闭，不为符合本报告而回滚新代码。

## 15. 源码与外部依据索引

源码链接固定在审计提交。来源只支持对应代码或文档内容，不代表已在本次环境执行全部命令。

- **S01**：`docs/implementation/PROGRESS.md`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/docs/implementation/PROGRESS.md
- **S02**：`packages/core/src/services/adapter-registry.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/core/src/services/adapter-registry.ts
- **S03**：`packages/core/src/services/plan-service.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/core/src/services/plan-service.ts
- **S04**：`packages/core/src/services/run-service.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/core/src/services/run-service.ts
- **S05**：`packages/core/src/services/adapters/probe-adapter.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/core/src/services/adapters/probe-adapter.ts
- **S06**：`scripts/verify-stage.mjs`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/scripts/verify-stage.mjs
- **S07**：`scripts/record.mjs`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/scripts/record.mjs
- **S08**：`packages/core/src/services/gate-service.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/core/src/services/gate-service.ts
- **S09**：`docs/adr/ADR-012-m3-evidence-runtime.md`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/docs/adr/ADR-012-m3-evidence-runtime.md
- **S10**：`examples/contract-drift-demo/apps/web/package.json`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/examples/contract-drift-demo/apps/web/package.json
- **S11**：`packages/adapter-playwright/src/reporter.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/adapter-playwright/src/reporter.ts
- **S12**：`packages/adapter-playwright/src/inventory.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/adapter-playwright/src/inventory.ts
- **S13**：`tsconfig.json`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/tsconfig.json
- **S14**：`packages/core/src/services/environment-assessment.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/core/src/services/environment-assessment.ts
- **S15**：`schemas/0.1/environment-finalization.schema.json`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/schemas/0.1/environment-finalization.schema.json
- **S16**：`schemas/0.1/environment-cleanup.schema.json`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/schemas/0.1/environment-cleanup.schema.json
- **S17**：`schemas/0.1/backend-observation.schema.json`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/schemas/0.1/backend-observation.schema.json
- **S18**：`tests/contract/m3-runtime-contracts.test.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/tests/contract/m3-runtime-contracts.test.ts
- **S19**：`packages/core/src/services/http-policy.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/core/src/services/http-policy.ts
- **S20**：`tests/integration/probe/http.test.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/tests/integration/probe/http.test.ts
- **S21**：`packages/core/src/services/probe-assertions.ts`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/packages/core/src/services/probe-assertions.ts
- **S22**：`presets/fastapi-react/scripts/probe_helpers.py`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/presets/fastapi-react/scripts/probe_helpers.py
- **S23**：`presets/fastapi-react/scripts/stackgate_observation.py`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/presets/fastapi-react/scripts/stackgate_observation.py
- **S24**：`package.json`  
  https://github.com/shengxie738-ops/StackGate/blob/2791cf5f221d6f917101079332f4231c6a450fa7/package.json

### 外部技术核对（非 StackGate 自身实现证明）

- W01：Playwright TestResult（retry、attachments、status）及 Reporter API：`https://playwright.dev/docs/api/class-testresult`；`https://playwright.dev/docs/api/class-reporter`。
- W02：Python 3.13 urllib.request：`https://docs.python.org/3.13/library/urllib.request.html`。用于阻塞超时、默认 ProxyHandler 与显式禁用代理的语义。
- W03：RFC 6901：`https://www.rfc-editor.org/info/rfc6901/`。用于 JSON Pointer 语法和求值语义。

**报告结束。该交付不包含已完成的产品修复。**
