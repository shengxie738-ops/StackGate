# StackGate main 分支任务与代码审计报告

**审计基线：** `17ea7adf10bab9961b96cf3edca255b112bf146b`  
**仓库：** `shengxie738-ops/StackGate`，分支 `main`  
**提交时间：** 2026-09-21 15:30:15 UTC；合并 PR #1（V2）  
**报告日期：** 2026-09-21  
**范围：** M1 修复、M2 执行与证据链、M3 实际交付边界，以及下一阶段进入条件。  
**配套计划：** `StackGate_Next_Steps_M3_Completion_v0.3.md`

> **结论：当前 main 不能认定为 M1、M2、M3 均完成。**
> 它包含 M1 修复、M2 的实质实现，以及 M3 的第一项 SG-051。SG-052/054 是 READY，SG-053 和 SG-055—077 为 NOT_STARTED。下一步应补完 M3，而不是直接进入 M4 打包和宿主插件发布。
> 这一结论针对上述远程提交；不推断用户电脑、未推送提交或其他分支中是否还有实现。

## 1. 审计方法及证据边界

本次通过 GitHub 连接器读取固定提交的分支元数据、完整目标子树、任务账本片段、源代码和历史验证摘要。对执行器、计划、运行、门槛、存储和 Probe 的关键调用链逐层核对。不是只按 README 判断完成。

另外恢复了两份原始 JavaScript 文件，按 Git blob 算法核对其 SHA，再在临时 Git 仓库执行局部反例。恢复文件与远程 blob 字节一致，未修改产品逻辑。

### 1.1 本次真实执行与没有执行的内容

| 项目 | 本次状态 | 说明 |
|---|---|---|
| 固定 main 提交及检查树 | 已读取 | 所有源代码读取固定到本报告 SHA，不混用 main 浮动内容 |
| 原设计与原 100 任务计划 | 已核对来源 | 挂载的原计划 blob SHA 与远程根目录计划相同 |
| `record.mjs` 反例 | 已局部执行 | 同一目录修改 tracked 源码、新增 untracked 文件，身份字段仍相同 |
| `verify-stage.mjs --stage M3` | 已局部执行 | 返回 2，原文提示 `Unimplemented stage M3: NOT VERIFIED` |
| 当前提交完整 build/typecheck/test | 未执行 | 容器无法通过 Git 网络克隆；本机 Node 22.16.0，缺 pnpm，不符合仓库 Node 24.11.1 / pnpm 11.2.2 基线 |
| Windows Job Object 进程测试 | 未执行 | 本环境不是 Windows |
| Docker、真实 React 浏览器和全栈联调 | 未执行 | 当前远程 M3 实现尚不齐全，且本次不具备其测试环境 |
| Gate 中途修改输入反例 | 未执行 | 已发现静态时序风险，交给下一计划用确定性屏障复现 |

**不把历史日志当作本次测试，不把局部反例当成整库回归，不宣称发现了全部缺陷。**

### 1.2 证据分级

- `SOURCE_CONFIRMED`：由当前固定提交的代码、目录或账本直接支持。
- `LOCAL_REPRODUCED`：由本次运行的局部原始代码反例支持。
- `HISTORICAL_RECORDED`：仓库保留的作者执行记录；没有在本次独立重跑。
- `RISK_TO_REPRODUCE`：调用链提示的风险，必须先增加真实反例，不直接宣称漏洞已被利用。

## 2. 任务完成度核对

| 范围 | 当前 main 的证据 | 审计判断 |
|---|---|---|
| SG-001—028 / M0、M1 | 进度记录完成；对应核心与静态适配器存在 | 有实质基础，可复用；不要求推倒重写 |
| M1-R00—R07 | 进度记录 DONE；扫描已使用注册工具、统一选择策略、精确输入范围 | 旧问题已有针对性修改；本次不把旧四项重复列为未修复缺陷 |
| SG-029—050 / M2 | Runner、EvidenceStore、Plan/Run/Gate、报告、交接与异常测试存在 | M2 有实质实现，历史 Windows 阶段记录通过；当前提交需重新复验 |
| SG-051 / M3 | FastAPI 工厂、Pydantic 模型、候选导出、API 测试存在 | 已进入 M3，仅这一项账本为 DONE |
| SG-052、SG-054 | READY；actual_files 与 verification 为空 | 已解锁，不等于实现完成 |
| SG-053、SG-055—077 | NOT_STARTED；actual_files 与 verification 为空 | M3 主体尚未提交到当前 main |
| SG-078—095 / M4 | NOT_STARTED | 不宜现在直接做发行包和平台插件交付 |

来源：[S01]—[S05]。原路线中 M3 是“真实全栈闭环”，不是“M2 本地命令成功后再加一个 API 示例”。

### 2.1 三项相互独立的 M3 缺失证据

**目录证据。** `examples/` 完整递归树只包含 API 示例；没有 `apps/web`、测试 Compose 文件或浏览器用例。`packages/` 没有 `adapter-playwright`、`adapter-compose`。[S03][S04]

**命令证据。** `scripts/verify-stage.mjs` 仅接受 M0/M1/M2；`test:acceptance` 仍指向 `unimplemented.mjs ... SG-073`，基准和发布命令也仍为相应后续任务的未实现入口。[S05][S06]

**产品调用链证据。** Plan、Run、Gate 和 Probe 保留 M2 限制，不能仅增加一个浏览器 reporter 就得到全栈验收通过。[S07]—[S11]

## 3. 审计发现与处理优先级

优先级是开发顺序建议，不是安全漏洞评级。没有运行支持的结论均明确降级。

| ID | 类型 / 证据 | 发现 | 下一步 |
|---|---|---|---|
| A-01 | 阶段边界 / SOURCE_CONFIRMED + LOCAL_REPRODUCED | M3 只到 SG-051，阶段入口明确拒绝 M3 | AUD-000 后推进 SG-052—077 |
| A-02 | 验证可追溯性 / LOCAL_REPRODUCED | 开发记录的 worktree_digest 只哈希路径 | AUD-001 增加前后源码清单与内容摘要 |
| A-03 | 新鲜度时序 / RISK_TO_REPRODUCE | Gate 先观察当前输入，异步收集证据后仅复核 seal | AUD-002 先复现，再做返回前输入复核 |
| A-04 | 可扩展性边界 / SOURCE_CONFIRMED | M2 适配器白名单和环境判定分散在多层 | AUD-003 冻结统一注册与证据评估接口；SG-062 接入 |
| A-05 | 平台能力 / SOURCE_CONFIRMED | LocalRunner 只有 Windows Job Object 实现 | AUD-004 补 Linux 受控进程能力，再完成 SG-071 |
| A-06 | 开发文档 / SOURCE_CONFIRMED | 当前 architecture-map 仍称 M2+ 未实现 | AUD-000/AUD-003/SG-077 更新当前导航；历史日志不重写 |

### A-01：M3 完成声明与远程事实不一致

**涉及：** `docs/implementation/PROGRESS.md`、`docs/implementation/tasks.json`、`scripts/verify-stage.mjs`、`package.json`、`examples/`、`packages/`。

本次不是根据任务名称猜测缺失。已核对 SG-052、SG-054 的 READY，以及其后 M3 卡片的 NOT_STARTED；确认其实现/验证数组为空。SG-051 的下一步字段也明确指向 React 与 HTTP probe。

本地恢复原阶段脚本并直接调用 M3，得到：

```text
command: node scripts/verify-stage.mjs --stage M3
exit_code: 2
stderr: Unimplemented stage M3: NOT VERIFIED
```

该调用在读取阶段文件之前就拒绝了 M3，因此不依赖缺少 npm 依赖才失败。它证明入口未注册，不证明任何尚未编写的 M3 测试失败。

**处理：** 优先核对用户当前工作树是否存在未推送实现。如果存在，逐项比较并验证复用，不自动合并、不 reset、不覆盖。若与审计基线一致，就从 SG-052/054 开始。

### A-02：开发证据的 worktree_digest 不是源码指纹

**位置：** `scripts/record.mjs` 的 `repositoryIdentity()`。[S12]

原实现：

```js
worktree_digest: valid
  ? createHash('sha256')
      .update(top.stdout.trim().replaceAll('\\', '/'))
      .digest('hex')
  : null
```

它表示“仓库路径的标识”，不是被测代码的标识。本次临时仓库中，提交后运行一次 recorder，再修改 tracked 源码并新增 untracked 源文件，再运行一次；两次 `repository` 对象完全相同，但独立计算的源文件 SHA-256 不同。

**影响：** 当大量工作处于未提交状态时，历史记录不能仅靠 HEAD 与这个字段还原究竟验证了哪份源码。命令退出码仍可能完全真实，这不是造假证据。

**特别区分：** 这是**开发验证脚本**的追溯缺口，不是说产品 `InputManifest` 也只哈希路径。产品的输入捕获和证据认证是另一套实现，不能混为一谈。

**处理：** 增加 pre/post source manifest、tracked/index/untracked 状态、明确排除项与原始字节摘要。旧字段按兼容保留并标为位置身份；不补写旧日志为“当时已验证源码”。

### A-03：Gate 长时间认证期间输入变化的风险

**位置：** `packages/core/src/services/gate-service.ts` 的 `inspect()`。[S09]

当前主要时序：

```text
验证历史 seal 与 documents
→ PlanService.inspectStored 观察当前代码
→ TrustService.capture
→ 逐个读取并重新 collect 检查证据
→ 根据此前 current/capture 计算 freshness
→ 最后 verifyRun 复核历史 seal
→ 返回 evaluation
```

最后一次 `verifyRun` 检查的是**历史证据没有变化**，不是当前业务源码没有变化。存在在证据重收集期间源码发生变化、结果仍使用较早 FRESH 观察值的风险。

已查到的 `tests/integration/gate/current-state.test.ts` 覆盖“调用 Gate 前修改源码”；`run/finalization-race.test.ts` 覆盖双进程 finalize/seal。这两者不等价于“Gate 已开始认证、返回前输入改变”。[S13][S14]

**证据等级：RISK_TO_REPRODUCE。** 本次没有执行完整 Gate 并发反例，不宣称已证明其可错误 ALLOW。

**处理：** 在真实 sealed run 上，给真实 collector 加一个只用于测试的等待屏障，在屏障期间写入新源码，然后恢复 collector。若原实现返回 FRESH/ALLOW，修复为返回前再次观察输入/确认/授权；若原实现已通过其他路径拒绝，则保存反例结果、解释原因，不为迎合审计而做无效重构。

**边界：** 即使做尾部复核，本地目录仍不是原子快照或 OS 安全边界。报告应说明 FRESH 对应最近一次观察时点；严格 CI 依赖受控检出，不能宣传为阻止同权限恶意进程的证明。

### A-04：M3 必须同时升级六个连接点

| 现有位置 | 当前逻辑 | M3 的正确增量 |
|---|---|---|
| `plan-service.ts` | 环境必需时增加 M2 未支持 blocker；非 command/JUnit 增加 blocker | 从共同 capability registry 得到支持状态；只有真实实现与平台能力满足才消除 blocker |
| `run-service.ts` | 只实例化 CommandAdapter/JunitAdapter；origins 为空 | 调用环境适配器与真实 OpenAPI/Probe/Playwright；动态 origin 绑定经过授权 |
| `gate-service.ts` | 非 command/JUnit 的 PASS/FAIL 被拒；重收集也只处理这两类 | 使用与执行一致的 collector registry；逐个重验原始证据 |
| `run-evaluation.ts` | environment_satisfied 只允许无环境、无后端观察要求 | 接受核心认证的环境/链路事实，不能改成固定 true |
| `services/adapters/probe-adapter.ts` | 合法报告仍为 BLOCKED，执行计数为 0 | 有实际请求及独立匹配的访问观察后，核心重算允许的断言并计数 |
| `FileEvidenceStore` / RunManifest | `data_revision` 是不可变字段；M2 初始化为 local-input hash | 在 Run 创建前确定测试数据 revision；准备与清理环境用不同事实记录 |

这不是批评 M2 故意保守；保留这些限制是正确的。问题在于下一阶段不能仅删除限制、读 JSON 里的 `schema_valid:true` 或填充 `environment_satisfied:true`。

### A-05：Linux/WSL 运行能力尚未实现

**位置：** `packages/runner-local/src/local-runner.ts`。[S15]

`run()` 只有 `process.platform === 'win32'` 的 Job Object broker 路径。其他平台不能通过实际的进程所有权验证。

这意味着 Linux 上装好 Node、pnpm 或 oasdiff 并不足以运行完整产品；Windows 历史测试结果不能用作 WSL/Linux 通过证据。当前行为偏向安全拒绝，不属于已证实错误放行。

下一阶段需要独立实现 Linux 进程归属与有界清理能力。普通 process group 不自动等价于 Windows Job Object 对 detached 后代的约束；必须通过真实后代退出、无关进程存活与所有权校验测试，再填写平台能力表。没有所需能力时保持明确 BLOCKED。

### A-06：当前架构导航已经过时

`docs/implementation/architecture-map.md` 仍写 “M2+ explicitly unimplemented”，但 M2 源码已经存在。[S16]

这是一个具体的 Agent 续接风险：如果后续 Codex 只依赖这份地图，可能重建第二套执行器或者误判当前入口。应更新当前导航、实际命令入口 `apps/cli/src/commands/execution.ts`、证据与状态边界。

`M2-summary.md` 中“当时未合并 main”属于历史执行背景，不应直接抹掉。可以在当前 PROGRESS/审计状态中补充“已由 PR #1 合并”。

## 4. 值得保留的实现

### 4.1 M2 不是仅由测试数量堆出来的脚手架

检查到真实的 `LocalRunner`、`FileEvidenceStore`、`PlanService`、`RunService`、`GateService`。Gate 不是照搬保存的 PASS，而会校验计划绑定并调用 command/JUnit collector 重收集证据；存储拒绝封存后修改；运行结束后会重新捕获当前输入。[S07]—[S10][S17]

### 4.2 旧 M1 修复已有增量

ScanService 默认改用 `RegisteredOasdiffAdapter`；通过 `selectionPolicyFor()` 传递工作区回归配置，后者保留全部 workspace IDs；`executionInputScope()` 按命令、锁文件、显式 ignored input 和保护路径组成范围，不再直接把全部 workspace 当作 ignored 枚举入口。[S18]—[S20]

本次没有在每一个平台重新跑旧四项修复用例；JSON 统一输出的完成主要由 M2 历史记录支持，不能把这一行当作新的跨平台认证。

### 4.3 SG-051 的 API 应继续复用

`create_app()` 暴露真实 FastAPI 应用；业务响应由模型构造，候选导出调用同一应用 `app.openapi()`。`/health` 只表达 ready，不包含业务契约。导出要求当前 attempt 目录并使用排他写入，不搜索旧契约当作新结果。[S21][S22]

后续观察中间件、测试启动器与容器都应调用这个工厂，而不是另写一个“专用于演示的假后端”。

## 5. 测试记录如何解释

仓库 M2 摘要记录 Windows x64 的 13 个注册组退出 0，并声明 518 个 Vitest 单测、29 个 Node 反例、57 个合同测试、237 个集成测试，共 841 项；m2-* 定向组不再叠加到独立计数。[S23]

该数字是**历史记录中的统计**。本次未独立分析全部测试 title 的跨组去重，也没有重新运行它们。后续基线恢复任务应保留 group、file、test ID、结果、原始退出码和被测源码摘要，不仅保存一行“所有测试通过”。

## 6. 下一步执行顺序

```text
AUD-000：锁定实际代码和范围，复验已有基线
  ↓
AUD-001：开发证据绑定源码，而不只是目录
  ↓
AUD-002：Gate 中途变更反例与必要修复
AUD-003：M3 协议、共同适配器入口、文档地图
  ↓
SG-052—061：页面、Reporter、Probe、访问观察、环境与清理
  ↓
SG-062：全部进入同一个真实 Run/Gate
  ↓
SG-063—069：完整性、真实失败/修复、旧服务、隐私
  ↓
AUD-004 + SG-070/071：Windows 与 Linux/WSL 实际平台能力
  ↓
SG-072—077：安全、27项注册、故障库、基准、矩阵、M3出口
  ↓
M3 全栈出口成立后，才解锁原 SG-078—095 产品化路线
```

AUD-004 可在独立接口稳定后提前开发；Linux 开发环境在本地执行能力缺失时必须先解决它。无需让 Windows 的纯模块工作等待 Linux 环境就绪；但不能因此把缺失的平台认证记为完成。

## 7. 可复现附件

`stackgate_audit_17ea7ad/reproduce.py` 可在有 Python、Node、Git 的本地环境运行。它只在自己的临时仓库中执行恢复的脚本，不修改用户的 StackGate 仓库。

附件包含：

```text
recovered/scripts/record.mjs
recovered/scripts/verify-stage.mjs
reproduce.py
evidence/local-reproduction.json
```

Git blob 校验：

| 文件 | 当前仓库 blob SHA |
|---|---|
| record.mjs | `7052d30608a287140005bd6772bbf2ce38fc5b23` |
| verify-stage.mjs | `d18e0f41648c1cb8d46e08eac2d8acb369a76bd6` |
| 原 100 任务计划 | `94d07afbb597fa1bdb23b72dbf52f7aa092461f2` |

## 8. 固定提交来源索引

以下均为本次读取到的来源。源文件按关键调用链阅读，不声称对所有文件做了逐字审计。大型 ledger 读取了当前完成边界及下一阶段相关连续段；未读取全部历史日志正文。

**[S01] 当前进度**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/docs/implementation/PROGRESS.md`

**[S02] 100项任务账本；主要读取16800—17840行**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/docs/implementation/tasks.json`

**[S03] examples完整递归树**  
`https://api.github.com/repos/shengxie738-ops/StackGate/git/trees/b1a31074fe8d44a2077b10096a5ef7c3aa4e0cb7?recursive=1`

**[S04] packages完整一级树**  
`https://api.github.com/repos/shengxie738-ops/StackGate/git/trees/fb909bbb28612ca50d5c3f2c00833adaeb9e47d0`

**[S05] 当前命令与依赖**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/package.json`

**[S06] 阶段注册器**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/scripts/verify-stage.mjs`

**[S07] 计划与当前输入复核**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/services/plan-service.ts`

**[S08] 运行生命周期**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/services/run-service.ts`

**[S09] Gate认证与重收集**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/services/gate-service.ts`

**[S10] 环境满足条件**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/services/run-evaluation.ts`

**[S11] 仅收集的Probe实现**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/services/adapters/probe-adapter.ts`

**[S12] 开发命令记录器**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/scripts/record.mjs`

**[S13] Gate当前状态测试**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/tests/integration/gate/current-state.test.ts`

**[S14] 运行封存并发测试**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/tests/integration/run/finalization-race.test.ts`

**[S15] Windows进程运行器**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/runner-local/src/local-runner.ts`

**[S16] 当前架构地图**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/docs/implementation/architecture-map.md`

**[S17] 证据存储：读取1—90行**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/storage/file-evidence-store.ts`

**[S18] 扫描入口**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/services/scan-service.ts`

**[S19] 选择策略**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/services/selection-policy.ts`

**[S20] 执行输入范围**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/services/execution-input-scope.ts`

**[S21] 真实FastAPI应用**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/examples/contract-drift-demo/apps/api/app/main.py`

**[S22] 候选契约导出**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/examples/contract-drift-demo/apps/api/scripts/export_openapi.py`

**[S23] 历史M2验收摘要**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/docs/implementation/evidence/M2-summary.md`

**[S24] 现有EnvironmentPort**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/core/src/ports/environment.ts`

**[S25] 现有EnvironmentManifest**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/packages/contracts/src/generated/environment.ts`

**[S26] 原100任务计划**  
`https://github.com/shengxie738-ops/StackGate/blob/17ea7adf10bab9961b96cf3edca255b112bf146b/StackGate_Codex可执行开发任务规划_v0.1.md`

**审计结束。没有修改远程仓库、创建 PR、推送或发布产品。**
