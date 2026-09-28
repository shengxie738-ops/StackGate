# StackGate V2 审计修复与 M3 收口：Codex 可执行任务规划 v0.4

> **给执行 Agent：** 使用本地已有的执行计划工作流逐项实现；安装了 `superpowers:executing-plans` 时按其机制执行，未安装不作为阻塞。本文是实施决定与验收要求，不代表这些功能已完成，也不允许把示例输出当成真实运行证据。

**Goal：** 在 V2 的现有 M1/M2、React、Probe、环境协议基础上，先消除构建和认证缺陷，再完成可由公开 CLI 执行、由 Gate 独立重收集的真实全栈验收闭环。  
**Architecture：** 继续使用模块化单体、现有 RunnerPort/EvidenceStore/EnvironmentPort；同一运行适配器注册表服务 Plan、Run、Gate；检查器提供事实，核心认证并决定门槛，Reporter 只提供事实/展示。  
**Tech Stack：** 根工程保留 Node 24.11.1、pnpm 11.2.2、TypeScript 5.9.3、Vitest 4.0.18 与现有 lock；示例 web 当前使用自己的 React/Vite/Vitest 版本，不强行合并成根版本。Python、Playwright、Compose 用实际锁定和验证的版本，不写 latest。  
**Spec：** `docs/specs/stackgate-v0.1.md`；`docs/plans/2026-09-18-stackgate-v0.1-execution.md`；仓库已有 `docs/plans/StackGate_Next_Steps_M3_Completion_v0.3.md`；ADR-012。  
**唯一目标分支：** `V2`  
**本次审计基线：** `2791cf5f221d6f917101079332f4231c6a450fa7`（2026-09-26T02:13:30Z）  
**配套报告：** `StackGate_V2_Audit_2791cf5.md`  
**建议保存位置：** `docs/plans/StackGate_V2_Execution_Plan_v0.4.md`

## 阅读导航

[起点与边界](#baseline) · [共同实施决定](#decisions) · [任务索引](#task-index) · [验收矩阵](#acceptance-matrix) · [阶段出口](#stage-exit) · [Codex 启动提示词](#codex-start) · [证据和参考](#references)

<a id="baseline"></a>
## 1. 起点：V2 有新增代码，但尚未完成 M3

本次 V2 的 `PROGRESS.md` 记录 SG-001—052 与 SG-054 完成，AUD-003 完成。Reporter 源文件已出现但命名导出错误阻断加载；环境评估和 HTTP/断言模块已有本次局部反例；Plan/Run 仍保留 M2 的 command/JUnit 限制，Compose 和完整 M3 stage 不具备。

先读取实际代码。SG-052/054 已有实现，不重写成另一套；SG-053 按部分实现继续。此前 AUD-001 的源码指纹、AUD-002 的 Gate 首尾观察、AUD-003 的四类环境证据设计应保留。原 AUD-004 的 Linux 受控执行仍作为待验证的平台前提。

这不是 M4 发行任务。只有本计划最后的 M3 出口成立，才进入原 SG-078—095。本文不会执行远程 push、PR、公开发布、生产部署或付费模型调用。

### 1.1 先验证当前工作区，而不是把用户描述或旧记录当作结果

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git cat-file -e "2791cf5f221d6f917101079332f4231c6a450fa7^{commit}"
git diff --name-status 2791cf5f221d6f917101079332f4231c6a450fa7 -- packages apps scripts schemas tests examples presets docs/implementation
node --version
pnpm --version
```

本地没有该对象时记录 `AUDIT_BASE_UNAVAILABLE`，仍可检查已存在代码。不得 reset/clean 覆盖用户改动，也不得自动将 main 内容搬到 V2。若 HEAD 有更新，逐条复现本报告的问题；已经解决的项执行回归后关闭，不强行重做。

必读：`AGENTS.md`、`docs/implementation/PROGRESS.md`、`tasks.json`（位于 docs/implementation 内）、`audit-m3-fixes.json`、`BLOCKERS.md`、当前任务相关文件。本计划不要求每轮重新全文读取所有历史日志。

### 1.2 Global Constraints

- 原始规格与原 100 项任务保留字节和身份；不把测试放宽写回原稿。
- 新补充任务使用 `V2-R00—V2-R07`；原 AUD-004、SG-053、SG-055—077 仍使用原 ID。新增依赖在补充台账中记录，原任务身份不重编号。
- 新增代码以 JSON Schema → 生成类型 → validator/fixtures → 消费者的顺序更新。禁止手改 generated 类型。
- 保留退出码：0 范围内 ALLOW；1 必检失败/确定性拒绝；2 不完整/取消；3 工具或证据错误；4 已失效；64 参数/配置错误。report/handoff 的操作退出码不等于验收。
- 未运行、不支持、缺少证据、零测试、跳过必检、来源不明均不能被解释为通过；不得使用 `--passWithNoTests` 或删测试制造绿灯。
- 不采用模型判断计算 Gate；不从日志/响应/任务自然语言拼接 shell；本地授权和类型品牌不是恶意代码沙箱。
- 本地业务执行只面向明确的测试输入与自有资源；禁止连接真实生产账户或按名称批量杀进程、Docker prune。
- 已封存 Run 不覆盖；新评估写 evaluations，新交接写 exports；任务/目标变更必须使用新 revision。
- 测试时间预算只可因测量过的 harness 工作量调整；不可掩盖死锁、解除产品 deadline、删断言或降低执行范围。
- 本次新增协议字段是实施建议；实际变更写 ADR-013，并说明对旧 0.1 证据读取的兼容行为。旧未知字段不能被静默赋予新的可信含义。

### 1.3 Review Focus

| 必须钉住的失败类型 | 正确结果 | 负责任务 |
|---|---|---|
| 模块导出不存在、真实框架回调字段变化 | 构建/加载明确失败；修复后真实 Reporter 可加载 | V2-R01、SG-053 |
| HTTP 操作不一致、隐式代理、慢速响应 | 未授权零访问；绝对期限终止；不继承代理凭证 | V2-R02/03 |
| JSON 继承属性、Infinity、两语言 Pointer 不一致 | 只读自有 JSON 字段；有限数字；一致拒绝语义 | V2-R04 |
| 环境 BLOCKED、来源不足、request/artifact ID 混淆 | 不满足环境；所有证据可从本 Run 索引重取 | V2-R05/06 |
| 取消、旧服务、附件泄密、删用例、清理未知 | 保留证据和未验证事实；只清理自有资源；不 ALLOW | SG-055—077 |

<a id="decisions"></a>
## 2. 共同实施决定：先固定接口与行为，再写适配器

### 2.1 复用真实文件，不另起平行系统

| 模块 | 当前入口 | 本轮做法 |
|---|---|---|
| CLI | `apps/cli/src/commands/execution.ts` | 保留已实现的命令函数和 JSON envelope，只增量接线 |
| Plan | `packages/core/src/services/plan-service.ts` | 保留固定任务、输入、工具、策略与 DAG；以实际能力替代 M2 常量限制 |
| Run | `packages/core/src/services/run-service.ts` | 实际执行、资源台账、事件、证据都走同一路径 |
| Gate | `packages/core/src/services/gate-service.ts` | 保留首尾输入观察；新增适配器与环境均有独立重收集 |
| Evidence | `FileEvidenceStore` / `EvidenceStore` | 使用已有 scope、预算、摘要、no-overwrite、seal |
| Runner | `RunnerPort.run(...): Promise<RunnerResult>` | 不改成另一套 EventStream runner；字节回调与 owned cleanup 保留 |
| Environment | `EnvironmentPort.prepare(request, context)`、`observe`、`cleanup` | 以实际类型为准，不照抄旧概念签名 |
| 注册表 | `createRuntimeAdapterRegistry` / `defaultRuntimeAdapterRegistry` | 能构造工厂 ≠ 工具可用；增加能力检测而非返回假对象 |
| Probe | `collectProbe`、`evaluateDeclaration`、`perform_request` | 复用，删除固定 BLOCKED 的前提是具备真实认证链 |
| Reporter | `reporter.ts`、`inventory.ts` | 修复现有文件，增加 index/collector/adapter 和真实测试 |

### 2.2 新增和补全文件布局

以下未存在的文件才创建；同责任已有等价实现时复用并在台账记录映射。

```text
docs/implementation/audit-v2-fixes.json
docs/implementation/V2-audit-baseline.md
docs/adr/ADR-013-v2-authentication-contracts.md
scripts/verify-v2-audit.mjs
packages/core/src/services/operation-authorization.ts
packages/core/src/services/authenticate-environment-evidence.ts
packages/core/src/services/environment-assessment.ts           # 修改
packages/core/src/services/adapter-registry.ts                 # 修改
packages/adapter-playwright/src/{index,collector,adapter,artifacts,completeness}.ts
packages/adapter-compose/src/attach/{adapter,provenance}.ts
packages/adapter-compose/src/{preflight,compose-adapter,readiness,cleanup}.ts
packages/core/src/services/adapters/{openapi-runtime-adapter,probe-runtime-adapter,environment-runtime-adapter}.ts
presets/fastapi-react/scripts/{probe_helpers,stackgate_observation}.py # 修改
presets/fastapi-react/playwright/stackgate.fixture.ts
tests/fixtures/v2-regressions/
tests/unit/v2/
tests/integration/fullstack/
```

### 2.3 HTTP 允许集合与绝对期限

默认值继承 ADR-012：请求总 deadline=5000ms，最大响应=1MiB，GET 已确认操作，拒绝重定向；readiness 总=60000ms、单次=2000ms、轮询间隔≤500ms。所有可配置变化进入 policy hash；deadline/bytes 为正安全整数，不接受 NaN/Infinity/小数。

授权对象必须来自已确认 declaration，绑定 service→origin、method、path。保持当前 `authorizeRequest(input): RequestDecision` 的返回形式，但不再允许 null 声明执行业务探针，不再只匹配 method；health check 使用单独已登记的健康操作，不借 null 绕过。

第一版只执行精确字面量 path。query、fragment、反斜杠、重复分隔、dot segments、未绑定模板和无法证明 wire 一致的编码形式返回显式不支持。对既有支持范围做保守限制，不声称这些形式在 HTTP 标准中一律非法。标准化后的 origin 与已确认 origin 比较，实际发出的 URL 必须等于该值。

Python helper 默认 `ProxyHandler({})` 禁用自动环境和系统代理；测试不依赖修改用户全局代理。确需代理将来另作显式授权能力，本轮不实现隐式例外。认证、Cookie 和代理凭证不从环境自动加载。

绝对 deadline 采用单调时钟。采用受控的单次请求工作进程边界：父进程通过有长度上限的字节帧得到结果，截止时终止并等待自己创建的工作进程；不能只用 Future.timeout 留下后台线程继续读网络。保持 helper 的现有公共调用可用；内部 worker 不访问用户认证。平台无法证实回收时返回工具/资源错误，外层 Runner timeout 作为第二道限制而不是替代请求 deadline。

### 2.4 环境认证输入要分清“要求”“证据”“结论”

`assessEnvironment` 仍为纯计算，但输入不再接受松散字符串凑成的引用集合。建议增加以下明确类型（在 V2-R05/06 中落地，名称固定）：

```ts
// packages/core/src/services/environment-assessment.ts
export interface ConfirmedEnvironmentRequirements {
  required_by_profile: boolean;
  required_by_task: boolean;
  requires_backend_observation: boolean;
  minimum_provenance: 'DECLARED' | 'OBSERVED' | 'CONTROLLED';
  expected_data_revision: string | null;
  expected_origins: { frontend: string | null; backend: string | null };
  required_operations: readonly string[];
}

// packages/core/src/services/authenticate-environment-evidence.ts
export interface EvidenceDocumentRef {
  artifact_id: string;
  relative_path: string;
  digest: string;
}
export interface ExpectedRequest {
  run_id: string; check_id: string; attempt_id: string; request_id: string;
  operation_key: string; instance_id: string;
  status_code: number; media_type: string;
  response_ref: EvidenceDocumentRef;
  observation_ref: EvidenceDocumentRef;
}
```

`authenticateEnvironmentEvidence({run_id, input_hash, requirements, prepare_ref, finalization_ref, cleanup_ref, requests, reader, artifact_index})` 返回判别联合：`{ok:true, facts:AuthenticatedEnvironmentFacts}` 或 `{ok:false, diagnostics:Diagnostic[]}`。`AuthenticatedEnvironmentFacts` 在该模块定义，包含通过 schema/scope/digest/时间检查的四类文档、期望要求、按请求连接的 observation/body 和**实际 artifact refs**；只由此工厂构造。类型品牌只防开发误用，不等于安全认证。

函数必须使用 `EvidenceReader.read` 按索引读取；依次验证 run/check/attempt、文档种类、相对路径、size/digest、完整性、request/instance/operation/status/media 和原始 body 摘要，再返回 facts。读取成功只证明内容和索引一致；环境来源还必须依赖 SG-056/058/060 的独立启动与观察来源，不能靠三份同源 JSON 互相背书。

纯 `assessEnvironment(facts)` 输出继续使用版本化 EnvironmentAssessment（适配签名变更的所有调用）。真正无环境的 M2 local profile 在核心单独判断“不需要环境”，不伪造 missing/none 的 artifact 来满足引用结构。存在后端观察要求时绝不能走这一分支。M3 assessment 只包含实际 refs。

等级为 DECLARED < OBSERVED < CONTROLLED；组合取最弱等级，再与已确认最低等级比较。没有可信执行来源时，应用自报 CONTROLLED 只能作为声明，不直接认证。prepare 必须 READY；finalization 的实例/origin/input/data revision 必须匹配；完整资源集合与 cleanup 逐项核对。CLEANED 不覆盖历史 READY。

### 2.5 原始响应、断言与哈希约定

新联通层使用现有 `common.schema.json` 的裸 64 位小写 Sha256。Python probe-raw 的历史 `sha256:` 前缀如果继续读取，在边界严格识别并转为裸摘要；不要在每层使用不同含义的字符串，也不要把前缀问题误报成所有现有 artifact 不合法。

摘要基于约定的未压缩 UTF-8 body bytes，不重新 JSON.stringify 后比较。模板显式禁压缩；不支持的 Content-Encoding 拒绝。完整响应、HTTP 元数据和请求 identity 一起构成检查事实。一个哈希不能替代 request/instance/status 等字段。

Pointer 遍历只允许 JSON 自有属性；支持并测试 RFC6901 的 `~0/~1` 和空键路径，数组仅规范十进制下标，不接受 01/-；非法转义拒绝。真实的自有 `constructor` 字段可以存在，不做粗暴关键词黑名单。任何解析得到的非有限 number 都拒绝。Python 与 TypeScript 同一 fixture 集应输出等价结果。

### 2.6 环境生命周期不能制造 DAG 循环

- Plan 只固定环境需求，不声称环境已经 READY。
- Run 创建前固定 data_revision 与工具/声明输入，不能运行后改不可变字段。
- 环境 step 完成时只认证 prepare/readiness，允许后续业务步骤开始；最终 assessment 要等后续验证和 cleanup，不能反过来成为这些步骤的前置。
- 保存 `environment`、`environment-finalization`、`environment-cleanup`、`environment-assessment` 独立文档；多次观察保存独立 artifacts。
- failed/canceled 仍在 finally 做有界收尾，保存已形成的事实。无法证明自有资源已清理时拒绝完整通过。
- Gate 对历史 Run 只读取已封存期间的来源证据，不为重新检查而重启旧环境；同时重查当前输入是否已改变。

### 2.7 Recorder、任务账本与支持声明

V2-R 任务进入新 `audit-v2-fixes.json`，使用现有状态集合。`record.mjs` 必须只允许台账中已登记的具体 ID，不放开任意字符串。历史 SG/AUD ID 保留，ledger validator 不许用一个空 `verification:[]` 声称 DONE。

每份新验证记录至少保留 actual command/argv、起止、退出码、日志摘要、工具版本、前后源码清单、是否运行中漂移。`result:PASSED` 但 `verification_attributable:false` 不能关闭依赖该源码状态的任务。根 build/types、子项目测试、浏览器测试和平台测试分开统计，定向重复运行不累加成独立覆盖数。

<a id="task-index"></a>
## 3. 任务索引与执行批次

| 批次/任务 | 功能目标 | 本计划前置 |
|---|---|---|
| [V2-R00](#v2-r00) 锁定 V2、恢复基线和补充任务台账 | 得到可追溯的真实起点，记录当前构建失败而不是沿用旧 M2 成功记录。 | 当前V2工作区 |
| [V2-R01](#v2-r01) 恢复 Reporter 导出、加载和不可覆盖写入基础 | 解决 V2-F01，建立后续真实 Reporter 验收的可加载入口，同时防止同一 attempt 覆盖报告。 | V2-R00 |
| [V2-R02](#v2-r02) 绑定声明操作与实际 HTTP 请求 | 修复 V2-F04；错误 method/path/service/origin 在产生任何网络流量之前被拒绝。 | V2-R00 |
| [V2-R03](#v2-r03) 实施绝对请求期限、禁代理和有界响应写入 | 修复 V2-F05，慢速数据不能无限延长期限，外部环境不能隐式更改代理和凭证。 | V2-R02 |
| [V2-R04](#v2-r04) 统一 JSON Pointer、自有字段与有限数字语义 | 修复 V2-F06，不让空JSON中的继承属性或非有限值满足真实数据断言。 | V2-R00 |
| [V2-R05](#v2-r05) 修复环境状态、来源等级与资源收尾判定 | 修复 V2-F02，让核心明确表达并严格执行profile/任务的环境要求。 | V2-R00 |
| [V2-R06](#v2-r06) 把请求、artifact 和原始响应连成可重取证据 | 修复 V2-F03，从真实EvidenceStore引用构造认证facts，消除requestId伪装artifactId。 | V2-R04, V2-R05 |
| [V2-R07](#v2-r07) 修复批次回归与能力状态对齐 | 恢复可构建、可追溯的基础；让后续M3任务使用同一份已修复代码，不带假绿进入集成。 | V2-R01, V2-R03, V2-R04, V2-R06 |
| [SG-053](#sg-053) 完成真实 Playwright Reporter、collector 与稳定 ID | 从已有 reporter/inventory 增量完成真实框架接入，修复retry/脱敏/附件，并形成可用于Gate重收集的原始报告。 | V2-R07 |
| [SG-055](#sg-055) 收口后端观察中间件与测试专用启动器 | 复用已有stackgate_observation.py，确保只记录本次真实完成的响应、不覆盖其他请求、不把客户端自报当来源。 | V2-R03, V2-R06 |
| [SG-056](#sg-056) 实现 attach 环境来源核验 | 连接已有测试服务但不接管用户服务；只有独立来源证据充足时允许OBSERVED。 | SG-055, V2-R06 |
| [SG-057](#sg-057) 实现 Compose 配置安全预检 | 创建任何容器前确认资源、端口、挂载、凭证与数据边界。 | SG-055, V2-R03 |
| [SG-058](#sg-058) 实现自有 Compose 启动、动态端口和来源快照 | 每个run启动独立测试实例，从实际资源读取绑定而非猜端口。 | SG-057, V2-R06 |
| [SG-059](#sg-059) 实现 readiness 与运行中环境连续性 | 区分服务启动、健康、实例正确及候选输入已准备好。 | SG-056, SG-058 |
| [SG-060](#sg-060) 关联浏览器、Probe 和独立后端观察 | 证明本次页面确实调用了预期后端，而不是只获得前端Mock响应。 | SG-053, SG-055, SG-059, V2-R06 |
| [SG-061](#sg-061) 清理本次 Compose 资源并固定测试数据边界 | 取消/失败后只清理可证实本次创建的资源，结果可供环境assessment重新认证。 | SG-058, SG-059 |
| [SG-062](#sg-062) 将新增适配器接入同一 Plan / Run / Gate | 把零散模块变成产品真实路径；同一计划执行和Gate重认证支持完全相同的检查。 | SG-053, SG-056, SG-058, SG-059, SG-060, SG-061, V2-R07 |
| [SG-063](#sg-063) 防止 inventory、skip、expected-fail 和 flaky 假绿 | 要求固定验收集合确实执行；配置期望数与真实执行数不可混同。 | SG-062, SG-053 |
| [SG-064](#sg-064) 建立“各自单测绿、真实联调失败”的演示负例 | 证明StackGate在正确环境和完整证据下发现真正的前后端不一致，而不是因环境缺失拒绝。 | SG-062, SG-063 |
| [SG-065](#sg-065) 合法修复后新 Run 成功与旧证据失效 | 演示失败→证据→限定修复→新运行通过，而非覆盖旧失败或改验收标准。 | SG-064 |
| [AUD-004](#aud-004) 补全 Linux/WSL 受控执行能力，不外推Windows结果 | 满足原平台目标的前提，或明确留下阻塞；不能仅用Node可运行宣称Runner已支持Linux。 | V2-R07 |
| [SG-066](#sg-066) 验证保护契约、测试和批准记录的漂移 | 证明修改标准不能替代修复实现；相同任务意图有独立确认revision。 | SG-062, SG-063 |
| [SG-067](#sg-067) 验证旧服务、伪来源与执行中换实例 | 确保环境来源链抵抗常见误接与陈旧证据，不只验证文档结构。 | SG-062, SG-059, SG-060 |
| [SG-068](#sg-068) 验证未知 Schema 和动态消费者的保守回退 | 新运行器接入后仍不把静态分析未知当无影响；有限支持边界继续生效。 | SG-062 |
| [SG-069](#sg-069) 验证真实浏览器与后端证据的隐私、预算 | 阻止敏感原值进入常规报告和交接，超过预算不丢掉关键失败后伪装完整。 | SG-062, SG-053, SG-055 |
| [SG-070](#sg-070) 完成 Windows 原生全栈、路径和取消验证 | 新浏览器/环境接线在目标Windows实际运行，不能只沿用M2进程测试。 | SG-062, SG-061 |
| [SG-071](#sg-071) 完成 Linux/WSL、worktree 与候选基线验收 | 输入身份和资源状态跨平台/分支不被错误复用。 | SG-062, AUD-004 |
| [SG-072](#sg-072) 完成网络、引用、参数与清理安全反例 | 验证插件自身受控操作边界，覆盖新增HTTP和环境连接，不止检查安全文案。 | SG-061, SG-069, V2-R03 |
| [SG-073](#sg-073) 建立 T01—T27 注册与验收执行器 | 把原始规格的P0验收逐项绑定真实测试，杜绝缺项或skip假通过。 | SG-064, SG-065, SG-066, SG-067, SG-068, SG-069, SG-070, SG-071, SG-072 |
| [SG-074](#sg-074) 整理至少12个可复现故障场景 | 将演示和回归所需故障固定为可重建资产，避免手工改仓库。 | SG-073 |
| [SG-075](#sg-075) 测量性能与框架开销，不制造节省比例 | 给出扫描/计划/报告/执行的真实分项成本，处理当前测试很慢的维护问题。 | SG-074 |
| [SG-076](#sg-076) 形成平台和工具组合的真实兼容矩阵 | 每项支持声明都能追溯到相同版本/平台的实际运行。 | SG-073, SG-075, SG-070, SG-071 |
| [SG-077](#sg-077) 完成真实 M3 阶段出口 | 使M3完成成为可复跑的工程结果，而不是提交标题或任务计数。 | SG-062, SG-063, SG-064, SG-065, SG-066, SG-067, SG-068, SG-069, SG-070, SG-071, SG-072, SG-073, SG-074, SG-075, SG-076 |

补充依赖用于安排本计划；原 SG 任务的其他前置仍从原台账检查。本计划中列出的任务为实际交付工作，初始复用/修复状态以当前源码和新测试为准。

## 4. 每项任务的统一执行协议

每项先读取它涉及的文件；新增测试须证明具体行为差异，导入报错与测试准备失败不冒充业务反例。代码改动前保留 RED 结果，已有正确实现可直接回归并解释无需改动。通过目标测试后跑受影响回归；批次出口再跑完整集合，不每个小函数都重复整仓测试。

记录命令使用：

```bash
node scripts/record.mjs V2-R01 reporter-load -- pnpm exec vitest run tests/contract/playwright-reporter.test.ts
```

在 V2-R00 完成 recorder 支持之前，用该任务规定的 bootstrap 日志方式，不能虚构已经支持新 ID。每项结束更新该任务 ledger、PROGRESS、BLOCKERS、真实文件列表和下一项；有本地提交授权时仅提交当前任务文件并记录真实 SHA，未经授权不 push。

## 5. 详细任务卡


<a id="v2-r00"></a>
### V2-R00 · 锁定 V2、恢复基线和补充任务台账

**目标：** 得到可追溯的真实起点，记录当前构建失败而不是沿用旧 M2 成功记录。  
**依据与映射：** 新增审计修复  
**本计划前置：** 无。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 读取 AGENTS.md、docs/implementation/{PROGRESS,tasks,audit-m3-fixes,BLOCKERS}；新增 docs/implementation/{audit-v2-fixes.json,V2-audit-baseline.md}、scripts/verify-v2-audit.mjs、tests/bootstrap/v2-ledger.test.mjs；修改 scripts/record.mjs。

**输入输出与接口：** 新台账 schema_version=0.1，保存 baseline_sha、source_plan、tasks；task 含 task_id、status、dependencies、actual_files、verification、blockers、next_action。verifyV2Ledger(value) 返回 string[]；只允许本计划八个 V2-R ID，依赖须存在，DONE 必须有可归属成功证据。

**实施步骤：**

- [ ] **1.** 执行第1.1节 Git 与版本命令；明确工作分支 V2。将审计基线和本地 HEAD 差异写入 V2-audit-baseline.md，不重置用户改动。
- [ ] **2.** 先运行根 pnpm typecheck、pnpm build 与现有目标测试，保存原始 stdout/stderr 和退出码；缺 Node/pnpm/tool 时记录工具阻塞，不升级 lock。开发依赖安装仅在已审查 lock/lifecycle 后 pnpm install --frozen-lockfile。
- [ ] **3.** 创建 audit-v2-fixes.json 八项条目；验证器拒绝重复 ID、未知依赖、环、缺失证据和漂移期间验证。测试和源码清单分开避免 recorder 输出污染自身摘要。
- [ ] **4.** 扩展 record.mjs.allowedTaskId 读取新台账；保留已存在 SG/AUD 的精确验证规则，禁止正则单独允许任意 V2-R99。
- [ ] **5.** Bootstrap 阶段先用 shell/Node 保存原始日志到专用 evidence 前缀；recorder 支持后用实际命令重跑台账测试，不回填伪造的历史命令。
- [ ] **6.** 列出已解决的旧审计项与本次尚待验证项；更新架构图中已过时的“所有 M2 未实现”描述，不删除历史日志。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
// tests/bootstrap/v2-ledger.test.mjs — 使用此文件构造的 minimalLedger 合法夹具
assert.deepEqual(verifyV2Ledger(minimalLedger), []);
const bad = structuredClone(minimalLedger);
bad.tasks[0].status = 'DONE';
bad.tasks[0].verification = [];
assert.ok(verifyV2Ledger(bad).some(x => x.includes('evidence')));
assert.ok(verifyV2Ledger({...minimalLedger, tasks:[...minimalLedger.tasks, minimalLedger.tasks[0]]}).length > 0);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
node --test tests/bootstrap/v2-ledger.test.mjs
node scripts/verify-v2-audit.mjs
pnpm verify:source
pnpm verify:tasks
```

**完成条件：** 有当前 V2 的实际基线记录；坏数据测试真实失败；新 ID 可以记录但未登记 ID 被拒；不把尚未恢复的全量 build 标通过。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="v2-r01"></a>
### V2-R01 · 恢复 Reporter 导出、加载和不可覆盖写入基础

**目标：** 解决 V2-F01，建立后续真实 Reporter 验收的可加载入口，同时防止同一 attempt 覆盖报告。  
**依据与映射：** 新增审计修复  
**本计划前置：** V2-R00。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 packages/adapter-playwright/src/{inventory,reporter}.ts；新增 src/index.ts；按现有 scripts/build.mjs 入口约定接出 dist/playwright-reporter.mjs；新增 tests/contract/playwright-reporter.test.ts、tests/unit/v2/reporter-storage.test.ts。

**输入输出与接口：** 实现 assertNoCompletedReport(directory:string,name?:string):void（保留导入名称）；任何既有目标文件均拒绝覆盖，完整/不完整/损坏分别诊断。atomicWriteJson(directory,name,value):string 保留现有签名，新增真实 no-replace 语义；index 默认导出 StackGateReporter。

**实施步骤：**

- [ ] **1.** 先以当前根 typecheck 和独立 ESM import 复现不存在的命名导出；记录目标文件而不是排除 packages 范围。
- [ ] **2.** 实现导出检查：name 仅允许安全 basename；现有目标、链接、硬链接、非普通目录、不可读目标都失败，不能返回“没有完整报告所以可覆盖”。
- [ ] **3.** 使用已存在的有界 no-overwrite 存储工具或独立临时文件+最终 no-replace 提交；最终提交的并发保护是权威，不能只在构造器先 exists。禁止 rename 直接覆盖已存在目标。
- [ ] **4.** 构造器遭遇预存在/身份异常后进入不可写状态；onEnd 不继续覆盖目标。错误诊断写到单独自有失败产物或 stderr，不破坏旧 bytes。
- [ ] **5.** 新增 default export index，确保现有 build 自动入口能发现；真实 import dist 文件验证。这里仅补 Reporter 构建入口，不提前做 npm 发行任务。
- [ ] **6.** 测试两个 Reporter 同时指向同一 attempt、损坏旧 JSON、directory/name 越界、已完成与未完成报告；获胜的一份不被另一份覆盖。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
import { assertNoCompletedReport, atomicWriteJson } from '../../packages/adapter-playwright/src/inventory.js';
// tempDirectory 由本测试创建，未与用户目录共享。
const before = Buffer.from('{"completed":true,"marker":"keep"}\n');
writeFileSync(path.join(tempDirectory, 'playwright.json'), before);
expect(() => assertNoCompletedReport(tempDirectory)).toThrow();
expect(() => atomicWriteJson(tempDirectory, 'playwright.json', {completed:false})).toThrow();
expect(readFileSync(path.join(tempDirectory, 'playwright.json'))).toEqual(before);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/unit/v2/reporter-storage.test.ts tests/contract/playwright-reporter.test.ts
pnpm typecheck
pnpm build
node --input-type=module -e "import('./dist/playwright-reporter.mjs').then(m=>{if(typeof m.default!=='function')process.exitCode=1})"
```

**完成条件：** 根 typecheck/build 在锁定环境通过；ESM 导出可加载；并发/既有报告不覆盖；源码未被排除。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="v2-r02"></a>
### V2-R02 · 绑定声明操作与实际 HTTP 请求

**目标：** 修复 V2-F04；错误 method/path/service/origin 在产生任何网络流量之前被拒绝。  
**依据与映射：** V2-F04；补充 SG-054  
**本计划前置：** V2-R00。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 packages/core/src/services/http-policy.ts、presets/fastapi-react/scripts/probe_helpers.py、examples/contract-drift-demo/apps/api/scripts/probe_performance.py；新增 packages/core/src/services/operation-authorization.ts、tests/unit/v2/http-authorization.test.ts、tests/fixtures/v2-regressions/http-policy.json。

**输入输出与接口：** 保留 authorizeRequest(input:RequestAuthorizationInput):RequestDecision；新增 parseDeclaredOperation(key:string):{service_id:string;method:string;path:string}，严格调用已有操作键解析语义；Python 与 TS 使用同一允许/拒绝夹具，实际 URL 只由确认声明生成。

**实施步骤：**

- [ ] **1.** 建立三条现有反例：不同 path、null declaration、fragment；附加 invalid service、method mismatch、NaN/Infinity/小数资源值。先证明当前错误允许。
- [ ] **2.** 解析 service/method/path 后逐字段比较。调用输入与声明不一致拒绝；health 在环境需求中单独登记，不能用 null 自动放行。
- [ ] **3.** 实施第2.3节精确 path 子集，origin 规范化必须与真实传输一致；拒绝编码/模板歧义，而非做不透明的清洗和重定向。
- [ ] **4.** 让 Python helper 使用同样的输入检查；runProbe 的 declaration 需由确认配置/Plan 绑定，不能接受随意 env 指向另一份策略后仍声称已确认。
- [ ] **5.** 在两个独立 loopback listener 上验证未授权访问数为0；核对目标服务器实际收到的 method/path 与声明完全一致。
- [ ] **6.** 更新错误码和 CLI/collector 映射；权限拒绝与实际服务器业务 FAIL 分开。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
const policy = {...DEFAULT_HTTP_REQUEST_POLICY, allowed_origins:['http://127.0.0.1:8000']};
const input = {policy, origin:'http://127.0.0.1:8000', method:'GET', path:'/different-operation', declared_operation_key:'api:GET /api/performance'};
expect(authorizeRequest(input).allowed).toBe(false);
expect(authorizeRequest({...input,path:'/api/performance',declared_operation_key:null}).allowed).toBe(false);
expect(authorizeRequest({...input,path:'/api/performance#ignored'}).allowed).toBe(false);
expect(authorizeRequest({...input,path:'/api/performance'}).allowed).toBe(true);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/unit/v2/http-authorization.test.ts tests/integration/probe/http.test.ts
pnpm typecheck
pnpm verify:schemas
```

**完成条件：** TS/Python 共同夹具一致；不同端点、fragment 和无声明都在零请求状态拒绝；实际 wire path 被记录。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="v2-r03"></a>
### V2-R03 · 实施绝对请求期限、禁代理和有界响应写入

**目标：** 修复 V2-F05，慢速数据不能无限延长期限，外部环境不能隐式更改代理和凭证。  
**依据与映射：** V2-F05；补充 SG-054  
**本计划前置：** V2-R02。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 presets/fastapi-react/scripts/probe_helpers.py；新增同目录 probe_worker.py（私有一次请求工作进程）和 tests/integration/probe/deadline-proxy.test.ts；修改 probe_performance.py 的错误和产物写入。

**输入输出与接口：** 保留 perform_request(...) 的公共参数与结果事实；新增私有 request_worker(payload)->bounded frame；父级用 monotonic deadline 管理进程，wait/kill 仅针对活句柄。write_json(path,value) 改为独占提交，不覆盖同 attempt 已有文件。

**实施步骤：**

- [ ] **1.** 先复现100ms期限下每20ms少量body返回的错误成功，再复现只授权目标而请求转向合成代理的行为；所有测试仅loopback。
- [ ] **2.** 显式 ProxyHandler({})；消除系统代理发现依赖，保留用户全局配置不变。测试 http_proxy/HTTP_PROXY/https_proxy/no_proxy 与带虚构凭证的代理环境，未授权代理访问数必须为0。
- [ ] **3.** 实现受控单次请求进程；父进程自请求开始计算单调截止，覆盖连接、DNS、header、body。deadline 后关闭管道、终止且等待私有worker；记录没有后续输出/请求。不要留下超时线程继续工作。
- [ ] **4.** worker 每次最多读取剩余预算+1，采用有上限帧协议传输body和元数据；响应错误分支也限制字节。禁压缩或显式拒绝未支持encoding，禁止用重新序列化body替代实际bytes。
- [ ] **5.** 统一 ProbeError 分类：DEADLINE_EXCEEDED、CONNECT_FAILED、RESPONSE_OVER_BUDGET、REDIRECT_REFUSED 与解析/身份错误，异常和HTTPError body都经过相同边界。
- [ ] **6.** 请求级失败不生成 completed success report；用 no-replace 写 probe-error 与合法诊断，保留旧产物。设100ms测试产品deadline，harness允许有明确调度余量，不能把500ms仍成功当通过。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
// 真监听器每20ms发送1byte，持续至少2秒；不是 mock socket。
const observed = await runSlowDripProbe({deadline_ms:100, interval_ms:20, duration_ms:2000});
expect(observed.reason).toBe('DEADLINE_EXCEEDED');
expect(observed.completed).toBe(false);
expect(observed.elapsed_ms).toBeLessThan(1000); // 仅harness调度上限，产品截止仍100ms
expect(observed.worker_alive_after).toBe(false);
// runSlowDripProbe 由本任务测试文件实现：启动loopback服务、Python子进程、收集退出/文件、finally回收。
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/probe/deadline-proxy.test.ts tests/integration/probe/http.test.ts
python -B -E -m py_compile presets/fastapi-react/scripts/probe_helpers.py presets/fastapi-react/scripts/probe_worker.py
```

**完成条件：** 慢header、慢body、连续小包、拒绝和错误响应均有界；隐式代理未命中；无残留worker；已有证据未覆盖。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="v2-r04"></a>
### V2-R04 · 统一 JSON Pointer、自有字段与有限数字语义

**目标：** 修复 V2-F06，不让空JSON中的继承属性或非有限值满足真实数据断言。  
**依据与映射：** V2-F06；补充 SG-054  
**本计划前置：** V2-R00。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 packages/core/src/services/probe-assertions.ts、presets/fastapi-react/scripts/probe_helpers.py；新增 tests/unit/v2/probe-assertions.test.ts、tests/fixtures/v2-regressions/assertions.json、tests/contract/probe-assertions-parity.test.ts。

**输入输出与接口：** 保留 evaluateAssertion(document,assertion):ProbeAssertionOutcome 与 evaluateDeclaration(...)；parseJsonResponse(bytes:Uint8Array):unknown 在本模块导出，使用现有有界严格解析并递归拒绝非有限number；Python对应 parse_json_response(bytes)。

**实施步骤：**

- [ ] **1.** 对空JSON的constructor/__proto__/toString建立exists反例，同时建立这些名字确为自有字段时可读取的正例。
- [ ] **2.** 对象使用 Object.hasOwn；保留null和false的真实exists。实现Pointer转义有效性、空键和规范数组下标，非法表达式只给诊断不执行。
- [ ] **3.** 数字只接受Number.isFinite；Python用parse_constant拒绝NaN/Infinity并检查溢出，bool不是number；不以字符串转数字方便过关。
- [ ] **4.** 明确schema允许的body类型；JSON null/scalar是解析事实，不用typeof object代表“可解析”。若当前declaration只支持对象根则给单独不支持诊断，不说它不是JSON。
- [ ] **5.** 建立共享表驱动夹具，TS与Python对每个assertion比较passed/reason；无需发网。包含转义、空字段、0/false/null、数组01、继承名、自有同名、1e400。
- [ ] **6.** 把核心重算用于真实响应原始bytes，不采信probe自报passed/schema_valid；更新相关fixtures但不放宽原目标。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(evaluateAssertion(JSON.parse('{}'), {assertion_id:'a',pointer:'/constructor',operator:'exists'}).passed).toBe(false);
expect(evaluateAssertion(JSON.parse('{"constructor":0}'), {assertion_id:'a',pointer:'/constructor',operator:'exists'}).passed).toBe(true);
expect(evaluateAssertion({value:Infinity}, {assertion_id:'b',pointer:'/value',operator:'type',expected:'number'}).passed).toBe(false);
expect(() => parseJsonResponse(Buffer.from('{"value":1e400}'))).toThrow();
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/unit/v2/probe-assertions.test.ts tests/contract/probe-assertions-parity.test.ts tests/integration/probe/http.test.ts
pnpm typecheck
```

**完成条件：** 空JSON无继承字段误判，自有同名允许；TS/Python夹具输出一致；非有限/非法JSON拒绝。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="v2-r05"></a>
### V2-R05 · 修复环境状态、来源等级与资源收尾判定

**目标：** 修复 V2-F02，让核心明确表达并严格执行profile/任务的环境要求。  
**依据与映射：** V2-F02；补充 AUD-003  
**本计划前置：** V2-R00。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 packages/core/src/services/environment-assessment.ts、tests/contract/m3-runtime-contracts.test.ts；新增 tests/unit/v2/environment-assessment.test.ts；必要字段修改 schemas/0.1/environment-*.schema.json 后生成类型；新增 ADR-013。

**输入输出与接口：** 按第2.4节落地 ConfirmedEnvironmentRequirements；先为旧评估入口增加requirements并更新调用，V2-R06完成认证facts输入。minimum_provenance显式；no-environment在core独立分支处理，不伪造refs。

**实施步骤：**

- [ ] **1.** 复用现有contract test的baseInput，把prepare.status逐一替换BLOCKED/ERROR/UNKNOWN/CLEANED均期望false。再测required_by_task=false但backend observation=true不能快捷成功。
- [ ] **2.** 只有prepare READY且来源具备事实依据可进入业务准备成功；finalize必须是正确phase、相同run/input/instance/origin/datarevision并位于运行时间范围。
- [ ] **3.** 等级取最弱再比较minimum；混合OBSERVED/CONTROLLED在最低OBSERVED时可满足、在CONTROLLED时不满足；应用自报CONTROLLED不作为可信CI来源。
- [ ] **4.** 核对prepare中创建的资源与cleanup逐一对应；nativeID、owner token、creation identity和scope必须匹配。PENDING/FAILED/UNKNOWN、自有资源缺项、非自有资源被删均拒绝。PARTIAL不能因标签被忽略。
- [ ] **5.** 本地无环境profile只在所有环境/后端要求为false时返回不需要环境；发现相矛盾配置给配置/前提错误；不存缺失refs的成功assessment。
- [ ] **6.** 兼容旧证据读取但不能让旧不完整assessment自动获得新信任；修改generated仅通过generate:types。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
// 追加到现有 tests/contract/m3-runtime-contracts.test.ts，复用baseInput。
for (const status of ['BLOCKED','ERROR','UNKNOWN','CLEANED'] as const) {
  const input = baseInput();
  input.prepare = {...input.prepare!, status};
  expect(assessEnvironment(input).satisfied).toBe(false);
}
// 新requirements接口合并后，将baseInput改为本任务确认要求夹具；断言语义不变。
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm generate:types
pnpm verify:schemas
pnpm exec vitest run tests/unit/v2/environment-assessment.test.ts tests/contract/m3-runtime-contracts.test.ts
pnpm typecheck
```

**完成条件：** 所有环境状态/最低等级/清理反例拒绝；受控与已观察来源有明确差别；仅合法无环境profile不需要assessment。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="v2-r06"></a>
### V2-R06 · 把请求、artifact 和原始响应连成可重取证据

**目标：** 修复 V2-F03，从真实EvidenceStore引用构造认证facts，消除requestId伪装artifactId。  
**依据与映射：** V2-F03；补充 AUD-003  
**本计划前置：** V2-R04, V2-R05。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 packages/core/src/services/authenticate-environment-evidence.ts、tests/integration/environment/evidence-authentication.test.ts；修改 environment-assessment.ts、相关Schema/fixtures、tests/contract/m3-runtime-contracts.test.ts。

**输入输出与接口：** 实现第2.4节 authenticateEnvironmentEvidence 和 AuthenticatedEnvironmentFacts；所有读取通过EvidenceReader与实际artifact_index；assessEnvironment(facts)只负责语义推导。旧assessmentReferencesAuthentic若保留只能作为额外检查，不独自授予成功。

**实施步骤：**

- [ ] **1.** 用现有FileEvidenceStore创建隔离Run与实际body/observation artifacts，故意令request_id与artifact_id不同；正例要求satisfied与全部refs校验同时成立。
- [ ] **2.** 分别读取prepare/finalization/cleanup/observation/body；校验索引entry与回读artifact一致、size/hash、run/check/attempt、media/kind和结构。未索引路径不能参与判断。
- [ ] **3.** 按run+check+attempt+request+instance连接请求和后端观察；比较operation/status/media/bytes/digest，拒绝重复冲突request、错误attempt、跨run、伪body和截断。
- [ ] **4.** 期望操作来自任务/计划，不能从观察反向生成所需操作；断言用V2-R04从rawbytes重算。期望请求与运行时间/实例来源由后续SG-060提供。
- [ ] **5.** 让assessment引用真实observation/body的artifact IDs；禁止把request_id硬塞进authenticated_refs使测试通过。所有引用均可从索引重取，缺一项拒绝。
- [ ] **6.** 追加兼容读取反例：旧missing/none占位和自报satisfied不能升级。验证无文件系统任意读、没有新网络或业务命令执行。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
// 此任务的集成fixture先用FileEvidenceStore存入真实artifact，再调用认证函数。
expect(observation.request_id).not.toBe(observationArtifact.artifact_id);
const authenticated = await authenticateEnvironmentEvidence(request);
expect(authenticated.ok).toBe(true);
if (!authenticated.ok) throw new Error('fixture authentication failed');
const assessment = assessEnvironment(authenticated.facts);
expect(assessment.satisfied).toBe(true);
expect(assessment.observation_refs).toContain(observationArtifact.artifact_id);
expect(assessment.observation_refs).not.toContain(observation.request_id);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/environment/evidence-authentication.test.ts tests/contract/m3-runtime-contracts.test.ts
pnpm verify:schemas
pnpm verify:boundaries
```

**完成条件：** 真实store正例打通；跨scope/未索引/字节不一致/占位引用均拒绝；纯函数没有I/O。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="v2-r07"></a>
### V2-R07 · 修复批次回归与能力状态对齐

**目标：** 恢复可构建、可追溯的基础；让后续M3任务使用同一份已修复代码，不带假绿进入集成。  
**依据与映射：** 新增审计修复  
**本计划前置：** V2-R01, V2-R03, V2-R04, V2-R06。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 docs/implementation/{PROGRESS,BLOCKERS,architecture-map}.md、audit-v2-fixes.json；新增 tests/integration/stages/v2-repair-baseline.test.ts；按实际版本更新 tools/compatibility-lock.json。

**输入输出与接口：** 新增repair summary只汇总真实命令；工厂installed、runtimeavailable、scopetested分列。保持原M2 stage语义，不能把未实现M3写进去。

**实施步骤：**

- [ ] **1.** 按本计划受影响范围运行全部新单测/合同/HTTP测试；复验旧AUD-001/002的现有反例，没有必要另写第二套源码指纹或Gate。
- [ ] **2.** 在锁定Windows环境执行完整M2 stage和SG-051/052的真实测试；根与web分别typecheck/build，禁止把根Vitest4结果当webVitest5已测。
- [ ] **3.** 检查新记录sourcebefore/after稳定且可归属；GENERATED变化使用预声明步骤边界，不事后删除证据来让摘要一致。
- [ ] **4.** 对每个修复项记录关闭依据；仍有环境阻塞标BLOCKED。只有构建与修复批次真实成立才进入SG-053的运行证明。
- [ ] **5.** 记录当前支持表：command/JUnit可执行；新模块的具体已测范围；未实现Compose/浏览器全链路仍不宣称可用。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
// repair-baseline 调用构建后CLI；退出0仅代表操作成功。
expect(JSON.parse(cliUnknown.stdout).exit_code).toBe(64);
expect(cliUnknown.code).toBe(64);
expect(JSON.parse(scan.stdout).runtime).toBe('NOT_EXECUTED');
expect(scan.stdout.trim().split('\n')).toHaveLength(1);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm verify:source
pnpm verify:schemas
pnpm verify:boundaries
pnpm typecheck
pnpm build
pnpm lint
pnpm verify:stage -- --stage M2
pnpm --dir examples/contract-drift-demo/apps/web typecheck
pnpm --dir examples/contract-drift-demo/apps/web test
pnpm --dir examples/contract-drift-demo/apps/web build
```

**完成条件：** 每一项有真实退出/范围/源码摘要；无M3假完成；缺平台不能通过删检查制造完成。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-053"></a>
### SG-053 · 完成真实 Playwright Reporter、collector 与稳定 ID

**目标：** 从已有 reporter/inventory 增量完成真实框架接入，修复retry/脱敏/附件，并形成可用于Gate重收集的原始报告。  
**依据与映射：** 原 SG-053；V2-F07  
**本计划前置：** V2-R07。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 packages/adapter-playwright/src/{reporter,inventory,index}.ts；新增 src/{collector,adapter,artifacts}.ts；新增 examples/contract-drift-demo/apps/web/playwright.config.ts、tests/acceptance/performance.spec.ts、tests/contract/playwright-reporter.test.ts、tests/integration/browser/reporter-real.test.ts。

**输入输出与接口：** StackGateReporter implements 官方 Reporter；onTestEnd(test:TestCase,result:TestResult) 读取 result.retry；collectPlaywright(step:CheckStep,context:CollectionContext):Promise<CheckResult>；PlaywrightAdapter 实现现有 Adapter，来源认证尚未齐备时只保留事实，不提前完成real_backend。

**实施步骤：**

- [ ] **1.** 查实际项目/锁文件的Playwright版本；缺失时明确增加一个经过测试的精确版本并更新lock。使用 @playwright/test/reporter 的官方类型，不能继续手抄retries字段。
- [ ] **2.** 对真实测试运行记录inventory、project/repeat identity、retry、expected/actual status；稳定ID从声明annotation取，缺/重复/冲突拒绝，不用标题推断。forbidOnly明确开启；不能靠不存在的test.only字段判断完整性。
- [ ] **3.** 构造真实先失败后成功的测试，配置retries=1；原始attempts保留0与1，collector标flaky，required默认INCOMPLETE。expected-fail不自动成为业务成功。
- [ ] **4.** 采集console/pageerror/request failure需通过明确fixture和versioned附件通道；没有采集能力标未验证，不能把永远空数组当无错误。
- [ ] **5.** 附件实际复制到当前attempt范围并记录摘要/size；支持path与body两种真实框架形式；拒绝越界/链接/过大/丢失；trace ZIP按用途而不是仅MIME归restricted。requests附件用有界ESM fs读取，不靠未定义require。
- [ ] **6.** 复用既有RedactionStream及显式canary值对文本脱敏；Authorization Bearer/Cookie跨空格、多行、缓冲边界和截断均测试。不要把截图/trace标自动完全脱敏。
- [ ] **7.** 所有报告经过Schema校验；onError/onEnd异常留下未完成诊断；V2-R01的no-replace约束覆盖最终写入。
- [ ] **8.** 运行真实浏览器合同测试、根build以及构建后Reporter加载；只有这些成立才能将SG-053标DONE。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
// reporter-real 测试真正启动Playwright，原始报告来自其回调。
expect(report.attempts.map(a => a.retry)).toEqual([0, 1]);
expect(report.attempts.map(a => a.actual_status)).toEqual(['failed', 'passed']);
expect(collected.flaky_tests).toBe(1);
expect(gateFromCollection).not.toMatchObject({decision:'ALLOW'});
expect(JSON.stringify(publicReport)).not.toContain('audit_canary_123');
// gateFromCollection 由现有evaluateGate包装器计算，不从report.status直接构造。
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/contract/playwright-reporter.test.ts tests/integration/browser/reporter-real.test.ts
pnpm --dir examples/contract-drift-demo/apps/web exec playwright test --config playwright.config.ts
pnpm typecheck
pnpm build
```

**完成条件：** 真实框架产生可回读报告与附件；重试次数正确；错误不能伪绿；浏览器未安装明确BLOCKED，不能用构造回调替代DONE。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-055"></a>
### SG-055 · 收口后端观察中间件与测试专用启动器

**目标：** 复用已有stackgate_observation.py，确保只记录本次真实完成的响应、不覆盖其他请求、不把客户端自报当来源。  
**依据与映射：** 原 SG-055；复用已存在中间件  
**本计划前置：** V2-R03, V2-R06。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 presets/fastapi-react/scripts/stackgate_observation.py；新增 examples/contract-drift-demo/apps/api/app/test_observation.py、scripts/launch_test_api.py、tests/integration/environment/observation.test.ts。

**输入输出与接口：** 保留 StackGateObservationMiddleware(app, directory, instance_id, allowed_run_ids, data_revision, operations, max_recorded_bytes)；新增启动记录协议（ADR-013内注册）绑定pid/creation/input/instance/datarevision，状态路径由启动器授予。

**实施步骤：**

- [ ] **1.** 读取现有middleware，先建立请求重复覆盖、body中途异常、超预算、未授权run、伪instance header的回归；这些未被本报告全部动态验证，不先宣称漏洞。
- [ ] **2.** 只在显式测试launcher包裹同一个create_app；正常应用入口不开启观察，不自动创建公开证据读取端点。
- [ ] **3.** 请求ID必须由运行侧生成，校验所有scope。记录目录加入check/attempt，duplicate request冲突拒绝；body与JSON独占写入，只有全部完成才生成完成索引。
- [ ] **4.** 跟踪http.response.body的more_body结束；异常/客户端断开/压缩不支持/截断只留诊断，不把部分body哈希当完整观察。流式响应若超已测能力显式拒绝。
- [ ] **5.** instance与data_revision由launcher产生/确认，不能回显请求中传来的实例；启动记录绑定当前输入及owned进程。headers/body不直接进入常规报告；合成测试数据下原始证据仍按敏感级别存储。
- [ ] **6.** 用真实FastAPI服务和真实HTTP请求验证body字节与记录相同，错误和重复请求不可覆盖；finally仅回收测试自己创建服务。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(observation.instance_id).toBe(launcher.instance_id);
expect(observation.instance_id).not.toBe('client_supplied_instance');
expect(observation.response_digest).toBe(hashBytes(responseBytes));
expect(observation.run_id).toBe(runId);
expect(repeatedRequestResult.reason).toContain('IDENTITY');
expect(originalObservationBytes).toEqual(await readFile(originalPath));
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/environment/observation.test.ts
python -B -E -m py_compile presets/fastapi-react/scripts/stackgate_observation.py examples/contract-drift-demo/apps/api/scripts/launch_test_api.py
```

**完成条件：** 真实请求可独立观察；不完整body与重复ID不生假事实；普通API运行不暴露观察接口。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-056"></a>
### SG-056 · 实现 attach 环境来源核验

**目标：** 连接已有测试服务但不接管用户服务；只有独立来源证据充足时允许OBSERVED。  
**依据与映射：** 原 SG-056  
**本计划前置：** SG-055, V2-R06。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 packages/adapter-compose/src/attach/{adapter,provenance,process-observation}.ts、examples/contract-drift-demo/scripts/demo-env.mjs、tests/integration/environment/attach.test.ts。

**输入输出与接口：** AttachAdapter implements EnvironmentPort；prepare/observe 不启动和停止被attach的服务；prepare返回EnvironmentManifest；process observation核对实例、启动记录、输入、origin、datarevision。

**实施步骤：**

- [ ] **1.** 先写健康但无来源记录、复制旧provenance、假PID、instance/input/datarevision不符的反例；清理操作不可关闭用户预先启动服务。
- [ ] **2.** 读取确认origin和provenance位置，用V2-R02/03的网络约束做健康观察；拒绝任意URL与自扩展allowlist。
- [ ] **3.** 核对启动器证据与live进程creation identity、实例及当前input，不能只看一个JSON或进程名字。拿不到独立证据则只DECLARED并保留诊断。
- [ ] **4.** 保存prepare snapshot和独立观察artifact；不把后续cleanup状态写回prepare；记录绑定后的实际origin。
- [ ] **5.** 两个真实实例A/B、相同health响应但不同源码/identity时，必须区分；测试结束证明attach前服务仍在运行。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(healthyWithoutProvenance.provenance).toBe('DECLARED');
expect(assessedHealthyWithoutProvenance.satisfied).toBe(false);
expect(observedCurrent.provenance).toBe('OBSERVED');
expect(afterCleanup.originalServiceStillAlive).toBe(true);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/environment/attach.test.ts tests/integration/environment/observation.test.ts
```

**完成条件：** attach真正区分健康和来源；旧/假记录不能升级；用户服务始终保留。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-057"></a>
### SG-057 · 实现 Compose 配置安全预检

**目标：** 创建任何容器前确认资源、端口、挂载、凭证与数据边界。  
**依据与映射：** 原 SG-057  
**本计划前置：** SG-055, V2-R03。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 packages/adapter-compose/src/{config,preflight,target-bindings}.ts、examples/contract-drift-demo/compose.test.yaml、tests/security/compose-preflight.test.ts。

**输入输出与接口：** preflightCompose(effectiveConfig:unknown, policy:EffectivePolicy):ComposePreflightResult；结果含 approved:boolean、diagnostics、resource_plan、bindings；effectiveConfig 来自已授权固定docker compose config命令，不任意加载业务JS。

**实施步骤：**

- [ ] **1.** 先建立固定container_name、host network、privileged、docker.sock、危险bind mount、external volume/network、生产连接、固定端口冲突的拒绝样例。
- [ ] **2.** 读取Compose原文件与有效配置摘要，环境插值后的秘密只留restricted或不存；不把原始docker config输出复制进公共日志。
- [ ] **3.** 只允许本次命名空间和测试数据；动态端口绑定127.0.0.1；记录容器端口到实际origin的授权规则，不预先放开任意localhost端口。
- [ ] **4.** 明确readonly源码挂载、可写输出、build context与ignore输入；无法覆盖实际构建输入的配置阻塞，不以GitSHA代替所有inputs。
- [ ] **5.** 预检dry-run不得创建资源；运行恶意配置测试时用本机解析和专用fixture，不触碰用户现有Docker资源。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(preflightCompose({services:{api:{privileged:true}}}, policy).approved).toBe(false);
expect(preflightCompose(socketMountFixture, policy).approved).toBe(false);
expect(preflightCompose(approvedTestCompose, policy).approved).toBe(true);
expect(resourceInventoryAfter).toEqual(resourceInventoryBefore);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/security/compose-preflight.test.ts
pnpm typecheck
```

**完成条件：** 危险配置创建前拒绝；正常测试配置可得到可核对资源计划；原始秘密不外泄。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-058"></a>
### SG-058 · 实现自有 Compose 启动、动态端口和来源快照

**目标：** 每个run启动独立测试实例，从实际资源读取绑定而非猜端口。  
**依据与映射：** 原 SG-058  
**本计划前置：** SG-057, V2-R06。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 packages/adapter-compose/src/{compose-adapter,start,inspect,provenance}.ts、tests/integration/environment/compose-start.test.ts。

**输入输出与接口：** ComposeAdapter implements EnvironmentPort；使用现有Runner/受信docker能力，不自己spawn不受控shell；resources用native_id+creation identity+owner token标识。

**实施步骤：**

- [ ] **1.** 先测两个run并发不冲突、旧资源同名不能复用、启动失败可保留诊断；没有Docker只记未验证，不跳过后标支持。
- [ ] **2.** 生成安全唯一project/owner token，绑定本run与确认配置；只创建已预检resources，记录镜像ID、容器ID、network/volumeID和build输入。
- [ ] **3.** 从实际inspect/port映射读取host port，校验127.0.0.1与授权容器端口，生成API/web origin；不修改profile/hash去临时扩大允许目标。
- [ ] **4.** prepare建立来源snapshot，OBSERVED需要独立构建/启动证据；本地Compose不自动等于CONTROLLED。datarevision必须在createRun前已确认。
- [ ] **5.** 启动期间失败的资源进入台账，cleanup负责逐一处理；禁全局down/prune。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(runA.bindings.api.host_port).not.toBe(runB.bindings.api.host_port);
expect(runA.resources.every(r => r.run_id === runA.run_id)).toBe(true);
expect(runA.bindings.api.container_id).toBe(actualInspect.container_id);
expect(unknownImageClaim.satisfied).toBe(false);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/environment/compose-start.test.ts
pnpm typecheck
```

**完成条件：** 真实Docker启动与端口/identity记录一致；并发隔离与失败资源可归属；不冒充CI级控制。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-059"></a>
### SG-059 · 实现 readiness 与运行中环境连续性

**目标：** 区分服务启动、健康、实例正确及候选输入已准备好。  
**依据与映射：** 原 SG-059  
**本计划前置：** SG-056, SG-058。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 packages/adapter-compose/src/{readiness,origin-identity}.ts、tests/integration/environment/readiness.test.ts。

**输入输出与接口：** waitForEnvironment(requirements, observer, signal):Promise<EnvironmentReadiness>；EnvironmentReadiness含status READY/BLOCKED/ERROR、observations、diagnostics；observer受相同HTTP政策约束。

**实施步骤：**

- [ ] **1.** 真实两个服务A/B：同health内容但instance不同；中途重启、端口被替换、数据revision变化都做反例。
- [ ] **2.** 每次观察不超过2000ms，总计60000ms，轮询间隔≤500ms；使用单调时间、AbortSignal，不能重试重置总期限。
- [ ] **3.** 只有目标identity/input/origin/datarevision匹配才READY；故障环境导致下游BLOCKED而不是把业务断言算FAIL。
- [ ] **4.** 每次观察单独写artifact；前后发生变化保留差异，不覆盖只剩最终好状态。
- [ ] **5.** finalization在业务结束、cleanup前获取最后观测；环境替换不能复用旧body/request证据。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(sameHealthDifferentInstance.status).not.toBe('READY');
expect(restartedDuringRun.reasons).toContain('ENV_INSTANCE_CHANGED_DURING_RUN');
expect(canceled.newObservationsAfterCancel).toBe(0);
expect(blocked.downstreamExecuted).toBe(false);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/environment/readiness.test.ts tests/integration/environment/attach.test.ts
```

**完成条件：** 旧服务/中途换实例/超时均可拒绝；readiness不是仅HTTP200。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-060"></a>
### SG-060 · 关联浏览器、Probe 和独立后端观察

**目标：** 证明本次页面确实调用了预期后端，而不是只获得前端Mock响应。  
**依据与映射：** 原 SG-060  
**本计划前置：** SG-053, SG-055, SG-059, V2-R06。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 packages/adapter-playwright/src/{network-observer,real-chain,assertion-observer}.ts、presets/fastapi-react/playwright/stackgate.fixture.ts、tests/integration/browser/real-chain.test.ts。

**输入输出与接口：** verifyRealChain({required_operations, required_test_ids, browser_report, expected_requests, backend_facts}):RealChainAssessment；返回满足/缺口/证据引用，不直接返回Gate ALLOW。expected_requests由本run创建并绑定test/attempt。

**实施步骤：**

- [ ] **1.** 使用真实浏览器的page/request响应观察，添加run/check/attempt/request相关标识；禁止目标API的route fulfill/mock，其他第三方替身必须显式标边界。
- [ ] **2.** 对实际响应原始body校验schema、声明式业务断言与摘要；按完整identity关联后端观察，不能只匹配URL或一个request_id。
- [ ] **3.** 保留UI业务断言是否执行的证据；只有截图、页面load、请求200不足以完成。console/pageerror与请求异常也要进入结果。
- [ ] **4.** 拦截Mock、service worker缓存、旧响应重放、正确body但错误instance、同request不同attempt分别产生拒绝。是否完全支持service worker在能力文档明确，默认测试模板禁用。
- [ ] **5.** 把V2-R06认证后的artifact refs传给环境评估；敏感原body不进入交接，公共摘要只给必要差异和引用。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(mockedFrontEnd.uiAssertionPassed).toBe(true);
expect(mockedFrontEnd.backendObservations).toHaveLength(0);
expect(mockedFrontEnd.chain.satisfied).toBe(false);
expect(realRequest.chain.satisfied).toBe(true);
expect(replayedOtherAttempt.chain.satisfied).toBe(false);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/browser/real-chain.test.ts tests/integration/environment/evidence-authentication.test.ts
```

**完成条件：** 真链路正例和Mock/重放负例均实际执行；不能通过自行创建成功JSON完成。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-061"></a>
### SG-061 · 清理本次 Compose 资源并固定测试数据边界

**目标：** 取消/失败后只清理可证实本次创建的资源，结果可供环境assessment重新认证。  
**依据与映射：** 原 SG-061  
**本计划前置：** SG-058, SG-059。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 packages/adapter-compose/src/{cleanup,resource-ledger,data-policy}.ts、tests/integration/cleanup/compose.test.ts；复用 core cleanup-service。

**输入输出与接口：** cleanupOwnedResources(resources,liveInspection,signal):Promise<CleanupResult>；环境清理记录使用已存在 EnvironmentCleanup，不覆盖prepare；每资源保留cleaned/preserved/failed/unknown与归属依据。

**实施步骤：**

- [ ] **1.** 测试附着用户服务、其他project容器、同名不同owner、PID/container替换；不允许按资源名称模糊匹配删除。
- [ ] **2.** 核对native ID、creation identity、owner token和run标签；只回收created_by_stackgate且live身份一致资源。无法核对保留并导致相关必需前提未完成。
- [ ] **3.** 清理使用独立有界AbortController，不直接复用已经取消的业务signal让finally完全不执行；超过预算保留详细账本并拒绝假完成。
- [ ] **4.** 数据库/volume仅限本次专用测试实例/确认数据命名空间；迁移命令需原授权，不用名称含test当安全凭据。
- [ ] **5.** 输出EnvironmentCleanup含全量预期资源的处置结果；和prepare集合做双向一致性检查，遗漏资源不允许总体CLEANED。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(unrelatedContainer.existsAfter).toBe(true);
expect(attachedService.aliveAfter).toBe(true);
expect(ownedCleanup.cleaned.map(r => r.native_id).sort()).toEqual(expectedOwnedIds.sort());
expect(missingOwnership.failed.length + missingOwnership.preserved.length).toBeGreaterThan(0);
expect(missingOwnership.assessment.satisfied).toBe(false);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/cleanup/compose.test.ts tests/integration/cleanup/process-resources.test.ts
```

**完成条件：** 真实资源创建/取消/清理有完整台账；用户资源保留；清理异常不是自动通过。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-062"></a>
### SG-062 · 将新增适配器接入同一 Plan / Run / Gate

**目标：** 把零散模块变成产品真实路径；同一计划执行和Gate重认证支持完全相同的检查。  
**依据与映射：** 原 SG-062；V2-F08  
**本计划前置：** SG-053, SG-056, SG-058, SG-059, SG-060, SG-061, V2-R07。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 修改 core/services/{adapter-registry,plan-service,run-service,run-evaluation,gate-service}.ts、apps/cli/src/commands/execution.ts；新增 core/services/adapters/{openapi-runtime-adapter,probe-runtime-adapter,environment-runtime-adapter}.ts、tests/integration/fullstack/workflow.test.ts。

**输入输出与接口：** 新增适配器实现现有 Adapter 的 describe/validate/plan/execute/collect；注册表提供reviewed工厂；Plan/Run/Gate注入同一registry依赖。Environment prepare与最终assessment按第2.6节分离；collectProbe增加认证facts而非自报satisfied。

**实施步骤：**

- [ ] **1.** 先写构建后CLI的缺能力/真实能力两种路径。新增registry工厂但browser/docker缺失应BLOCKED；不可因为supportedIds有名字就认为可运行。
- [ ] **2.** Plan用registry与能力探测替换硬编码M2限制；必检并集、确认policy、输入/声明/工具hash都保留；计算datarevision与固定环境要求后才createRun。
- [ ] **3.** Run用同一registry实例化每步；env prepare/readiness先行，candidate export可按实际依赖运行，Probe依赖契约，浏览器依赖必要环境/契约；最终收尾不回连前置造成环。
- [ ] **4.** OpenAPI适配器把已授权导出命令产生的本attempt candidate交给现有ContractService；baseline/target仍来自固定权威，禁止读旧工作区产物。
- [ ] **5.** Probe执行使用已确认declaration、动态授权origin、identity与输出目录；collector读取rawbytes、V2-R04重算、SG-060来源关联，满足时真实计数，而不是永远0或自行填预期。
- [ ] **6.** Playwright执行与collector从真实report/attachments生成CheckResult；environment result_kind沿已确认CheckStep协议处理，必要的协议变更先Schema/ADR，不在各层自行猜字段。
- [ ] **7.** finally保存finalization、cleanup、核心assessment；environment_ref引用最终assessment，data_revision不原地改，完成后seal。取消/部分失败仍保留已执行事实。
- [ ] **8.** Gate加载seal后按registry重收集每项，认证环境原始资料再调用assessEnvironment；不能读持久化satisfied直接转ALLOW。保留AUD-002首尾输入观察；不重启旧服务。
- [ ] **9.** 验证同一fixedrun的run/report/gate一致；readonly report不启动测试，零测试/缺报告/缺环境不变成绿色。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(plan.steps.map(s => s.adapter_id)).toEqual(expect.arrayContaining(['environment','openapi','stackgate-probe','playwright']));
expect(realRun.checks.every(c => c.run_id === realRun.run_id)).toBe(true);
expect(gateRecollection.checks).toEqual(realRun.checks);
expect(gateRecollection.evaluation.decision).toBe('ALLOW'); // 仅完整合法正例
expect(forgedPersistedAssessment.evaluation.decision).toBe('DENY');
expect(uninstalledBrowser.startedBusinessCommands).toBe(0);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm build
pnpm exec vitest run tests/integration/fullstack/workflow.test.ts tests/integration/gate/current-state.test.ts tests/integration/cli/m2.test.ts
pnpm verify:boundaries
pnpm typecheck
```

**完成条件：** 公开CLI产生真实同Run的全栈证据并独立Gate通过；伪assessment/缺能力拒绝；M2既有local流程不回归。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-063"></a>
### SG-063 · 防止 inventory、skip、expected-fail 和 flaky 假绿

**目标：** 要求固定验收集合确实执行；配置期望数与真实执行数不可混同。  
**依据与映射：** 原 SG-063  
**本计划前置：** SG-062, SG-053。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 packages/adapter-playwright/src/completeness.ts、tests/integration/browser/completeness.test.ts；更新collector与test-inventory-drift接线。

**输入输出与接口：** compareRequiredInventory(task:TaskPayload,plan:CheckPlan,report:PlaywrightReport):CompletenessAssessment；输出missing/duplicate/skipped/flaky/unauthorized-mutations和实际计数。

**实施步骤：**

- [ ] **1.** 真实Playwright删除/重命名必检ID、skip/only、测试未被选择、重试成功、expected-fail各做负例；只看exit0不能过。
- [ ] **2.** 记录discovered与executed，ID/attempt/project/retry分开，不用重复执行增加独立用例数；unknown或重复ID拒绝。
- [ ] **3.** 把保护输入漂移/确认revision接到required集合，不让测试自己修改预期策略后重新报告。
- [ ] **4.** collector保留尝试链与失败信息；Gate默认required flaky=INCOMPLETE，稳定业务断言FAIL仍保留。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(zeroTests.evaluation.exit_code).toBe(2);
expect(requiredSkipped.evaluation.decision).toBe('DENY');
expect(flakyAfterRetry.check.flaky_tests).toBe(1);
expect(flakyAfterRetry.evaluation.exit_code).toBe(2);
expect(duplicateIds.evaluation.decision).toBe('DENY');
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/browser/completeness.test.ts tests/contract/playwright-reporter.test.ts
```

**完成条件：** 用真实框架运行证明缺失/跳过/重试/expectedfail不假绿；必检集合未被放宽。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-064"></a>
### SG-064 · 建立“各自单测绿、真实联调失败”的演示负例

**目标：** 证明StackGate在正确环境和完整证据下发现真正的前后端不一致，而不是因环境缺失拒绝。  
**依据与映射：** 原 SG-064  
**本计划前置：** SG-062, SG-063。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/acceptance/T01-response-rename.test.ts、T02-mocks-pass.test.ts、examples/contract-drift-demo/scripts/run-broken.mjs；复用已有React旧字段与正确API。

**输入输出与接口：** runBrokenScenario(root):Promise<ScenarioOutcome>（测试工具，不属于产品）；Outcome含实际独立单测退出、plan/run/gate ID、环境来源、失败check和artifacts。

**实施步骤：**

- [ ] **1.** 在自有临时仓库安装锁定示例；baseline与confirmed target对齐当前目标，避免兼容性失败抢先掩盖消费者问题。
- [ ] **2.** 实际执行API与web自己的单测，确认二者通过；不得修改Mock来人为制造这一声明。
- [ ] **3.** 经构建后CLI确认/授权/plan/run/gate，真实启动环境；前端保持原旧字段读取，必检页面断言失败。
- [ ] **4.** 断言失败归因来自具体UI/响应字段证据，环境是已确认且完整的；不是UNSUPPORTED/MISSING_REPORT冒充产品发现。
- [ ] **5.** 保留失败report、request/observation关联、当前inputhash与复现命令。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(outcome.apiUnitExit).toBe(0);
expect(outcome.webUnitExit).toBe(0);
expect(outcome.environmentSatisfied).toBe(true);
expect(outcome.browserCheck.status).toBe('FAIL');
expect(outcome.gate).toMatchObject({verdict:'FAIL',decision:'DENY',exit_code:1});
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/acceptance/T01-response-rename.test.ts tests/acceptance/T02-mocks-pass.test.ts
```

**完成条件：** 负例是真的业务联调FAIL/1，且双方单测确实执行成功、环境身份已验证。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-065"></a>
### SG-065 · 合法修复后新 Run 成功与旧证据失效

**目标：** 演示失败→证据→限定修复→新运行通过，而非覆盖旧失败或改验收标准。  
**依据与映射：** 原 SG-065  
**本计划前置：** SG-064。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/integration/fullstack/fix-and-rerun.test.ts、examples/contract-drift-demo/scripts/run-fixed.mjs、docs/walkthrough.md；复用已存在fix patch时校验其范围。

**输入输出与接口：** applyReviewedFixturePatch(tempRoot,patchRef) 仅测试helper；应用前后保护契约/e2e字节不变；新plan/run关联previous_run_id。

**实施步骤：**

- [ ] **1.** 保存SG-064失败run的manifest/seal bytes；生成failure handoff，从当前具体文件读取证据。
- [ ] **2.** 仅在临时fixture应用客户端字段映射修复，必要应用单测随实现更新；权威contract与端到端断言不改。
- [ ] **3.** 创建新inputhash和新的plan/run，来源重新核验；旧run历史verdict仍FAIL，当前freshness可STALE。
- [ ] **4.** 新run所有required与环境满足后Gate ALLOW/0；缺任何证据则不得为演示设置pass。
- [ ] **5.** 确认report/handoff没有改变旧seal；重复执行演示能重建相同故障条件并清理资源。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(after.targetBytes).toEqual(before.targetBytes);
expect(after.acceptanceTestBytes).toEqual(before.acceptanceTestBytes);
expect(newRun.run_id).not.toBe(oldRun.run_id);
expect(newGate).toMatchObject({decision:'ALLOW',exit_code:0});
expect(oldGate.freshness).toBe('STALE');
expect(await readFile(oldSealPath)).toEqual(oldSealBytes);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/fullstack/fix-and-rerun.test.ts
```

**完成条件：** 完整新run可通过、旧facts不变；修复仅限允许路径；演示不扩大产品自动修复权限。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="aud-004"></a>
### AUD-004 · 补全 Linux/WSL 受控执行能力，不外推Windows结果

**目标：** 满足原平台目标的前提，或明确留下阻塞；不能仅用Node可运行宣称Runner已支持Linux。  
**依据与映射：** 沿用原 AUD-004；不是新造平台已完成声明  
**本计划前置：** V2-R07。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 保留 packages/runner-local/src/local-runner.ts Windows实现；新增 linux/{runner,cgroup,provenance}.ts、tests/compatibility/linux-runner.test.ts、docs/compatibility/linux.md。

**输入输出与接口：** LinuxRunner implements RunnerPort；选择有明确委派权限的cgroup v2私有子树进行归属与整个后代回收，能力探测不授予root权限。无可用隔离机制返回UNSUPPORTED_CAPABILITY；不悄悄退化为kill某个PID后宣称全部清理。

**实施步骤：**

- [ ] **1.** 先在实际Linux/WSL检测内核、cgroup挂载/委派、必要操作权限和Node工具；不能由模拟process.platform完成平台测试。
- [ ] **2.** 创建每run私有cgroup+token+creation身份，启动包装器在执行待测脚本前加入该资源域；禁止使用用户提供任意cgroup路径删除或kill。
- [ ] **3.** 超时/取消停止新步骤，回收该资源域内后代并验证空集合；detach/session变化仍不能逃逸支持范围；不能证明归属时记录UNKNOWN并拒绝完整成功。
- [ ] **4.** 最小环境、可执行摘要、stdout/stderr预算和退出事实复用原Runner合同；Windows行为保持。
- [ ] **5.** 真实启动无关进程和detached后代，验证只清理自有树；能力缺失记BLOCKED并给宿主准备条件，不安装系统服务或擅自提权。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(detachedDescendant.aliveAfterCancel).toBe(false);
expect(unrelatedProcess.aliveAfterCancel).toBe(true);
expect(result.provenance.cleanup).toBe('VERIFIED');
expect(noDelegation.result.status).toBe('ERROR');
expect(noDelegation.result.diagnostics.some(d=>d.code==='UNSUPPORTED_CAPABILITY')).toBe(true);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/compatibility/linux-runner.test.ts
pnpm exec vitest run tests/integration/runner/process.test.ts
```

**完成条件：** 真实Linux验证归属/取消；不具备委派时明确阻塞，不把Windows历史验证当替代。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-066"></a>
### SG-066 · 验证保护契约、测试和批准记录的漂移

**目标：** 证明修改标准不能替代修复实现；相同任务意图有独立确认revision。  
**依据与映射：** 原 SG-066  
**本计划前置：** SG-062, SG-063。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/acceptance/{T03-missing-tests,T04-target-tamper}.test.ts、tests/integration/policy/acceptance-mutation.test.ts；必要时修改现有protected-input-drift接线。

**输入输出与接口：** 复用TaskService、detectAcceptanceDrift与Plan.inspectStored；不增加force-pass或匿名批准字段。

**实施步骤：**

- [ ] **1.** 从同一合法确认fixture复制独立临时仓库，分别删除必检、改skip、降min_tests、改target、改allowlist、改批准范围。
- [ ] **2.** 只改一项后用旧plan/run调用真实CLI；必须失效或确定性拒绝，理由指明变更的保护输入，不自动重新确认。
- [ ] **3.** 创建新revision必须显式完整确认，新旧记录并存；破坏性变更批准只对精确操作/规则/基线/目标匹配生效。
- [ ] **4.** 用真实失败到改标准的反例验证不会通过；清理临时仓库而非用户业务目录。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(tamperedTarget.oldPlan.identity_valid).toBe(false);
expect(deletedRequired.gate.decision).toBe('DENY');
expect(widenedApproval.gate.decision).toBe('DENY');
expect(oldConfirmationBytesAfter).toEqual(oldConfirmationBytesBefore);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/acceptance/T03-missing-tests.test.ts tests/acceptance/T04-target-tamper.test.ts tests/integration/policy/acceptance-mutation.test.ts
```

**完成条件：** 保护输入有实测拒绝路径；没有为测试成功自动批准新标准。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-067"></a>
### SG-067 · 验证旧服务、伪来源与执行中换实例

**目标：** 确保环境来源链抵抗常见误接与陈旧证据，不只验证文档结构。  
**依据与映射：** 原 SG-067  
**本计划前置：** SG-062, SG-059, SG-060。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/acceptance/{T10-unverified-environment,T11-old-service,T17-env-blocked}.test.ts、tests/integration/environment/switch-during-run.test.ts。

**输入输出与接口：** 复用真实双实例fixture和EnvironmentPort观察；检查prepare/业务请求/finalization引用的同一个instance。

**实施步骤：**

- [ ] **1.** 启动不同输入A/B的两个真实服务，让B工作区请求A；二者health与body可相同，不能仅内容相同认定来源一致。
- [ ] **2.** 复制伪provenance文件、使用正确sha但无启动证据、发回客户端自报instance，分别验证严格拒绝。
- [ ] **3.** 业务执行中替换后端实例或origin，finalization必须捕获；不能只保留最后一次好观察。
- [ ] **4.** 检查端口冲突/未启动下游BLOCKED，用户原服务不被终止。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(oldService.gate.decision).toBe('DENY');
expect(forgedProvenance.gate.decision).toBe('DENY');
expect(switched.gate.reasons).toContain('ENV_INSTANCE_CHANGED_DURING_RUN');
expect(portConflict.unrelatedServiceAlive).toBe(true);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/acceptance/T10-unverified-environment.test.ts tests/acceptance/T11-old-service.test.ts tests/acceptance/T17-env-blocked.test.ts tests/integration/environment/switch-during-run.test.ts
```

**完成条件：** 拒绝依据为实际来源不成立，且两个实例都是真实启动，不只修改JSON。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-068"></a>
### SG-068 · 验证未知 Schema 和动态消费者的保守回退

**目标：** 新运行器接入后仍不把静态分析未知当无影响；有限支持边界继续生效。  
**依据与映射：** 原 SG-068  
**本计划前置：** SG-062。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/acceptance/{T05-type-mismatch,T06-required-null,T07-unsupported-schema,T08-fallback-regression,T09-missing-regression}.test.ts。

**输入输出与接口：** 复用loadContract/validatePayload/selectionPolicyFor/selectChecks；不会建立一个忽略不支持特性的浏览器旁路。

**实施步骤：**

- [ ] **1.** 真实响应number返回string、required缺失/null与目标schema分别验证FAIL，不使用parseFloat或模型解释修正输入。
- [ ] **2.** 参与验收的不支持组合/format/引用返回明确位置与INCOMPLETE；不能让其他绿测试覆盖该缺口。
- [ ] **3.** 动态URL/跨语言消费者有回归集时实际调度该工作区检查，并保留analysis gap；缺回归集则DENY/2。
- [ ] **4.** 同时有多个工作区未知时不得只选其中一方；显式required不因缓存/静态图而删除。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(actualNumberString.gate.decision).toBe('DENY');
expect(unsupported.gate.verdict).toBe('INCOMPLETE');
expect(withRegression.executedCheckIds).toEqual(expect.arrayContaining(requiredRegressionIds));
expect(withoutRegression.gate.exit_code).toBe(2);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/acceptance/T05-type-mismatch.test.ts tests/acceptance/T06-required-null.test.ts tests/acceptance/T07-unsupported-schema.test.ts tests/acceptance/T08-fallback-regression.test.ts tests/acceptance/T09-missing-regression.test.ts
```

**完成条件：** 回退实际执行，不是selection数组中出现名字；不支持能力仍阻塞完整通过。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-069"></a>
### SG-069 · 验证真实浏览器与后端证据的隐私、预算

**目标：** 阻止敏感原值进入常规报告和交接，超过预算不丢掉关键失败后伪装完整。  
**依据与映射：** 原 SG-069  
**本计划前置：** SG-062, SG-053, SG-055。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/acceptance/T21-secret-redaction.test.ts、tests/security/browser-artifacts.test.ts、docs/security/artifact-handling.md；修改report/handoff投影选择。

**输入输出与接口：** 复用BudgetedArtifactWriter与redaction；publicEvidenceProjection只接受可公开artifact等级，不把原始body/trace自动变regular。

**实施步骤：**

- [ ] **1.** 使用合成Authorization/Cookie/token加入真实错误栈、HTTP响应、console和截图场景；所有常规渲染器与handoff搜索canary。
- [ ] **2.** trace/video/screenshot默认restricted，无法可靠脱敏不导出；ZIP类型trace不可只按MIME判普通文件。
- [ ] **3.** 注入超大日志、超大请求附件、坏链接、丢失文件，验证read/write均有界；关键证据未保留则INCOMPLETE/ERROR。
- [ ] **4.** 保留original/retained/truncated及原因，不把截断内容当完整schema/assertion证据；外部导出只用户明确选择，默认本地。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
for (const text of [terminal,json,markdown,junit,handoff]) expect(text).not.toContain(canary);
expect(traceArtifact.sensitivity).toBe('restricted');
expect(publicExport.artifact_ids).not.toContain(traceArtifact.artifact_id);
expect(missingCriticalBody.gate.decision).toBe('DENY');
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/acceptance/T21-secret-redaction.test.ts tests/security/browser-artifacts.test.ts
```

**完成条件：** 真实产物的常规视图无合成秘密；restricted边界/预算在执行和读取两侧生效。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-070"></a>
### SG-070 · 完成 Windows 原生全栈、路径和取消验证

**目标：** 新浏览器/环境接线在目标Windows实际运行，不能只沿用M2进程测试。  
**依据与映射：** 原 SG-070  
**本计划前置：** SG-062, SG-061。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/compatibility/windows/{argv,encoding,process-tree,file-lock}.test.ts、docs/compatibility/windows.md。

**输入输出与接口：** 继承原Windows Job Object、真实creationidentity和最小env；声明某版本Windows+Node+DockerDesktop组合的实际结果。

**实施步骤：**

- [ ] **1.** 在中文/空格路径、CRLF、不同盘符自有fixture执行public CLI全栈流程；参数含&;引号不当shell。
- [ ] **2.** 测试取消时浏览器后代、API/compose资源与占用日志文件；保留已形成证据，清理未成功则返回实际原因。
- [ ] **3.** 无关服务/容器/进程必须保持；进程身份复用不能误杀。
- [ ] **4.** 权限不足的symlink/文件锁能力单独标未验证，不以junction等价声称所有文件链接通过。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(unicodePath.fullstackRun.evaluation.decision).toBe('ALLOW');
expect(canceledRun.newStepsAfterCancel).toBe(0);
expect(canceledRun.unrelatedProcessAlive).toBe(true);
expect(lockedFile.cleanupErrorRecorded).toBe(true);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/compatibility/windows
pnpm exec vitest run tests/integration/runner/process.test.ts
```

**完成条件：** 实际Windows组合验证通过，其他平台不冒充；取消/占用有明确证据。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-071"></a>
### SG-071 · 完成 Linux/WSL、worktree 与候选基线验收

**目标：** 输入身份和资源状态跨平台/分支不被错误复用。  
**依据与映射：** 原 SG-071  
**本计划前置：** SG-062, AUD-004。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/compatibility/wsl-platform.test.ts、tests/acceptance/{T12-untracked-change,T13-during-run-change,T14-target-advance,T25-merged-candidate}.test.ts。

**输入输出与接口：** 保持repo/worktree/platform/input身份；旧run仅历史参考；目标分支推进按固定基线政策触发重新计划。

**实施步骤：**

- [ ] **1.** 在实际Linux/WSL运行AUD004提供的runner，Windows含绝对路径的授权不能复用。
- [ ] **2.** 真实linked worktree与未跟踪源码变化后检查STALE/4；运行期间变化保留前后身份。
- [ ] **3.** 推进目标分支、生成实际整合候选，验证不能把两个分支各自通过拼成合并候选通过。
- [ ] **4.** 子模块/LFS对象缺失/浅克隆基线不可用按已支持边界拒绝，不自动fetch后隐瞒基线变化。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(changedUntracked.gate.exit_code).toBe(4);
expect(otherPlatform.trustAccepted).toBe(false);
expect(mergedCandidate.input_hash).not.toBe(branchOnly.input_hash);
expect(missingBase.gate.decision).toBe('DENY');
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/compatibility/wsl-platform.test.ts tests/acceptance/T12-untracked-change.test.ts tests/acceptance/T13-during-run-change.test.ts tests/acceptance/T14-target-advance.test.ts tests/acceptance/T25-merged-candidate.test.ts
```

**完成条件：** 平台与Git边界实际测试；缺Linux权限不能改成自动skip并标SG071完成。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-072"></a>
### SG-072 · 完成网络、引用、参数与清理安全反例

**目标：** 验证插件自身受控操作边界，覆盖新增HTTP和环境连接，不止检查安全文案。  
**依据与映射：** 原 SG-072  
**本计划前置：** SG-061, SG-069, V2-R03。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/acceptance/{T18-cancel-owned,T19-attach-preserved,T20-external-ref}.test.ts、tests/security/{argv-injection,origin-redirect,path-traversal}.test.ts；复用deadline-proxy测试。

**输入输出与接口：** 安全测试仅在自有回环服务/临时目录/隔离容器中执行；计数和文件/进程清单作为事实，错误消息不是唯一证据。

**实施步骤：**

- [ ] **1.** 外部OpenAPI URL/文件引用、编码路径越界、链接替换在读取前拒绝，并证明目标服务访问计数为0。
- [ ] **2.** 命令argv特殊字符不得执行额外shell命令；验证拒绝路径不会写到非自有目录。
- [ ] **3.** 重跑隐式代理/慢速读取/片段路径的真实网络反例，覆盖当前生产入口而不是只调用孤立函数。
- [ ] **4.** 取消后清理只影响owned resources，attach用户服务保留；不能确认的资源留存并告警。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(externalRef.listenerHits).toBe(0);
expect(argvInjection.sideEffectFileExists).toBe(false);
expect(unapprovedProxy.hits).toBe(0);
expect(attachAfterClean.userServiceAlive).toBe(true);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/acceptance/T18-cancel-owned.test.ts tests/acceptance/T19-attach-preserved.test.ts tests/acceptance/T20-external-ref.test.ts tests/security tests/integration/probe/deadline-proxy.test.ts
```

**完成条件：** 拒绝分支没有真实未授权访问/写入/误删；测试不涉及用户生产资源。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-073"></a>
### SG-073 · 建立 T01—T27 注册与验收执行器

**目标：** 把原始规格的P0验收逐项绑定真实测试，杜绝缺项或skip假通过。  
**依据与映射：** 原 SG-073  
**本计划前置：** SG-064, SG-065, SG-066, SG-067, SG-068, SG-069, SG-070, SG-071, SG-072。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/acceptance/registry.json、scripts/run-acceptance.mjs、tests/acceptance/{T15-missing-report,T16-flaky,T23-handoff-stale,T24-report-exit,T26-existing-failure,T27-policy-relaxation}.test.ts；修改 package.json.test:acceptance。

**输入输出与接口：** registry条目{id,title,test_files,required_platforms,required_capabilities,expected_behavior}；执行结果必须记录testdiscovered/executed/skipped、环境、退出码、源码摘要与证据。

**实施步骤：**

- [ ] **1.** 从原规格完整取T01—T27，不能用本次19条局部反例替代；一个ID可以关联多个平台测试，但每个要求需明确实际证明范围。
- [ ] **2.** 补剩余缺报告、flaky、交接旧任务、report0但gate1、基线已有失败和可信策略放宽测试；每个ID有可执行路径，不只写README。
- [ ] **3.** T27在M3验证核心可信策略合并/候选放宽拒绝；真实GitLab权限/外部策略装载的产品验收仍属于SG084/085，不能提前声明已具备。T25必须在实际整合候选运行。
- [ ] **4.** 实现按ID选择与全量入口；缺测试文件、发现0、平台必需未跑、全部skip、未支持工具均nonzero。保留工具错误与业务失败区别。
- [ ] **5.** 原package脚本由unimplemented改为实际runner仅在以上存在后；留T28为后续Hooks，不加进P0冒充范围扩大。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(new Set(registry.map(x => x.id)).size).toBe(27);
expect(registry.map(x=>x.id)).toEqual(Array.from({length:27},(_,i)=>'T'+String(i+1).padStart(2,'0')));
expect(runWithMissingTest.exit_code).not.toBe(0);
expect(allSkipped.exit_code).not.toBe(0);
expect(reportExitCase).toMatchObject({report:0,gate:1});
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm test:acceptance
pnpm verify:tasks
pnpm verify:source
```

**完成条件：** 27项均有真实测试与覆盖范围；必需未验证不能全量通过；不把M3核心测试写成M4宿主/CI已交付。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-074"></a>
### SG-074 · 整理至少12个可复现故障场景

**目标：** 将演示和回归所需故障固定为可重建资产，避免手工改仓库。  
**依据与映射：** 原 SG-074  
**本计划前置：** SG-073。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/fixtures/scenarios/catalog.json、scripts/materialize-scenario.mjs、docs/fixtures/CATALOG.md、tests/integration/fixtures/catalog.test.ts。

**输入输出与接口：** catalog包括id、baseline/input来源、patches、seed、requiredcapabilities、expected_exit/reasons、cleanup；只在工具创建的临时root施加patch。

**实施步骤：**

- [ ] **1.** 至少包含旧字段、string替number、null、缺用例、改target、旧服务、Mock、缺报告、flaky、动态影响无回归、未跟踪变更、取消自有资源12类。
- [ ] **2.** 每个场景保存明确预期原因而非仅“不是0”；要求正常对照能够通过，证明不是环境坏导致所有情况都失败。
- [ ] **3.** 物化脚本检查目标为空且自有，初始化真实Git并记录基线；拒绝在用户业务root自动打补丁。
- [ ] **4.** 两次独立物化都能复现同一语义，ID/端口可不同；清理必须回收各自资源。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(catalog.length).toBeGreaterThanOrEqual(12);
expect(firstFailure.reason).toBe(expected.reason);
expect(secondFailure.reason).toBe(expected.reason);
expect(cleanControl.gate.exit_code).toBe(0);
expect(userRepositoryChanged).toBe(false);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm exec vitest run tests/integration/fixtures/catalog.test.ts
```

**完成条件：** 不少于12类真实场景可重复构建；每类有对照和明确失败证据。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-075"></a>
### SG-075 · 测量性能与框架开销，不制造节省比例

**目标：** 给出扫描/计划/报告/执行的真实分项成本，处理当前测试很慢的维护问题。  
**依据与映射：** 原 SG-075  
**本计划前置：** SG-074。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 scripts/benchmark.mjs、tests/fixtures/benchmark/generator.mjs、schemas/0.1/benchmark.schema.json、docs/benchmarks/method.md；修改package.bench。

**输入输出与接口：** benchmark记录机器/平台/版本/inputscope、cold/warm、原始各轮样本和分位算法，阶段分开scan/plan/report/execute/environment/cleanup。

**实施步骤：**

- [ ] **1.** 生成规格建议2000文件、≤20MB输入与≤2MB OpenAPI；记录实际量，不以空目录测“快”。
- [ ] **2.** 分别测纯解析、全量输入哈希、工具调用和真实环境；warm只允许静态缓存，不能复用集成PASS。
- [ ] **3.** 至少保存足以看出波动的重复样本，声明样本数和机器条件；不要单次测量宣称p95。
- [ ] **4.** 以数据定位重复身份捕获/重复测试成本；优化不能删除Gate新鲜度检查。若未达到规格建议目标，如实记未达，不调整基准隐藏。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(result.samples.length).toBeGreaterThanOrEqual(20);
expect(result.input.files).toBe(2000);
expect(result.cache.integration_pass_reused).toBe(false);
expect(result.sections).toEqual(expect.arrayContaining(['scan','plan','report']));
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm bench
pnpm verify:schemas
pnpm typecheck
```

**完成条件：** 原始样本可重算，开销与项目本身耗时分开；无虚构速度或token节省。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-076"></a>
### SG-076 · 形成平台和工具组合的真实兼容矩阵

**目标：** 每项支持声明都能追溯到相同版本/平台的实际运行。  
**依据与映射：** 原 SG-076  
**本计划前置：** SG-073, SG-075, SG-070, SG-071。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/compatibility/matrix.json、scripts/verify-compatibility.mjs；更新 docs/COMPATIBILITY.md 与 tools/compatibility-lock.json。

**输入输出与接口：** 矩阵status PASS/FAIL/BLOCKED/NOT_RUN，区分工厂安装、工具存在、协议测试、真实链路执行；字段包含exact versions与新验证证据。

**实施步骤：**

- [ ] **1.** 列Windows原生、WSL/Linux、候选CI组合和各自Node/Python/Playwright/browser/Docker/oasdiff版本。
- [ ] **2.** 运行记录与平台实际相符；缺浏览器/容器权限不能借用他机PASS。macOS未测保留NOT_RUN，不自动加入支持列表。
- [ ] **3.** 明确根Vitest4与webVitest5各自验证入口；Reporter使用实际锁定Playwright类型，不能用自造接口测试证明适配。
- [ ] **4.** 验证器拒绝PASS无证据、未来版本/平台串用、只有version输出就宣称全栈支持。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(validateMatrix(passWithoutEvidence).length).toBeGreaterThan(0);
expect(validateMatrix(windowsEvidenceUsedForLinux).length).toBeGreaterThan(0);
expect(matrix.find(x=>x.platform==='darwin')?.status).not.toBe('PASS');
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
node scripts/verify-compatibility.mjs
pnpm verify:tasks
```

**完成条件：** 支持声明与实际平台证据一致；未运行不标支持。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="sg-077"></a>
### SG-077 · 完成真实 M3 阶段出口

**目标：** 使M3完成成为可复跑的工程结果，而不是提交标题或任务计数。  
**依据与映射：** 原 SG-077  
**本计划前置：** SG-062, SG-063, SG-064, SG-065, SG-066, SG-067, SG-068, SG-069, SG-070, SG-071, SG-072, SG-073, SG-074, SG-075, SG-076。原SG任务的其余前置继续遵循原任务账本。

**文件与职责：** 新增 tests/fixtures/stages/M3.json、tests/integration/stages/m3.test.ts、docs/implementation/evidence/M3-summary.md；修改scripts/verify-stage.mjs 与其bootstrap测试。

**输入输出与接口：** M3 manifest须固定必检组/工具/前置任务；stageRuntime从实际观测导出。当前未实现M3返回2的行为直到真正完成前保留；不能只扩enum使它通过。

**实施步骤：**

- [ ] **1.** 注册M3组覆盖schema/build/typecheck、单测、真实协议、全栈负例/修复、环境安全、平台矩阵、T01—T27；沿用M2检查不可删除。
- [ ] **2.** 检查SG051—076与本次修复前置状态；SG077不能要求自己先DONE形成循环，但所有先决实际证据必须齐全。
- [ ] **3.** 构建后的CLI从干净隔离fixture执行两个独立单测绿→联调FAIL/1→限定修复→新runALLOW/0→旧runSTALE/4，保存全部runids/证据。
- [ ] **4.** 对stage参数/manifest错配、漏mandatory组、工具UNKNOWN、0tests/skip、源码漂移、返回码被吞等做bootstrap反例。
- [ ] **5.** 发布矩阵不具备的平台仍明确BLOCKED；可以报告某平台M3局部通过，但不能将完整SG077标DONE并推进M4绕过未完成要求。
- [ ] **6.** 执行完整M3 stage，记录独立测试数与重复组数、实际源码身份、耗时、未验证范围；结束后给出M4入口SG078但不自动发布。

**关键断言片段：** 下列是该任务测试文件应包含的断言，不是独立产品实现；测试中的命令结果、临时目录和变量必须由该文件真实建立的fixture提供，不能用常量伪造实测。

```typescript
expect(mismatchedStage.exit_code).not.toBe(0);
expect(missingBrowserEvidence.exit_code).not.toBe(0);
expect(fullRun.brokenGate.exit_code).toBe(1);
expect(fullRun.fixedGate.exit_code).toBe(0);
expect(fullRun.oldGate.exit_code).toBe(4);
expect(fullRun.protectedBytesChanged).toBe(false);
```

**验证命令：** 新增文件完成后执行；命令不是当前已经通过的记录。

```bash
pnpm verify:source
pnpm verify:schemas
pnpm verify:boundaries
pnpm verify:tasks
node scripts/verify-v2-audit.mjs
pnpm verify:stage -- --stage M3
```

**完成条件：** 真实阶段组全部成立；结果可归属当前源码；没有缺项/skip/静态替代动态；最后才关闭SG077。

- [ ] 保存本任务的真实RED/GREEN或已有正确实现回归证据；更新对应ledger、PROGRESS、BLOCKERS与下一项。没有执行的检查保持未验证。

---

<a id="acceptance-matrix"></a>
## 6. 联合验收矩阵

这些用例是本次增补，不代替原T01—T27。每项都必须能找到具体测试路径、实际执行与源码身份。

| ID | 验收条件 | 必须观察到的行为 | 所属 |
|---|---|---|---|
| V01 | Reporter导入不存在的符号 | 修复前独立错误，修复后真实ESM可加载 | V2-R01 |
| V02 | typecheck扫描packages | 不能通过exclude跳过新增文件 | V2-R01 |
| V03 | 同attempt报告已存在 | 原bytes不变，第二次拒绝 | V2-R01 |
| V04 | 两个Reporter同时提交 | 至多一份最终产物，无覆盖 | V2-R01 |
| V05 | path与声明不一致 | 零网络请求拒绝 | V2-R02 |
| V06 | 缺失声明 | 不执行业务Probe | V2-R02 |
| V07 | fragment/query/路径歧义 | 不以变换后的路径冒充原操作 | V2-R02 |
| V08 | 隐式http/https/system代理 | 代理命中0，无凭证继承 | V2-R03 |
| V09 | 慢速header | 总deadline触发 | V2-R03 |
| V10 | 连续少量body | 不能因有数据无限延期 | V2-R03 |
| V11 | 错误状态body超限 | 同样有界，无成功产物 | V2-R03 |
| V12 | worker取消 | 自有worker回收、无后续写入 | V2-R03 |
| V13 | 空JSON的constructor/__proto__ | exists=false | V2-R04 |
| V14 | JSON自有同名字段 | 正常读取，不粗暴禁关键词 | V2-R04 |
| V15 | 溢出非有限number | 明确拒绝 | V2-R04 |
| V16 | 空键/转义/数组01 | 按同一Pointer合同处理 | V2-R04 |
| V17 | TS/Python共同断言 | 结果与拒绝语义一致 | V2-R04 |
| V18 | prepare BLOCKED/ERROR/UNKNOWN | satisfied=false | V2-R05 |
| V19 | 最低来源不足 | 不满足，即使其他测试全绿 | V2-R05 |
| V20 | 无环境但要求后端观察 | 不能快捷成功 | V2-R05 |
| V21 | cleanup遗漏/FAILED/PARTIAL | 拒绝完整通过 | V2-R05 |
| V22 | request_id != artifact_id | 真实refs仍能独立回读并正向认证 | V2-R06 |
| V23 | request来自另一attempt/run | scope拒绝 | V2-R06 |
| V24 | body摘要或字节改变 | 证据错误，不采信passed | V2-R06 |
| V25 | 前次数据重放 | 当前来源不能成立 | V2-R06、SG-060 |
| V26 | Playwright retry=1 | 保存为1并保留0次失败 | SG-053 |
| V27 | Bearer含空格/缓冲边界 | canary不进入公共文本 | SG-053 |
| V28 | trace ZIP | restricted且默认不导出 | SG-053、069 |
| V29 | body形式附件 | 实际写入且摘要可回读 | SG-053 |
| V30 | 缺ID/重复ID/only/skip | 不产生完整通过 | SG-053、063 |
| V31 | 中间件重复request | 不覆盖先前记录 | SG-055 |
| V32 | 中间件响应中途异常 | 不认证部分body完整 | SG-055 |
| V33 | attach健康但无来源 | DECLARED/拒绝严格验收 | SG-056 |
| V34 | Compose危险挂载 | 启动前拒绝 | SG-057 |
| V35 | 两run动态端口 | 真实资源隔离且绑定一致 | SG-058 |
| V36 | 中途替换instance | finalization记录变化并拒绝 | SG-059、067 |
| V37 | 浏览器Mock返回正确值 | 无后端观察仍拒绝 | SG-060 |
| V38 | 用户原有服务 | clean后仍在 | SG-061 |
| V39 | 工厂存在但浏览器缺失 | 能力阻塞而非PASS | SG-062 |
| V40 | 持久化satisfied篡改 | Gate独立认证拒绝 | SG-062 |
| V41 | environment cleanup完成 | 不覆盖prepare READY，不靠重启验旧Run | SG-062 |
| V42 | 同一任务两端单测成功 | 真实旧消费者仍FAIL/1 | SG-064 |
| V43 | 合法修复 | 新Run通过且旧Seal不变 | SG-065 |
| V44 | 改目标/降min_tests | 旧计划失效/拒绝 | SG-066 |
| V45 | 未知影响有/无回归集 | 实际回归/INCOMPLETE | SG-068 |
| V46 | Linux权限不足 | BLOCKED，不用Windows结果背书 | AUD-004、071 |
| V47 | report exit0、verdictFAIL | gate仍1 | SG-073 |
| V48 | stage缺组/零测试/未运行平台 | 不允许M3全量完成 | SG-077 |

<a id="stage-exit"></a>
## 7. 批次出口、停机条件与并行边界

### 7.1 推荐执行批次

| 批次 | 工作 | 进入后续批次的条件 |
|---|---|---|
| B0 | V2-R00、R01 | 当前基线明确；Reporter/根工程重新可构建 |
| B1 | V2-R02—R06 | HTTP/断言/环境认证反例真实修复 |
| B2 | V2-R07、SG-053、SG-055 | 修复回归，真实Reporter与后端观察可用 |
| B3 | SG-056—061 | 环境、链路与清理实际成立 |
| B4 | SG-062—065 | 公开CLI真实负例和修复重验通过 |
| B5 | AUD-004、SG-066—072 | 平台、漂移、隐私与安全反例完成 |
| B6 | SG-073—077 | 验收注册、场景、基准、矩阵与M3出口 |

AUD-004可在B1/B2接口固定后并行，但Windows分支流程不等它才开始；最终平台要求没有完成时不得把整个M3标DONE。SG-053与SG-055可并行，环境协议/Run/Gate/Evidence共享文件需要一位负责人协调。不要让多个Agent同时改相同Schema和生成类型。并行任务合并后必须整合回归。

### 7.2 必须停止当前依赖链的情况

出现源文件摘要与固定基线不符、目标contract或验收条件未获确认、缺少真实浏览器/Docker/平台权限、未知证据类型、资源归属无法确认或外部网络需要升级授权时，记录原因并停止对应链路。仍可执行不依赖该能力的单测、文档和已授权本地开发。不得要求模型“自行想办法”绕过权限或无限重试。

### 7.3 最终 Definition of Done

- [ ] 八个V2修复任务均有可归属当前源码的真实验证。
- [ ] SG-053运行真实锁定版本Playwright；不是只测手写回调对象。
- [ ] HTTP声明/实际wire/代理/绝对期限一致，失败路径有界。
- [ ] 环境状态、最低来源、字节与artifact引用、资源集合均在核心重算。
- [ ] 新适配器在Plan、Run、Gate使用同一注册/认证合同，且实际工具能力独立检查。
- [ ] 环境prepare→业务→finalization→cleanup→assessment无环，不覆盖旧事实。
- [ ] 公开CLI可重现单测绿但联调FAIL与合法修复后新Run通过；原contract/e2e未被放宽。
- [ ] Gate保留当前代码新鲜度核验，能够重收集而不重新运行历史业务服务。
- [ ] T01—T27、至少12故障、平台矩阵和实测基准有可复现记录；未测项明确列出。
- [ ] `pnpm verify:stage -- --stage M3` 实际执行已注册必检，不能以空stage/skip通过。
- [ ] PROGRESS、账本和支持声明一致；没有将M4宿主安装/CI发布能力提前写成完成。

### 7.4 M4 只作为下一阶段入口

M3实际完成后才进入原SG-078构建发行包，随后预设、Codex Skill、Claude插件、安装升级、GitLab可信门槛和发布回归。当前不要制作Web管理台、多Agent调度、Hooks、MCP或公开包来绕开核心未完成工作。已有Reporter构建入口属于测试可用性，不等于正式发行包。

<a id="codex-start"></a>
## 8. 可直接发送给 Codex 的启动提示词

```text
请执行 docs/plans/StackGate_V2_Execution_Plan_v0.4.md。
配套审计是 StackGate_V2_Audit_2791cf5.md。

本次目标分支是 V2，不是 main。
审计基线是 2791cf5f221d6f917101079332f4231c6a450fa7。

先读取 AGENTS.md、docs/implementation/PROGRESS.md、
docs/implementation/tasks.json、audit-m3-fixes.json 和 Git 状态。
若本地HEAD领先，先检查相关差异，复用已完成的正确修复，不回滚用户改动。

本轮先执行 V2-R00 和 V2-R01，保存真实基线、恢复Reporter命名导出与不可覆盖写入、
运行根typecheck/build及构建后的Reporter加载测试。
随后按依赖推进 V2-R02—R07，再收口 SG-053 和 SG-055—077。
不要重做已有 SG-052/054、AUD-001/002/003；本次缺陷以补充任务和回归证据关闭。

复用当前 RunnerPort、EvidenceStore、EnvironmentPort、PlanService、RunService、
GateService、adapter-registry 与 CLI execution.ts。不要另起第二套演示执行器。
不能只删除M2的限制或填写环境已通过；必须有实际请求、观察、清理与Gate重收集。

每项先建立反例，再最小实现，实际跑目标测试与受影响回归。
记录命令、退出码、前后源码摘要、证据文件、未验证项与下一任务。
根Vitest和web子项目版本分开验证；Browser/Docker/Linux未具备不算通过。

不修改原始设计和原100任务身份，不放宽必检、不吞退出码、不覆盖旧Run。
不远程push、不发PR、不公开发布、不生产部署、不未经许可调用付费模型。
完成本轮后给出真实改动、实际验证和当前阻塞，不重新输出泛化产品规划。
```

## 9. 续接提示词与每轮交付格式

```text
继续 StackGate V2 的 v0.4 执行计划。
先检查当前HEAD、未提交差异、PROGRESS和对应任务账本。
只继续第一个未完成且依赖满足的任务；已有正确实现先回归，不重复搭建。
优先读取本任务文件和必要接口，证据按需展开，不全文扫描历史日志。
完成后更新真实验证、源码归属、未验证项和下一步。
```

每轮给出：本轮任务ID和状态；修改的实际文件；运行命令及真实结果；剩余功能/环境阻塞；下一任务。没有实际验证只能记IMPLEMENTED_UNVERIFIED。用户取消不等于授权自动继续。

<a id="references"></a>
## 10. 证据、外部技术依据与维护约定

本计划的当前事实来自固定V2源码，详细引用见配套审计报告。它没有宣称当前完整仓库已通过本次构建。局部复现用六份blob一致源码与本机loopback，不访问用户凭证或生产资源。

- Playwright真实字段与Reporter类型：`https://playwright.dev/docs/api/class-testresult`、`https://playwright.dev/docs/api/class-reporter`。`retry`不是`retries`；执行时以锁定版本的类型和合同测试共同核对。
- Python urllib代理与阻塞超时：`https://docs.python.org/3.13/library/urllib.request.html`。本计划的总deadline和私有worker是额外实现决定，不是宣称urllib原生提供整体deadline。
- Linux cgroup v2（进程继承、归属与委派条件）：`https://docs.kernel.org/admin-guide/cgroup-v2.html`。本计划的Linux实现选择需要实机验证，不代表当前已支持或可以擅自提权。
- JSON Pointer：`https://www.rfc-editor.org/info/rfc6901/`。不支持的表达式明确拒绝，不偷偷换成JavaScript属性语义。
- 原规格保留T01—T27与M0—M5分期；v0.4只补V2现状的任务接续，不把原发行要求改写成已经实现。

若实施中发现本报告之外的新缺陷，先记录可复現反例与最小修复范围；必要的协议变更写ADR和测试，不顺手重构整个仓库。本计划提供的断言片段需放入相应真实fixture，不能硬编码对象声称运行验证。

**文档结束：V2 修复优先，真实 M3 收口后再产品化。**
