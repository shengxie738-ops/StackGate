# StackGate v0.1 — Codex 可执行开发任务规划

> 面向执行 Agent：按本文件任务卡逐项实现，不把规划、类型声明、模拟报告或未运行的测试当作已完成产品。若当前环境已提供 Superpowers，可按需使用 `executing-plans` 或 `subagent-driven-development`；缺少该技能不阻断开发，也不要求额外安装。任务依赖、真实验证、权限和本文边界始终有效。

**目标：** 实现能够发现真实全栈契约漂移、绑定验收证据、指导失败交接并执行合并门槛的本地 CLI 产品；先交付 FastAPI + React/TypeScript/Vite 的可运行预设。

**架构：** 模块化单体、独立外部检查进程、薄 Codex/Claude 接入层。确定性核心计算结论，项目已有测试提供事实，Agent 根据证据修复；不新增模型调用平台、后台服务或业务管理控制台。

**技术基线：** TypeScript、Node.js 24、pnpm 工作区、版本化 JSON Schema/Ajv、oasdiff、TypeScript Compiler API、项目锁定的 Playwright、已有测试 Docker Compose 文件。pnpm、Vitest、构建工具及若干实现细节属于本文新增的实施选择，不是原稿已经定稿的要求。

**文档状态：** 可开始实现的详细任务计划；不代表产品、测试或宿主接入已经完成。计划编制日期为 **2026-09-18**；需求原稿设计基准日期保持 **2026-09-15**。

**需求来源：** 随本计划提供的 `StackGate_功能与架构设计_v0.1.md`，共 22 章。本次上传的带 `(1)` 文件是该稿的同内容副本。原始字节 SHA-256：

```text
56b349eda55673090dee2c611baa250b90f1afa5a3f85a0e78c670fa553af8a9
```

**建议仓库位置：** 原稿存入 `docs/specs/stackgate-v0.1.md`；本计划存入 `docs/plans/2026-09-18-stackgate-v0.1-execution.md`。复制时保留原稿，不用本计划覆盖它。原稿原有 F01—F16、M0—M5、T01—T28 编号不变；开发任务新增 SG 编号，避免混淆。

---

<a id="start"></a>
## 0. 先给 Codex 的执行约定

### 0.1 第一轮执行方式

先确认当前目录、现有 Git 状态、已有仓库规则和已有实现。空目录可建立本项目；已有同名工程则增量实现，不另建第二套脚手架，不迁移用户现有前后端技术栈。只读取本计划第 0—5 节、任务索引以及本轮任务卡；再按卡片的来源读取原稿对应章节。

默认首先执行 **SG-001—SG-010（M0）**。这里的 M0 不是只写文档：必须得到可以构建、运行单测、验证 schema、复现契约夹具的工程。其后按依赖推进，直至当前授权目标完成。一个会话不必一次实现全部产品；会话结束前必须形成可续接状态，而不是声称将来会在后台完成。

未得到独立授权前，不发布 npm 包、不向远程仓库 push、不创建远程 PR/MR、不部署服务器、不修改生产数据库，不为验证宿主插件自动调用付费模型。允许范围内的本地、可逆编码和项目测试应持续推进；常规文件命名等已经在本文给出的选择不再重复询问。

### 0.2 每张任务卡的统一完成规则

每张卡中的文件是**拟创建或修改的路径**，不是已存在文件的断言。执行时先局部搜索；同职责实现已存在时复用，在进度记录中写明映射路径。不得为了严格匹配建议目录而进行无关重构。

每项任务必须经历：先建立可失败的检查或测试 → 观察与该任务有关的失败 → 最小实现 → 跑该项测试 → 跑相关回归和类型检查 → 记录实际证据。测试前后都保留真实退出码。纯材料任务使用 schema、链接、命令或打包检查，不伪造单测覆盖率。

一个任务可在内部进一步拆成若干代码提交，但不能在核心行为仍是固定返回值、伪造产物、跳过必检的情况下标为 DONE。测试中的 fake adapter 仅允许放在 `tests/`，不得成为发行版默认执行路径。

### 0.3 进度与续接文件

SG-001 建立以下轻量状态，不把整份长计划放进全局 `AGENTS.md`：

| 文件 | 内容 | 更新规则 |
|---|---|---|
| `docs/implementation/PROGRESS.md` | 当前阶段、完成任务、下一项、阻塞、最近真实验证 | 每项结束更新；控制在便于单次阅读的长度 |
| `docs/implementation/tasks.json` | 每项状态、依赖、文件、测试记录引用 | 机器校验，不得先批量标 DONE |
| `docs/implementation/DECISIONS.md` | 实施补充与变更理由 | 只追加有影响的决定；引用 ADR |
| `docs/implementation/BLOCKERS.md` | 权限、环境、版本或业务决策缺口 | 写影响范围及可继续任务，不只写“环境问题” |
| `docs/implementation/architecture-map.md` | 实际模块入口和边界 | 在实现入口变化后增量更新 |
| `docs/implementation/evidence/` | 已脱敏命令记录、阶段审查摘要 | 只收集开发验证结果，不收客户代码或原始 trace |

任务状态限定：`NOT_STARTED`、`READY`、`IN_PROGRESS`、`BLOCKED`、`IMPLEMENTED_UNVERIFIED`、`DONE`。其中 IMPLEMENTED_UNVERIFIED **不等于 DONE**。依赖任务尚未 DONE 时不得把下游标 READY，除非仅编写隔离单测并明确仍未整合。

每项记录最少包含下列字段；执行器用真实值写入，不复制虚构成功记录：

```json
{
  "task_id": "SG-001",
  "status": "NOT_STARTED",
  "actual_files": [],
  "verification": [],
  "commit": null,
  "blockers": [],
  "next_action": "确认当前仓库、保存需求原稿并建立任务索引"
}
```

`verification` 条目结构为 `command`、`cwd_relative`、`started_at`、`finished_at`、`exit_code`、`result`、`evidence_path`。没有运行就保持空数组。`commit` 为 null 表示没有创建提交，不构造虚假 SHA。

### 0.4 上下文、并行与恢复

每轮只加载当前任务、直接依赖的接口和相关代码。先搜索符号，再读取必要片段；不要每次重读整个仓库、原稿和所有 Skills。不重复运行已成功且输入未变化的开发检查；阶段门槛和产品运行新鲜度规则不因此削弱。

默认单 Agent 主线。接口冻结后，可并行最多两个互不写共享协议的任务；同一任务不同时交给多个执行者。`packages/contracts`、`schemas`、Gate 与 Run 状态协议由主 Agent 统筹。子 Agent 提供差异和真实测试，主 Agent 在整合状态重跑。并行文件划分不等于 Git 或操作系统权限隔离。

恢复时读取 PROGRESS、tasks.json、当前 `git status` 和最近相关 diff；确认真实文件与记录一致，再继续下一项。不要 reset、清空目录或重写已完成模块。开发线程的恢复与产品 Run 的恢复是两回事：开发可以续接，但 P0 产品集成 Run 不从半途伪恢复为通过。

### 0.5 最终交付的层次

**M0—M4：编码与本地/CI 产品验证。** 结束应提供可安装的本地 tarball、示例、CLI、两平台入口、GitLab 示例及实际测试矩阵。

**M5：真实用户验证。** 含需要用户授权、真实参与者和外部环境的工作。没有这些条件可交付脚本、方案和空数据 schema，但相应研究任务保持 BLOCKED 或 IMPLEMENTED_UNVERIFIED，不能用合成数字宣称市场验证完成。

**公开发布：单独授权。** 包名、许可、组织名和宿主实际验收未完成时，只能称“本地候选版本”，不能写“已正式发布”“全平台支持”。

---

<a id="scope"></a>
## 1. 从原稿继承的边界与可运行里程碑

### 1.1 不得擅自改动的 P0 范围

原稿 §3.2、§18、§19 是范围依据。单 Git 仓库；一个前端、一个 API 服务；REST + JSON；已测试 OpenAPI 3.1 子集；显式映射优先；未知影响保守回归；本地文件证据；CLI + Skill；GitLab CI。Windows 11 原生、WSL2/Linux CLI 和 Linux CI 是目标验证环境，未测的平台不能冒充认证。

P0 不做：向量库、永久记忆、模型路由、自动 Agent 调度、自动修复循环、自动合并/部署、React 管理台、常驻 daemon、多租户账户、支付、云执行平台、全协议支持。**HTML、Hooks、MCP、Vue、Spring Boot、GitHub Actions 产品适配和跨 run 集成通过缓存仍属 P1/P2。** 不得把 T28 提前变为首版阻塞任务，也不得把 T01—T27 降级为后续工作。

“不自动修改业务代码”约束的是产品行为。开发和演示测试可以在专用 fixture 工作区应用公开故障/修复补丁，但该能力不作为 StackGate 自动修复业务仓库的功能发布。

### 1.2 阶段出口

| 原稿阶段 | 本计划任务 | 必须看得见的可运行结果 |
|---|---|---|
| M0 规范与故障样例 | SG-001—SG-010 | 工程可构建；schema 与判定单测运行；三方契约夹具能校验；版本锁和任务账本就绪 |
| M1 只读扫描 | SG-011—SG-028 | `doctor/scan/task/plan 前置数据` 可用；真实 Git 脏工作区能识别；契约差异及未知影响可见；不执行仓库脚本 |
| M2 执行与证据 | SG-029—SG-050 | DAG 执行、进程管理、报告、交接、gate 联通；取消、零测试、报告缺失、过期不能假绿 |
| M3 真实全栈闭环 | SG-051—SG-077 | 启动真实 FastAPI/React，浏览器触发 API；故障被拒，修复后新 run 通过；环境来源和资源清理得到验证 |
| M4 产品化 MVP | SG-078—SG-095 | tarball 干净安装、可用预设、两宿主入口、GitLab 门槛、升级卸载、T01—T27 与平台矩阵 |
| M5 外部验证 | SG-096—SG-100 | 可复现实验、实际设计伙伴记录、收益/误报分析、基于证据的迭代决策 |

M0 的门槛纯函数先开发，M2 再接真实证据，不表示 M0 已完成集成验收。M1 允许安全执行已识别的 Git/oasdiff 只读工具，但不允许 import 应用、安装依赖或运行项目测试脚本。

### 1.3 第一个演示的正确设置

默认演示使用**基线与确认目标相同**的新响应结构 `data.performance.total_return`；候选后端按目标返回，前端故意读取旧字段。这样失败确实来自消费者错位，而不是未经批准的 API 破坏性变更。先展示前后端各自 Mock 单测通过，再展示真实页面断言失败，最后在同一任务约定下修复前端并创建新 run。

另设独立“允许 API 升级”夹具：基线为旧契约，目标为新契约，确认记录列出精确 operation、差异规则和前后摘要的批准项。缺少批准时兼容性检查拒绝。不得为了让主演示绿灯，把全局兼容性改为忽略。

样例只展示合成的收益百分比，不连接真实金融数据，不需要金融账户和数据库凭证。数据 `0.1234` 对应 UI `12.34%`。首个正常数据流程只针对该合法响应验收。空状态另设目标契约明确允许的空数据场景及独立验收用例，不把违反required/number的响应当成“正常空状态”给整体验收PASS；对于不合法响应，UI可以安全降级，接口检查仍必须FAIL。空状态不得显示 `NaN`。这些业务断言是样例定义，不由schema验证自动推出。

E20 的样例初始DRAFT任务显式允许应用源码和 `apps/web/tests/performance.test.ts` 的必要更新；不允许修改 `tests/acceptance/**`、确认目标和核心e2e断言。该范围必须在演示首次确认前展示，不能在修复过程中由Agent偷偷放宽。真实用户任务仍以其确认的allowlist为准。

---

<a id="decisions"></a>
## 2. 原稿未定稿部分：明确标识的实施补充

本节编号 **E** 表示为可编码性新增的实施决定，不伪称原稿已有；与原稿冲突时记录变更，不静默覆盖产品原则。原稿 §21 的 ADR-001—009 保留，新决定用 ADR-010 起续号。

| 编号 | 实施补充 | 理由及边界 |
|---|---|---|
| E01 | 空仓库用 pnpm 工作区、Vitest、TypeScript 严格模式；一个发行包，内部目录不分别发布 | 降低多包版本成本；已有工程保持其工具约定，登记映射 |
| E02 | Node.js 24 作为首条测试线；M0 根据真实可用发行版锁精确补丁和依赖版本 | 不在文档中虚构已测最低版本；所有外部版本从本机与官方来源记录 [W01] |
| E03 | 配置 JSON Schema 为单一结构真源，自动生成或校验 TypeScript 类型；新增 schema 字段须同步金样例 | 防止配置、领域类型、模板三套定义漂移 |
| E04 | 默认数据 schema 仍用 `0.1`；只对声明的 `extensions` 容器允许扩展，配置未知字段拒绝 | 原稿兼容读取与严格配置校验分别处理 |
| E05 | 计划只包含启动前可固定的输入与环境要求；实际 instance、image、run 产物在运行时追加到证据身份 | 避免要求 plan 预先拥有尚未创建的容器 ID |
| E06 | 任务确认保存不可变目标契约副本和保护输入清单；本地记录不升级为可信 CI 审批 | 解决同路径目标契约后来被修改的问题 |
| E07 | 一个同仓库工作树同时只允许一个有副作用 run；纯扫描可并发；执行步骤默认并发 2 | 保守避免共享工作区/服务争用；CI 使用独立工作区 |
| E08 | 进程零退出但缺报告/零用例用 `BLOCKED + reason` 表达，汇总 INCOMPLETE；损坏报告用 ERROR | 不给 `check.status` 增加与原稿冲突的新枚举 |
| E09 | `gate` 重新计算评估，不修改原 Run 事实；新评估单独输出或另存 evaluation | 允许当前变 STALE，同时保留历史发生过的 PASS |
| E10 | 默认真实链路以稳定 test_id + run/check/request/instance ID 关联浏览器、探针和后端访问记录 | 简单 run_id 或应用自报 SHA 不能单独证明来源 |
| E11 | Windows 优先解析受支持 npm/pnpm 的真实 JS 入口后用 Node 启动；未知 `.cmd/.bat` 显式不支持 | 不把 `shell:false` 当作所有 Windows 命令都能运行 [W05] |
| E12 | 默认全部产物 100 MB/run 总预算；关键结构证据预留额度；二进制敏感产物默认 restricted，不自动导出 | 避免日志挤掉失败证据；超限要影响完整性 |
| E13 | 安装与删除新增 `adapters remove`；报告新增 `--output`；确认支持 `--confirm-digest`；交接支持 `--validate` | 原稿有卸载与自动化需求而命令细节未展开；不引入更高权限 |
| E14 | 强 CI 入口由维护者提供可信 CLI/策略/工具清单；候选仓库不能自行用 `CI=true` 升格 | 对应原稿 §15.4；真实组织权限仍须外部配置 |
| E15 | 简单业务 probe 采用固定 JSON 协议和预设 helper；不允许在 YAML 中填写可执行断言表达式 | 禁止 eval；已有脚本属于经授权的项目代码 |
| E16 | 发布前将全部精确支持组合写进 machine-readable compatibility lock；缺失能力标 UNKNOWN，未执行组合标 NOT_RUN | “工具能启动”不等于全套场景已测 |
| E17 | 已确认 Compose 服务通过本次真实资源记录绑定动态 origin | 不用放开全部 localhost 端口，详见 §7.2 |
| E18 | 检查输出按 run/check/attempt 隔离，关键产物协议与分类固定 | 不读取旧报告，详见 §7.3 |
| E19 | CLI固定 plan_/run_安全ID前缀，返回data.plan_id/data.run_id/data.gate | 便于无猜测地脚本读取，详见 §10.4 |
| E20 | 样例允许修改指定应用单测，但受保护e2e和目标仍不可改；空状态目标另设合法数据场景 | 避免正常修复被错误权限阻止，也避免用无效响应测试充当PASS |

### 2.1 实施中必须处理的六个歧义

**原始与规范化摘要：** 文件新鲜度使用实际字节，CRLF 与 LF 改变应被发现；配置语义摘要才使用规范化 JSON。不能对源码自动换行后计算“相同”。数组次序默认保留，仅对明确声明为集合的字段排序。

**目标与实现比较：** 基线→目标由 oasdiff 判断兼容性；目标→候选还需要受支持行为投影比较。只做双向“破坏性变更”检查不能证明完全对齐。描述、示例、规范版本 patch 等是否忽略必须在投影白名单说明；未知字段先诊断，不能先删除再宣布相同。

**扫描结论：** `scan` 可以成功输出差异并退出 0；它不创建完整运行 PASS，更不能使 integration profile 的 gate 通过。静态 profile 只能宣称静态范围结果。

**确认与授权：** 任务确认表示接受“应该实现什么”；执行授权表示允许“运行哪些命令与目标”。两者分开保存与校验。Agent 自填姓名、YAML `CONFIRMED` 或环境变量不构成审批。

**清理后的新鲜度：** 已完成运行的环境可被正常清理。随后 gate 校验当时证据与当前任务/代码/策略是否匹配，不要求已删除的临时服务仍存活；不能把清理误判为验收失效，也不能把历史结果说成当前生产环境状态。

**控制与证明：** CONTROLLED 仅表示受信流程按固定输入构建并运行专用环境。任意仓库脚本仍是不可信代码；同进程权限下仍可能伪造报告。原稿没有承诺防恶意测试作者的远程证明系统，本计划不增加这种宣传。

---

<a id="layout"></a>
## 3. 代码布局、构建合同与开发命令

### 3.1 目录与单一职责

```text
apps/cli/src/                  参数解析、命令处理、stdout/stderr、退出码
packages/contracts/src/       共享结构与 schema 生成类型；禁止 IO
packages/core/src/domain/     判定、选择、计划、新鲜度等纯函数
packages/core/src/ports/      Git/Runner/Environment/Evidence 等边界
packages/core/src/services/   Project/Task/Plan/Run/Gate/Handoff 应用服务
packages/core/src/storage/    本地证据、事件、锁、摘要、原子写
packages/adapter-git/src/     真实 Git CLI 与文件清单
packages/adapter-oasdiff/src/ OpenAPI 安全加载、工具差异、能力诊断
packages/adapter-typescript/src/ 显式映射与有限静态分析
packages/adapter-playwright/src/ reporter、稳定 ID、重试和真实链路数据
packages/adapter-compose/src/ 环境预检、启动、来源、资源归属与清理
packages/reporters/src/       终端、JSON、Markdown、JUnit、交接渲染
schemas/0.1/                  配置、任务、计划、run、probe、reporter 等 schema
integrations/shared/          两宿主共同流程与结果解释，构建时复制到各自包
integrations/codex/            SKILL.md 与本地 references
integrations/claude-code/      .claude-plugin、skills、references
integrations/gitlab/           退出码包装器、CI 示例和可信流程说明
presets/fastapi-react/         可审查配置与辅助脚本模板
examples/contract-drift-demo/  FastAPI、React、固定契约、故障/修复状态
scripts/                      构建、fixture、开发检查、打包与离线校验
tests/support/                真实临时仓库、受控子进程、伪工具（仅单测）
tests/unit/                   纯逻辑、配置和解析器
 tests/contract/              真实外部工具的合同与格式金样例
 tests/integration/           CLI、进程、文件存储、环境和浏览器
 tests/acceptance/            T01—T27 可追溯场景
 tests/security/              注入、越界、脱敏、资源和拒绝绕过
 tests/compatibility/         Windows、Linux/WSL、版本与打包
 docs/                        原稿、计划、ADR、实施状态、用户文档
```

上述 `tests` 各子目录均为同一个根目录的子路径，缩进仅为说明。源码不得依赖测试目录；domain 不导入 CLI、Docker、Playwright 或 filesystem。适配器通过 ports 进入应用层；reporter 不修改 check 事实。

### 3.2 SG-002 必须实现的根脚本

以下是**要建立并实测的脚本合同**，不是当前下载本计划后立刻存在的命令。空仓库完成 SG-002 后执行；已有工程建立等价别名并记录。

| 命令 | 实际职责 | 未具备条件的处理 |
|---|---|---|
| `pnpm build` | 编译/打包 CLI、共享类型、Playwright reporter、复制 schema/模板 | 编译错误非零；不得只输出文字 |
| `pnpm typecheck` | 全工程 TypeScript 严格检查 | 不用 `skip` 躲开产品包 |
| `pnpm lint` | 代码与边界检查 | 只做相关规则，禁止无关全仓格式化 |
| `pnpm test:unit` | 领域、schema、parser 单测 | 空集合非零 |
| `pnpm test:contract` | 固定工具真实格式兼容 | 工具缺失显式阻塞；release 不得跳过 |
| `pnpm test:integration` | CLI/进程/存储/环境集成 | 明确是否需 Docker/浏览器 |
| `pnpm test:acceptance -- --ids T01,T02` | 执行指定源需求验收场景并汇总 | 未注册 ID、空选择、未执行必选非零 |
| `pnpm verify:source` | 原稿来源/字节摘要与任务可追溯校验 | 人工更新来源须有记录 |
| `pnpm verify:schemas` | 校验所有模板、金样例、生成类型漂移 | 任一无效非零 |
| `pnpm verify:tasks` | 任务状态、依赖与证据字段校验 | DONE 无证据、循环依赖等非零 |
| `pnpm verify:boundaries` | domain 禁止 IO、产品不引入测试 fake | 查出违规非零 |
| `pnpm verify:stage -- --stage M2` | 读取 stage manifest，执行真实前置检查 | 不能只检查目录是否存在 |
| `pnpm bench` | §17 原稿基准，写真实 JSON 结果 | 环境不足说明，不填假 p95 |
| `pnpm pack:local` | 构建并产生一个本地发行 tarball | 不执行 npm publish |
| `pnpm test:package` | 干净临时目录安装 tarball 并测试入口 | 不依赖开发仓库绝对路径 |
| `pnpm verify:release` | T01—T27、兼容矩阵、许可/包名/宿主实测状态 | 未测与缺审批保持阻塞 |

`pnpm verify:stage`、`test:acceptance` 等脚本在相应任务逐步实现；尚未实现时根脚本返回清楚的“未实现检查入口”并非零，不得生成假的成功占位脚本。root package 初始 `private:true`；包名核查和发布授权完成前不更改为可公开发布。

固定本地 CLI 入口：`node dist/cli.mjs`。计划中的 `stackgate` 是安装后的 bin 名称；在开发期优先使用实际构建文件，不假设 npm 上已有合法同名包。TypeScript 单测使用 `pnpm exec vitest run 路径`，不把执行计划中的说明当作已经装好依赖。

### 3.3 依赖与工具版本记录

SG-010 创建 `tools/compatibility-lock.json`，每个真实工具记录 `name`、`version`、`platform`、`source`、`checksum_or_lock_integrity`、`tested_capabilities` 和 `verified_at`。未实测的组合用状态字段 UNKNOWN，不能填版本字符串 `latest` 作为通过依据。Node 官方当前仍将 24 系列列为 LTS，但最低支持补丁由本项目实际矩阵决定 [W01]。

依赖锁提交仓库。oasdiff 不在用户 `init` 时自动下载安装；缺失时给出审核后的安装指南。Playwright 使用目标项目锁定的版本，产品 reporter 声明经验证范围而不偷偷升级用户框架。外部工具升级需重跑合同夹具，不能仅修改版本号。

---

<a id="contracts"></a>
## 4. 必须先冻结的接口与状态合同

### 4.1 标识、错误与字段约定

JSON 使用 snake_case；TypeScript 函数使用 camelCase；所有持久化对象有 `schema_version:"0.1"`。日期为 UTC ISO 8601；显示层可本地化。对外路径为仓库相对 POSIX 路径；不得将用户名、绝对路径或密钥拼进 ID。

Git 对象 ID 与内容 SHA-256 分开命名。Git 仓库可能使用不同对象格式；由 Git 查询对象格式后验证，不硬编码所有 OID 长度为 40。输入/产物摘要是内容 SHA-256；随机 `run_id/plan_id/event_id` 不是摘要。

统一诊断包含 `code`、`message`、`location`、`observed_facts`、`recommended_action`、`source`。机读 code 稳定，中文文案可改。缺少能力不可用“未发现问题”替代。

### 4.2 运行判定

```typescript
export type Phase = 'CREATED' | 'PLANNED' | 'RUNNING' | 'FINALIZING'
  | 'COMPLETED' | 'CANCELED' | 'ABORTED';
export type CheckStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'ERROR';
export type Verdict = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'ERROR';
export type Freshness = 'FRESH' | 'STALE' | 'UNVERIFIED';
export type Decision = 'ALLOW' | 'DENY';
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 64;
export type ProvenanceLevel = 'DECLARED' | 'OBSERVED' | 'CONTROLLED';

export interface CheckFact {
  check_id: string;
  required: boolean;
  status: CheckStatus;
  result_kind: 'exit-code' | 'junit' | 'probe' | 'playwright' | 'contract';
  exit_code: number | null;
  expected_test_ids: string[];
  executed_test_ids: string[];
  discovered_tests: number;
  executed_tests: number;
  skipped_tests: number;
  flaky_tests: number;
  reasons: string[];
  evidence_refs: string[];
}
export interface GateInput {
  checks: CheckFact[];
  required_check_ids: string[];
  configuration_valid: boolean;
  report_integrity: 'VALID' | 'INVALID' | 'UNVERIFIED';
  freshness: Freshness;
  inputs_complete: boolean;
  task_confirmed: boolean;
  policy_confirmed: boolean;
  environment_satisfied: boolean;
  acceptance_inputs_approved: boolean;
  canceled: boolean;
  fatal_error: boolean;
  deterministic_denials: string[];
}
export interface GateEvaluation {
  schema_version: '0.1';
  verdict: Verdict;
  freshness: Freshness;
  decision: Decision;
  exit_code: ExitCode;
  reasons: string[];
}
export function evaluateGate(input: GateInput): GateEvaluation;
```

这段是 SG-003/SG-007 的共享接口目标，不是完整生产实现。证据引用、版本与时间等由完整 Run/Gate schema 补齐。类型检查类 `exit-code` 检查不要求“测试数>0”，但 JUnit/probe/Playwright 检查必须有实际必需记录；不能因类型检查没有测试用例而误判，也不能把测试检查伪装成 exit-code 绕过计数。

| 输入事实 | check/运行结论 | 门槛退出 |
|---|---|---|
| 全部必检完成、证据/身份/策略都满足 | PASS / ALLOW | 0 |
| 真正的必检断言失败 | FAIL / DENY | 1 |
| 必检不存在、跳过、0 用例、环境来源不够、能力不支持 | INCOMPLETE / DENY | 2 |
| 无法信任的内部错误、产物损坏、解析器崩溃 | ERROR / DENY | 3 |
| 计划/报告与当前输入不符 | freshness STALE / DENY；历史 verdict 保留 | 4 |
| 参数、重复 YAML 键、未知配置字段等结构错误 | CLI 配置错误；不强造 Run | 64 |

优先级保持原稿：`64 → 3 → 4 → 1 → 2 → 0`；保留全部 reasons。取消默认 INCOMPLETE；先前 FAIL 仍在检查事实中。存在报告完整性错误时 3 优先于 stale 和业务失败。只有受确认策略允许的可选检查才不阻断，不允许运行后临时改 required。

### 4.3 任务确认与三份契约

`TaskPayload` 保存原稿 §12.3 的字段；`task_id+revision` 是不可变意图身份。确认步骤：结构与引用校验 → 展示有效目标/约束/必检 → 由本地明确动作或可信维护流程认可 → 保存目标字节及摘要 → 保存确认记录。需要网络、权限或业务豁免时，不自动确认。

```text
.stackgate/state/tasks/{task_id}/revisions/{revision}/
  task.json
  target/{service_id}/openapi.json
  protected-inputs.json
  confirmation.json
```

本地 `confirmation.json` 最少含 `payload_hash`、`target_hashes`、`protected_input_hash`、`confirmed_at`、`confirmation_source:local-review`。它是本地防误操作记录，不是签名审批。CI 从独立可信来源读取审批输入；候选 MR 自带的确认记录不自动可信。

`status` 与展示元数据不进入业务 payload hash；确认后的任务结构变化、目标字节变化、保护输入变化均触发重新确认或新 revision，并使旧计划失效。新 revision 不覆盖旧目录。

三方值的读取来源固定：baseline 从解析后的基线提交读取；target 从该确认 revision 的快照读取并核对工作区受保护文件；candidate 从本次 export step 的新输出目录读取。路径相同不代表内容来源相同。

### 4.4 计划、输入和执行步骤

`InputManifest` 至少记录 `repo_id/worktree_id/platform_id/base_oid/head_oid/target_tip_oid/git_object_format/files/exclusions/completeness/input_hash`。`files` 包括纳入范围的 tracked、staged、unstaged 和 untracked 最终被测字节；另外保存 staged 与未暂存变更列表用于解释。不能只拼接两份 diff 充当快照。

对 deleted 文件保留 tombstone；可执行位变化、符号链接目标、关键忽略文件缺失、LFS pointer、submodule 和冲突均有专门诊断。运行前后捕获并比较；P0 不能检测文件中途修改后又恢复的所有情况，报告保留这一局限。

```typescript
export interface CheckStep {
  step_id: string;
  check_id: string;
  adapter_id: string;
  command_id: string | null;
  depends_on: string[];
  required: boolean;
  timeout_ms: number;
  resource_locks: string[];
  expected_artifacts: string[];
  expected_test_ids: string[];
  min_tests: number | null;
  parameters: Record<string, unknown>;
}
export interface CheckPlan {
  schema_version: '0.1';
  plan_id: string;
  task_id: string;
  task_revision: number;
  profile: string;
  input_hash: string;
  policy_hash: string;
  target_contract_hashes: Record<string, string>;
  toolchain_hash: string;
  environment_requirements_hash: string;
  required_check_ids: string[];
  steps: CheckStep[];
  plan_hash: string;
}
```

`plan_hash` 排除自身、生成时间与随机 ID；含排序明确的有效步骤/依赖与输入身份。实际执行选项只能进一步收紧并记录；更换 profile、修改命令/目标、改变必检必须重建计划。

图的固定规则：环境准备先于候选导出和真实接口/页面；同环境可只读并行的操作需明确资源锁；环境失败使下游 BLOCKED。清理属于 finalization，不放在普通“依赖成功才执行”的节点中，确保失败也清理。

### 4.5 Probe 与 Playwright 产物协议

runner 注入原稿四个变量，并新增 `STACKGATE_CHECK_ID`、`STACKGATE_ATTEMPT_ID`、`STACKGATE_INSTANCE_ID`（运行环境提供时）。注入仅限登记命令，不把用户全环境原样转交。

```json
{
  "schema_version": "0.1",
  "kind": "stackgate-probe",
  "run_id": "run_fixture",
  "check_id": "runtime",
  "attempt_id": "attempt_fixture",
  "instance_id": "instance_fixture",
  "operations": [
    {
      "operation_key": "api:GET /api/performance",
      "request_id": "request_fixture",
      "status_code": 200,
      "media_type": "application/json",
      "schema_valid": true,
      "assertions": [{"assertion_id":"total-return-is-number","passed":true}],
      "backend_observation_ref": "backend-requests.jsonl#request_fixture"
    }
  ],
  "completed": true
}
```

这是协议样例而非已运行证据。`schema_valid:true` 来自 helper 的初步判断；核心仍用已确认目标重新验证保留下来的合成响应数据，不能仅相信项目脚本自报布尔值。`completed` 需同时与进程完成、产物归属、运行身份和必检操作匹配；任一不符不得通过。

产物默认名：候选契约 `candidate-openapi.json`，JUnit `junit.xml`，probe `probe.json`，Playwright `playwright.json`，后端记录 `backend-requests.jsonl`。实际都在当前 `check_id/attempt_id` 的输出目录，不读取项目目录残留文件。工具生成原始报告前先清空**本次自有空目录**，不删除用户测试产物。

Playwright reporter 记录 begin/end、完整 inventory、稳定 annotation `stackgate-id`、每次 retry、expected/actual status、附件、请求/控制台观测。重复 ID、`.only` 导致必检未入集、skip、expected-fail 掩盖必检真实失败、重试后通过，都进入完整性/策略判断。浏览器 `requestfinished` 不能独自证明真实后端；必须关联后端观察。

### 4.6 来源等级与资源归属

DECLARED：只有配置、URL或应用自报信息。OBSERVED：实例身份 + 可独立核对的启动/构建记录 + 当前输入摘要 + 实际请求关联均可验证。CONTROLLED：再由可信 CI 工作流控制检出、构建、启动、命令及专用环境。

attach 不接管用户进程；缺少其中一项就保持 DECLARED/UNVERIFIED。Compose 的唯一 project 名仅是一项资源分组措施，固定端口、external volume、生产连接、host network、privileged、Docker socket 挂载另行拒绝或要求有明确可信隔离方案；P0 预设不支持这些危险配置。

资源台账条目含 `run_id`、`owner_token`、`resource_type`、原生 ID、创建时身份、created_by_stackgate、cleanup_status。仅清理由本次创建且身份仍可核对的资源；PID 单独不足以证明进程身份。未知归属保留并告警。

### 4.7 适配器边界

原稿 describe/validate/plan/execute/collect 保持；事件统一版本化，adapter 不自行 ALLOW。下列是类型目标，各引用类型由 SG-003—SG-008 的 schemas/ports 定义并导出：

```typescript
export interface Adapter {
  describe(): AdapterCapabilities;
  validate(config: AdapterConfig, project: ProjectContext): Promise<Diagnostic[]>;
  plan(inputs: AdapterInputs, policy: EffectivePolicy): Promise<CheckStep[]>;
  execute(step: CheckStep, context: ExecutionContext): AsyncIterable<RunEvent>;
  collect(step: CheckStep, context: CollectionContext): Promise<CheckResult>;
}
```

`AdapterCapabilities` 声明版本、平台、schema 子集、证据格式和来源能力。`AdapterConfig/Inputs` 使用按 adapter_id 区分的严格联合结构，不是能求值的任意 JSON。`ExecutionContext` 有允许路径、必要环境变量、取消信号、日志/产物写入端口，不直接暴露自由系统 shell。基础 ports 至少包括 GitPort、RunnerPort、EnvironmentPort、EvidenceStore、Clock、IdFactory；Clock/IdFactory 可注入以便测试，但生产实现生成真实时间/ID。

### 4.8 CLI 行为冻结

公共 `--project/--config/--json/--no-color`；机读 JSON 独占 stdout，进度/诊断放 stderr。为读取命令输出，schema 使用 `command`、`ok`、`data`、`diagnostics`，其中 `ok` 只表示命令是否成功执行；`data.gate.decision` 才是门槛。

`init` 默认 dry-run；`--apply` 才写。`clean` 默认 dry-run；同样需要 `--apply`。任务确认/执行授权在非 TTY 不弹出假确认，要求精确待确认摘要及当前授权来源；不支持绕过未知输入的通用 `--yes`。受保护 CI 策略不允许被这些本地确认参数覆盖。

本计划新增 `report --output`、`adapters remove` 是 E13 的实施扩展。不新增 `force-pass`、`auto-fix-until-green`、`publish`、`deploy` 等命令。

---

<a id="task-index"></a>
## 5. 任务总索引与执行顺序

本表依赖仅表示直接前置；所有任务还继承第 0—4 节约束。原稿映射和验收编号在任务卡、后文追溯矩阵中保留。

| 任务 | 阶段 | 交付项 | 直接前置 |
|---|---|---|---|
| [SG-001](#sg-001) | M0 | 保存原稿、建立任务账本与局部阅读入口 | 无 |
| [SG-002](#sg-002) | M0 | 建立可构建工程与真实开发检查脚本 | SG-001 |
| [SG-003](#sg-003) | M0 | 定义领域基础类型、稳定 ID 与错误分类 | SG-002 |
| [SG-004](#sg-004) | M0 | 定义项目配置与能力声明 schema | SG-003 |
| [SG-005](#sg-005) | M0 | 定义任务、审批输入与有效策略 schema | SG-004 |
| [SG-006](#sg-006) | M0 | 定义计划、运行、检查、事件和产物 schema | SG-003、SG-005 |
| [SG-007](#sg-007) | M0 | 先实现 Gate 真值表与退出码纯函数 | SG-006 |
| [SG-008](#sg-008) | M0 | 定义 ports、适配器能力与测试替身边界 | SG-006、SG-007 |
| [SG-009](#sg-009) | M0 | 建立三方契约与门槛金样例 | SG-005、SG-006、SG-007 |
| [SG-010](#sg-010) | M0 | 固定真实工具基线与 M0 出口 | SG-002、SG-008、SG-009 |
| [SG-011](#sg-011) | M1 | 实现安全路径、字节摘要与基础原子写 | SG-003、SG-008、SG-010 |
| [SG-012](#sg-012) | M1 | 实现 Git 仓库身份与固定基线解析 | SG-008、SG-011 |
| [SG-013](#sg-013) | M1 | 捕获完整被测输入与脏工作区变化 | SG-011、SG-012 |
| [SG-014](#sg-014) | M1 | 实现新鲜度与目标分支推进策略 | SG-007、SG-013 |
| [SG-015](#sg-015) | M1 | 实现只读项目识别与 doctor | SG-004、SG-011、SG-012 |
| [SG-016](#sg-016) | M1 | 实现严格配置解析与不可放宽策略合并 | SG-004、SG-005、SG-011、SG-015 |
| [SG-017](#sg-017) | M1 | 实现不可变任务 revision 与本地确认 | SG-005、SG-011、SG-013、SG-016 |
| [SG-018](#sg-018) | M1 | 实现执行预览与仓库外本地信任记录 | SG-011、SG-016、SG-017 |
| [SG-019](#sg-019) | M1 | 实现 OpenAPI 安全加载与已测子集预检 | SG-006、SG-011、SG-016 |
| [SG-020](#sg-020) | M1 | 适配真实 oasdiff 并保存原始发现 | SG-008、SG-018、SG-019 |
| [SG-021](#sg-021) | M1 | 实现三方契约编排与精确批准变化 | SG-017、SG-019、SG-020 |
| [SG-022](#sg-022) | M1 | 实现请求/响应方向的严格 schema 校验 | SG-019、SG-021 |
| [SG-023](#sg-023) | M1 | 实现显式消费者映射与已知覆盖关系 | SG-003、SG-013、SG-016 |
| [SG-024](#sg-024) | M1 | 实现有限 TypeScript 静态关联 | SG-023 |
| [SG-025](#sg-025) | M1 | 实现影响汇总与保守测试选择 | SG-021、SG-023、SG-024 |
| [SG-026](#sg-026) | M1 | 实现验收输入与测试漂移检测 | SG-013、SG-017、SG-025 |
| [SG-027](#sg-027) | M1 | 实现安全初始化与静态 CLI 主流程 | SG-015、SG-016、SG-017、SG-018、SG-021、SG-025、SG-026 |
| [SG-028](#sg-028) | M1 | 完成只读阶段验收与故障说明 | SG-014、SG-019、SG-020、SG-022、SG-027 |
| [SG-029](#sg-029) | M2 | 建立 Run 目录、原子存储与幂等事件日志 | SG-006、SG-008、SG-011、SG-028 |
| [SG-030](#sg-030) | M2 | 实现日志脱敏、产物分级与容量预算 | SG-011、SG-029 |
| [SG-031](#sg-031) | M2 | 实现完成封存与证据完整性校验 | SG-029、SG-030 |
| [SG-032](#sg-032) | M2 | 实现跨平台命令解析与最小环境变量 | SG-008、SG-018、SG-028 |
| [SG-033](#sg-033) | M2 | 实现子进程执行、流式日志与有界取消 | SG-029、SG-030、SG-032 |
| [SG-034](#sg-034) | M2 | 实现固定输入的检查计划 DAG | SG-006、SG-014、SG-018、SG-025、SG-026、SG-028 |
| [SG-035](#sg-035) | M2 | 实现 DAG 调度、资源锁与阻塞传播 | SG-033、SG-034 |
| [SG-036](#sg-036) | M2 | 实现退出码型检查适配器 | SG-008、SG-031、SG-033 |
| [SG-037](#sg-037) | M2 | 实现安全 JUnit 收集与实际用例计数 | SG-030、SG-031、SG-033、SG-036 |
| [SG-038](#sg-038) | M2 | 实现 Probe 结果协议与收集器 | SG-006、SG-022、SG-030、SG-031、SG-033 |
| [SG-039](#sg-039) | M2 | 实现 RunService 生命周期与前后快照复核 | SG-029、SG-031、SG-033、SG-034、SG-035、SG-036、SG-037、SG-038 |
| [SG-040](#sg-040) | M2 | 实现 GateService 完整校验与重新评估 | SG-007、SG-014、SG-017、SG-026、SG-031、SG-039 |
| [SG-041](#sg-041) | M2 | 实现 JSON 与终端第一屏报告 | SG-030、SG-031、SG-040 |
| [SG-042](#sg-042) | M2 | 实现 Markdown 与 JUnit 输出报告 | SG-041 |
| [SG-043](#sg-043) | M2 | 实现最小失败交接包与接手校验 | SG-017、SG-026、SG-040、SG-041、SG-042 |
| [SG-044](#sg-044) | M2 | 接通执行、报告、门槛与交接 CLI | SG-034、SG-039、SG-040、SG-041、SG-042、SG-043 |
| [SG-045](#sg-045) | M2 | 实现安全清理、取消与遗留资源诊断 | SG-029、SG-033、SG-035、SG-039、SG-044 |
| [SG-046](#sg-046) | M2 | 实现仅用于纯解析的内容缓存 | SG-011、SG-019、SG-024、SG-029 |
| [SG-047](#sg-047) | M2 | 实现 schema 兼容读取与非覆盖导出 | SG-006、SG-031、SG-041、SG-042 |
| [SG-048](#sg-048) | M2 | 完成执行器反例矩阵与零测试防绕过 | SG-036、SG-037、SG-038、SG-039、SG-040、SG-044 |
| [SG-049](#sg-049) | M2 | 验证崩溃、并发锁与完成封存竞态 | SG-029、SG-031、SG-035、SG-039、SG-045 |
| [SG-050](#sg-050) | M2 | 完成命令执行与证据阶段出口 | SG-040、SG-041、SG-042、SG-043、SG-044、SG-045、SG-046、SG-047、SG-048、SG-049 |
| [SG-051](#sg-051) | M3 | 实现真实 FastAPI 样例与本次候选契约导出 | SG-009、SG-020、SG-022、SG-038、SG-050 |
| [SG-052](#sg-052) | M3 | 实现 React 页面与彼此独立的 Mock 单测 | SG-009、SG-051 |
| [SG-053](#sg-053) | M3 | 实现 Playwright reporter 与稳定验收 ID | SG-006、SG-030、SG-031、SG-038、SG-052 |
| [SG-054](#sg-054) | M3 | 实现受限 HTTP probe 与 Python 预设 helper | SG-018、SG-022、SG-038、SG-051 |
| [SG-055](#sg-055) | M3 | 实现测试专用后端访问观察与实例标识 | SG-030、SG-051、SG-054 |
| [SG-056](#sg-056) | M3 | 实现 attach 环境来源核验 | SG-014、SG-018、SG-039、SG-051、SG-055 |
| [SG-057](#sg-057) | M3 | 实现 Compose 有效配置安全预检 | SG-016、SG-018、SG-032、SG-055 |
| [SG-058](#sg-058) | M3 | 实现 Compose 启动、动态端口与实际来源记录 | SG-031、SG-033、SG-035、SG-039、SG-057 |
| [SG-059](#sg-059) | M3 | 实现 readiness、旧服务与环境状态验证 | SG-056、SG-058 |
| [SG-060](#sg-060) | M3 | 建立浏览器→API→后端观察的真实链路关联 | SG-022、SG-053、SG-054、SG-055、SG-059 |
| [SG-061](#sg-061) | M3 | 实现 Compose 资源清理与专用测试数据边界 | SG-045、SG-057、SG-058、SG-059 |
| [SG-062](#sg-062) | M3 | 将环境、候选导出、Probe、浏览器接入同一 Run | SG-021、SG-034、SG-039、SG-053、SG-054、SG-056、SG-058、SG-059、SG-060、SG-061 |
| [SG-063](#sg-063) | M3 | 联动 inventory、跳过、断言和 flaky 防绕过 | SG-026、SG-037、SG-053、SG-060、SG-062 |
| [SG-064](#sg-064) | M3 | 完成单测绿而联调失败的真实负例 | SG-051、SG-052、SG-053、SG-060、SG-062、SG-063 |
| [SG-065](#sg-065) | M3 | 完成修复后的新 Run 与旧证据失效演示 | SG-014、SG-043、SG-064 |
| [SG-066](#sg-066) | M3 | 验证改契约、改断言与批准记录的防漂移闭环 | SG-017、SG-021、SG-026、SG-062、SG-063 |
| [SG-067](#sg-067) | M3 | 验证旧服务、伪来源文件和中途环境切换 | SG-056、SG-058、SG-059、SG-060、SG-062 |
| [SG-068](#sg-068) | M3 | 验证未知 schema 与动态消费者回归策略 | SG-019、SG-022、SG-024、SG-025、SG-062 |
| [SG-069](#sg-069) | M3 | 验证真实浏览器产物隐私与超限处理 | SG-030、SG-053、SG-054、SG-055、SG-062 |
| [SG-070](#sg-070) | M3 | 完成 Windows 原生命令、文件锁与取消验证 | SG-032、SG-033、SG-045、SG-062 |
| [SG-071](#sg-071) | M3 | 完成 WSL/工作树身份与 Git 边界验收 | SG-012、SG-013、SG-014、SG-049、SG-062 |
| [SG-072](#sg-072) | M3 | 完成网络、引用、参数和资源安全反例 | SG-019、SG-032、SG-054、SG-057、SG-061、SG-069 |
| [SG-073](#sg-073) | M3 | 实现 T01—T27 注册表与验收执行器 | SG-064、SG-065、SG-066、SG-067、SG-068、SG-069、SG-070、SG-071、SG-072 |
| [SG-074](#sg-074) | M3 | 整理不少于 12 个可复现故障夹具 | SG-009、SG-064、SG-065、SG-066、SG-067、SG-068、SG-072、SG-073 |
| [SG-075](#sg-075) | M3 | 实现性能基准与框架成本分解 | SG-015、SG-034、SG-041、SG-046、SG-074 |
| [SG-076](#sg-076) | M3 | 建立平台与工具组合的验证矩阵 | SG-010、SG-020、SG-053、SG-062、SG-070、SG-071、SG-073、SG-075 |
| [SG-077](#sg-077) | M3 | 完成真实全栈闭环阶段出口 | SG-062、SG-063、SG-064、SG-065、SG-066、SG-067、SG-068、SG-069、SG-070、SG-071、SG-072、SG-073、SG-074、SG-075、SG-076 |
| [SG-078](#sg-078) | M4 | 构建单一发行包与可加载的 reporter 入口 | SG-050、SG-053、SG-077 |
| [SG-079](#sg-079) | M4 | 完成 fastapi-react 可运行初始化预设 | SG-027、SG-051、SG-052、SG-053、SG-054、SG-055、SG-057、SG-078 |
| [SG-080](#sg-080) | M4 | 交付 Codex 的薄 Skill 入口 | SG-043、SG-044、SG-078、SG-079 |
| [SG-081](#sg-081) | M4 | 交付 Claude Code 插件与手动工作流 | SG-043、SG-044、SG-078、SG-079、SG-080 |
| [SG-082](#sg-082) | M4 | 实现安全安装、升级与移除 Agent 入口 | SG-018、SG-027、SG-045、SG-078、SG-080、SG-081 |
| [SG-083](#sg-083) | M4 | 实现 GitLab 门槛包装器和退出码传递 | SG-040、SG-042、SG-044、SG-061、SG-078 |
| [SG-084](#sg-084) | M4 | 实现可信 CI 策略装载与候选代码边界 | SG-016、SG-018、SG-058、SG-073、SG-083 |
| [SG-085](#sg-085) | M4 | 验证合并候选、基线推进和 CI 反绕过 | SG-012、SG-014、SG-071、SG-083、SG-084 |
| [SG-086](#sg-086) | M4 | 完成数据、规则和安装升级兼容策略 | SG-047、SG-078、SG-082、SG-084 |
| [SG-087](#sg-087) | M4 | 写出可独立接入的用户与贡献者文档 | SG-076、SG-079、SG-080、SG-081、SG-082、SG-083、SG-085、SG-086 |
| [SG-088](#sg-088) | M4 | 核查许可、依赖来源、名称与公开发布权限 | SG-010、SG-078、SG-087 |
| [SG-089](#sg-089) | M4 | 执行干净安装、离线运行和卸载烟测 | SG-078、SG-079、SG-080、SG-081、SG-082、SG-086 |
| [SG-090](#sg-090) | M4 | 收口 CLI 体验、机器协议和大型产物预算 | SG-041、SG-042、SG-044、SG-069、SG-075、SG-087、SG-089 |
| [SG-091](#sg-091) | M4 | 执行两宿主实际加载与交接验证 | SG-080、SG-081、SG-082、SG-089、SG-090 |
| [SG-092](#sg-092) | M4 | 执行全部 P0 与发布矩阵回归 | SG-073、SG-076、SG-083、SG-084、SG-085、SG-086、SG-089、SG-090、SG-091 |
| [SG-093](#sg-093) | M4 | 生成本地发布候选与证据清单 | SG-075、SG-078、SG-087、SG-088、SG-089、SG-092 |
| [SG-094](#sg-094) | M4 | 审查需求覆盖、协议一致性与范围漂移 | SG-087、SG-090、SG-092、SG-093 |
| [SG-095](#sg-095) | M4 | 完成首版交付与第三方视角首次使用验收 | SG-079、SG-082、SG-087、SG-089、SG-091、SG-092、SG-093、SG-094 |
| [SG-096](#sg-096) | M5 | 建立 A/B/C 对照实验协议和可重复执行框架 | SG-074、SG-075、SG-095 |
| [SG-097](#sg-097) | M5 | 准备设计伙伴访谈与真实任务授权材料 | SG-087、SG-095、SG-096 |
| [SG-098](#sg-098) | M5 | 实现可选择的本地指标采集与分析输入 | SG-075、SG-096、SG-097 |
| [SG-099](#sg-099) | M5 | 分析真实实验并作继续/收缩判断 | SG-096、SG-097、SG-098 |
| [SG-100](#sg-100) | M5 | 形成有证据门槛的后续迭代清单 | SG-094、SG-095、SG-099 |

---

<a id="task-cards"></a>
## 6. 可执行任务卡

任务卡中的 TypeScript 签名或断言是待实现接口/测试合同，不是产品已经具备的 API。遇到命名冲突先登记一次兼容映射；不得让不同模块各自发明第二套相同概念。每项的测试表均要求落到指定测试文件，不得只写入文档。


### M0 阶段任务

<a id="sg-001"></a>
#### SG-001 · 保存原稿、建立任务账本与局部阅读入口

**阶段：** M0　**前置：** 无　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §18、§21；本计划 §0

**可独立验收的目标：** 让下一轮 Codex 能核对真实需求、已有代码与任务状态，避免从零重复规划。

**创建 / 修改文件：** 新增 docs/specs/stackgate-v0.1.md、docs/implementation/{PROGRESS.md,tasks.json,DECISIONS.md,BLOCKERS.md,architecture-map.md}；仅在没有等价规则时新增仓库级 AGENTS.md；新增 scripts/verify-source.mjs、scripts/verify-tasks.mjs。

**输入输出与共享接口：** 账本字段采用 §0.3；verify-tasks 读取 JSON 后返回非零表示状态/依赖不合法，不调用模型。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 读取仓库身份、现有规则和根清单；保存原稿的原始字节，校验给定 SHA-256；发现内容不一致时保留两份并登记。
- [ ] 2. 从本计划生成 100 项任务 ID、标题和依赖，初始均为 NOT_STARTED；状态写入不能依赖本地绝对路径。
- [ ] 3. AGENTS.md 只放入口、边界和真实验证要求，控制篇幅；不要覆盖全局规则、不要把全文计划复制进去。
- [ ] 4. 实现账本校验：重复 ID、缺依赖、依赖环、DONE 无验证记录、非法状态和绝对证据路径均拒绝。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 原稿字节原样复制 | verify-source 成功；记录原始摘要 |
| 把一个依赖改成不存在的 SG-999 | verify-tasks 非零，指向具体任务 |
| DONE 但 verification 为空 | 拒绝；不能仅凭勾选完成 |

**验证命令：**

```text
node scripts/verify-source.mjs
node scripts/verify-tasks.mjs
```

**完成门槛：** 原稿未改写；100 项账本可校验；PROGRESS 写明下一步 SG-002；用户既有改动保持原状。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-002"></a>
#### SG-002 · 建立可构建工程与真实开发检查脚本

**阶段：** M0　**前置：** SG-001　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §9.4—9.5；实施补充 E01—E02

**可独立验收的目标：** 得到一个真正可构建和可测试的空仓库基线，而不是只有文件夹。

**创建 / 修改文件：** 新增 package.json、pnpm-workspace.yaml、tsconfig.json、vitest.config.ts、eslint.config.mjs、apps/cli/src/main.ts、scripts/build.mjs、tests/unit/bootstrap.test.ts、tests/support/test-paths.ts。

**输入输出与共享接口：** 固定开发入口 node dist/cli.mjs；main(argv: string[]): Promise<number> 暂只支持 --help/--version，其他命令退出 64。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 先建立 CLI 帮助/未知命令测试；按实际环境锁 Node/pnpm 和依赖，不编造版本；需要联网安装时遵循已有授权。
- [ ] 2. 配置 strict、noUncheckedIndexedAccess；工作区内部 import 规则一致；构建能解析真实依赖而非只复制 TS。
- [ ] 3. 实现 §3.2 中已经具备的 build/typecheck/lint/test:unit 等脚本；其余入口未实现时非零说明，不返回假成功。
- [ ] 4. 建立临时目录 helper：使用系统临时目录、唯一测试根、finally 清理且只删自有目录；保存 lockfile。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 构建后执行 --help | 0，显示当前真实命令，不把未实现命令说成可用 |
| 未知参数 --made-up | 64，stderr 有原因 |
| 单测集合为空 | 测试命令非零，不允许 passWithNoTests |

**验证命令：**

```text
pnpm build
pnpm typecheck
pnpm test:unit
node dist/cli.mjs --help
```

**完成门槛：** 构建文件能脱离 tsx 运行；存在真正运行过的单测；依赖与 lockfile 一致。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-003"></a>
#### SG-003 · 定义领域基础类型、稳定 ID 与错误分类

**阶段：** M0　**前置：** SG-002　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §10—11、§13.3

**可独立验收的目标：** 统一各层对状态、错误、操作与证据的命名。

**创建 / 修改文件：** 新增 packages/contracts/src/{enums.ts,identifiers.ts,diagnostic.ts,index.ts}、schemas/0.1/common.schema.json、tests/unit/contracts/primitives.test.ts。

**输入输出与共享接口：** parseOperationKey(value: string): {service_id:string; method:string; path:string};
formatOperationKey(value: {service_id:string; method:string; path:string}): string;
// 断言：formatOperationKey(parseOperationKey('api:GET /api/performance')) === 'api:GET /api/performance'。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 实现 §4.1—4.2 精确枚举；禁止用 success 同时表达执行结束和 gate 通过。
- [ ] 2. 操作键标准采用 service:METHOD /path；解析用户任务里的简写时，仅在 service 唯一时补全，多个服务必须明确。
- [ ] 3. 校验 ID、相对路径、摘要格式；保留路径大小写/末尾斜杠语义，不把 /users 与 /users/ 私自合并。
- [ ] 4. 建立 SG-CONTRACT/CONSUMER/RUNTIME/EVIDENCE/POLICY/ENV/TOOL 分类和机器原因码，事实/解释字段分开。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 合法 operation key 往返转换 | 严格相等 |
| 未知 CheckStatus=INCOMPLETE | schema 拒绝；这是 verdict 而非 check.status |
| 字符串含控制字符或无 HTTP 方法 | 结构诊断，不拼进 shell |

**验证命令：**

```text
pnpm exec vitest run tests/unit/contracts/primitives.test.ts
pnpm typecheck
```

**完成门槛：** 状态值与原稿一致；后续模块只能复用这些导出，不重复定义同名枚举。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-004"></a>
#### SG-004 · 定义项目配置与能力声明 schema

**阶段：** M0　**前置：** SG-003　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §11.2、§12.1—12.2、§13.2

**可独立验收的目标：** 让配置样例变成能校验的明确输入合同。

**创建 / 修改文件：** 新增 schemas/0.1/{project-config,adapter-capabilities}.schema.json、packages/contracts/src/{project-config,adapter-capabilities}.ts、tests/unit/contracts/config-schema.test.ts。

**输入输出与共享接口：** validateProjectConfig(value: unknown): ValidationResult<ProjectConfig>; ValidationResult 为 {ok:true,value:T} 或 {ok:false,diagnostics:Diagnostic[]} 的联合。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 将 workspaces/contracts/commands/checks/profiles/environments/security 展开成严格对象；adapter 字段决定 checks 的联合类型。
- [ ] 2. 命令 exec 与 args 分开；timeout 为正整数；数组去重规则明确；禁止任意表达式、模糊环境插值和 unknown properties。
- [ ] 3. 保留原稿样例字段；对本计划增加的产物输出、可信策略位置、工具入口等写在 extensions 或明确 E 字段中并解释。
- [ ] 4. 生成或校验共享 TS 类型，建立 schema 类型不漂移检查；所有默认值通过配置处理器显式应用，不让验证器悄悄修改输入。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 原稿 §12.2 配置解析后校验 | 结构通过；业务引用验证另属 SG-016 |
| 未知字段 required_cheks 拼错 | 拒绝，指出 JSON pointer |
| args 为字符串、timeout=-1 | 拒绝，不能转换后放行 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/contracts/config-schema.test.ts
pnpm verify:schemas
```

**完成门槛：** 配置结构来源唯一；原稿合法示例不被无理由丢弃；新扩展有标识。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-005"></a>
#### SG-005 · 定义任务、审批输入与有效策略 schema

**阶段：** M0　**前置：** SG-004　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F02/F04/F08、§12.3、§15.4

**可独立验收的目标：** 把业务意图、执行授权和可信 CI 约束拆成不同数据对象。

**创建 / 修改文件：** 新增 schemas/0.1/{task,confirmation,policy,trust-record}.schema.json、packages/contracts/src/{task,policy,confirmation}.ts、tests/unit/contracts/task-schema.test.ts。

**输入输出与共享接口：** TaskPayload 使用原稿字段；ConfirmationRecord 包含 payload_hash/target_hashes/protected_input_hash/source；EffectivePolicy 含 required_set、origin/path predicates、minimum_provenance、approved_change_records。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 确认 revision 必须为正整数，目标和必检引用不得为空；DRAFT 文件本身不是完成审批。
- [ ] 2. 批准的兼容性变化要求 operation、规则 ID、基线/目标摘要和理由；不接受通配全部规则的免责项。
- [ ] 3. 区分 local-review 与 trusted-ci 引用；结构合法不代表来源可信，可信来源由后续 loader 验证。
- [ ] 4. 策略字段定义合并方向：必检并集、权限交集、最小来源取更严格值、保护输入不可被移除。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| DRAFT 示例 | 合法但未确认 |
| 自填 status=CONFIRMED，无独立记录 | 结构可读，门槛前置仍未满足 |
| 豁免没有目标摘要或 operation | 配置拒绝 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/contracts/task-schema.test.ts
pnpm verify:schemas
```

**完成门槛：** 业务确认不能被执行信任替代；后续脚本不能通过填身份字符串获得 trusted-ci。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-006"></a>
#### SG-006 · 定义计划、运行、检查、事件和产物 schema

**阶段：** M0　**前置：** SG-003、SG-005　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §10—11、§13.2；实施补充 E05/E08/E09

**可独立验收的目标：** 建立执行器、报告器和适配器共用的机器协议。

**创建 / 修改文件：** 新增 schemas/0.1/{input-manifest,plan,run,check-result,finding,event,artifact,environment,gate-evaluation,probe,playwright-report}.schema.json；packages/contracts/src/generated/；tests/unit/contracts/run-schema.test.ts。

**输入输出与共享接口：** CheckPlan/CheckFact/GateInput 按 §4；RunEvent={schema_version,event_id,run_id,seq,at,type,payload}；每种 type 有严格 payload。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 把 §4 全部对象字段落成 schema，含 actual attempts、缺失原因、run/step 产物归属；对未知支持能力保留显式状态。
- [ ] 2. 为 trace/screenshot 增加 sensitivity/redaction_state，不把 restricted 和 regular 混合。
- [ ] 3. 定义原始 Run 与当前 GateEvaluation 的不同文档：后者引用前者，不覆盖历史事实。
- [ ] 4. 事件 seq 从 1 单调递增；ID 不含机器用户路径；声明哪些枚举/字段在本版本严格拒绝。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 零用例 BLOCKED+NO_TESTS 的 check | 合法 |
| 缺 run_id 的 probe、重复 required_check_ids | 拒绝 |
| timestamp 无时区、artifact 为 ../secret | 拒绝 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/contracts/run-schema.test.ts
pnpm verify:schemas
```

**完成门槛：** 协议支持失败、取消、缺失和过期，不只有成功金样例。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-007"></a>
#### SG-007 · 先实现 Gate 真值表与退出码纯函数

**阶段：** M0　**前置：** SG-006　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §10.1—10.3

**可独立验收的目标：** 在 IO 和界面之前固定最关键的“不能假绿”逻辑。

**创建 / 修改文件：** 新增 packages/core/src/domain/{evaluate-gate,exit-code,aggregate-checks}.ts、tests/unit/gate/{truth-table,exit-priority}.test.ts。

**输入输出与共享接口：** evaluateGate(input: GateInput): GateEvaluation; 无 IO、无系统时间、无外部模型。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 以表驱动测试覆盖 §4.2 的所有优先级组合，包含同时报告损坏、stale、业务失败。
- [ ] 2. 必检集合按 ID 校验存在、唯一和实际执行；exit-code 的 typecheck 不要求测试计数。
- [ ] 3. 取消默认 incomplete；flaky 按固定策略 incomplete；可选失败保留事实，不凭运行结果改 required。
- [ ] 4. 把 verdict 与 freshness 独立计算；ALLOW 必须全部前提为明确 true，未知全部 deny。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| PASS checks + STALE + 真实失败 | 当前出口 4，失败事实保留 |
| 必检只有 unit，0 tests，进程 0 | INCOMPLETE/DENY/2 |
| 报告完整性 INVALID 且 stale | ERROR/DENY/3 |
| 完整成功但 deterministic_denials 非空 | DENY/1 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/gate
pnpm typecheck
```

**原稿验收关联：** T03、T15、T16、T24、T27。

**完成门槛：** 所有出口都有正反例，核心不能从项目报告中的 success 字段直接返回 ALLOW。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-008"></a>
#### SG-008 · 定义 ports、适配器能力与测试替身边界

**阶段：** M0　**前置：** SG-006、SG-007　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §9.1—9.3、§13.2

**可独立验收的目标：** 允许并行实现不同适配器，同时保持单一状态与门槛规则。

**创建 / 修改文件：** 新增 packages/core/src/ports/{git,runner,environment,evidence,adapter,clock}.ts、tests/support/fake-adapters.ts、scripts/verify-boundaries.mjs、tests/unit/ports.test.ts。

**输入输出与共享接口：** Adapter 接口按 §4.7；GitPort.capture/resolveBaseline；RunnerPort.run；EnvironmentPort.prepare/observe/cleanup；EvidenceStore.append/store/seal/read；Clock.now；IdFactory.create。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 为每个端口建立完整参数/返回类型：ProjectContext、AdapterConfig、AdapterInputs、ExecutionContext、CollectionContext、RunEvent 等不得悬空。
- [ ] 2. domain 仅接受纯对象；执行上下文提供受限写入器，不让报告 renderer 取得 runner。
- [ ] 3. fake adapters 只在 tests/support；新增边界检查阻止发行模块 import tests 或 domain import IO。
- [ ] 4. 定义能力协商：不支持工具/平台/方言则返回诊断，不自动选一个近似适配器。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 请求能力未在 describe 中声明 | 诊断为 unsupported |
| 报告模块尝试依赖 RunService.execute | 边界检查非零 |
| 同一 fake 事件重复发送 | 测试消费者只计一次 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/ports.test.ts
pnpm verify:boundaries
pnpm typecheck
```

**完成门槛：** 所有对外类型均有定义；真实适配器未开发不意味着 fake 可以用于发行。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-009"></a>
#### SG-009 · 建立三方契约与门槛金样例

**阶段：** M0　**前置：** SG-005、SG-006、SG-007　**初始状态：** NOT_STARTED

**需求依据：** 原稿 S01/S02、F05、§19；本计划 §1.3

**可独立验收的目标：** 确保团队对基线、目标、候选和业务预期的理解完全一致。

**创建 / 修改文件：** 新增 tests/fixtures/contracts/{baseline,target,candidate-wrong,candidate-correct}.json、tests/fixtures/tasks/、tests/support/factories.ts、tests/unit/fixtures.test.ts、examples/contract-drift-demo/README.md。

**输入输出与共享接口：** createGateInput(overrides?: Partial<GateInput>): GateInput 与 createCheckFact(overrides?: Partial<CheckFact>): CheckFact 按 §8.1 定义；每次返回独立副本。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 构造默认 baseline=target 的 schema，目标字段 number 类型的 data.performance.total_return；错误候选返回 string 或旧结构。
- [ ] 2. 建立有意 API 升级的独立旧→新契约及精确批准示例，避免主演示被无关兼容性规则干扰。
- [ ] 3. 提供 PASS/FAIL/INCOMPLETE/ERROR/STALE 的完整机器产物金样例，并明确全部为测试数据。
- [ ] 4. 示例 README 写出预期业务断言和故障来源；此阶段只承诺契约夹具，真实服务在 M3 实现。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 正确候选对目标 | 行为投影应相同 |
| 删除必需字段/number 改 string | 夹具必须保留这些真实差异 |
| 对一个 fixture 就地修改 | 其他测试读到的副本不受影响 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/fixtures.test.ts
pnpm verify:schemas
```

**完成门槛：** 每个金样例可解析且 schema 合法；测试不以手写 success 字符串证明真实业务运行。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-010"></a>
#### SG-010 · 固定真实工具基线与 M0 出口

**阶段：** M0　**前置：** SG-002、SG-008、SG-009　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §21.2、§22；本计划 §3.3

**可独立验收的目标：** 把“具体版本需验证”变成必须有记录的实施动作。

**创建 / 修改文件：** 新增 tools/compatibility-lock.json、docs/COMPATIBILITY.md、scripts/verify-stage.mjs、tests/fixtures/stages/M0.json、docs/adr/ADR-010-implementation-baseline.md。

**输入输出与共享接口：** 每条工具记录 name/version/platform/source/integrity/tested_capabilities/status；stage runner 只调用已登记的检查脚本并传播非零。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 从当前实际安装与官方来源取得 Node/pnpm/TS/Ajv/Vitest 版本；oasdiff 和 Playwright 未装时记录 UNKNOWN，不造已测记录。
- [ ] 2. 锁定 build/test 依赖并保存完整性；所有新安装行为遵循环境授权，不能运行搜索结果中的未知安装脚本。
- [ ] 3. 实现 M0 stage manifest 的真实检查序列：source、tasks、schemas、boundaries、build、typecheck、unit。
- [ ] 4. 检查阶段产物与原稿三方概念；未满足条件写 blocker，不通过删除检查取得出口。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 工具不存在 | 能力 UNKNOWN，需该工具的阶段不能通过 |
| stage 子命令非零 | stage 非零并保留失败命令 |
| M0 全部检查成功 | 记录实际版本与日志后进入 M1 |

**验证命令：**

```text
pnpm verify:stage -- --stage M0
```

**完成门槛：** 具备真实工程与合同基线；没有空成功脚本；版本不使用 latest 当作锁。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。


### M1 阶段任务

<a id="sg-011"></a>
#### SG-011 · 实现安全路径、字节摘要与基础原子写

**阶段：** M1　**前置：** SG-003、SG-008、SG-010　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F03、§11.4、§16

**可独立验收的目标：** 为输入、状态和产物建立统一的安全文件边界。

**创建 / 修改文件：** 新增 packages/core/src/storage/{safe-path,hash,canonical-json,atomic-write}.ts、tests/unit/storage/{paths,hash,atomic-write}.test.ts。

**输入输出与共享接口：** resolveWithin(root:string,relative:string): Promise<string>; hashBytes(bytes:Uint8Array):string; canonicalJson(value:unknown):string; writeJsonAtomic(path:string,value:unknown):Promise<void>。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 拒绝绝对路径、.. 越界、NUL 和目录符号链接逃逸；处理 Windows UNC、盘符和大小写冲突；UTF-8 无法可靠表达的 Git 路径显式不支持。
- [ ] 2. 源码摘要使用原始字节；JSON 排序对象 key、不任意重排数组、不接受 NaN/Infinity；集合由调用方显式规范化。
- [ ] 3. 创建同目录临时文件后原子替换；确认父目录与目标仍在允许根内；不覆盖用户已有非归属文件。
- [ ] 4. 对符号链接记录 link 内容及已验证的目标；无法证明安全的输入产生缺口而非跳过。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 中文/空格/CRLF 文件 | 路径保真、字节摘要稳定 |
| 修改 LF 为 CRLF | 源码 hash 改变 |
| 链接指向仓库外 | 拒绝读取 |
| 中途写失败 | 原目标保持可读或明确失败，不留下半份 JSON |

**验证命令：**

```text
pnpm exec vitest run tests/unit/storage
pnpm typecheck
```

**原稿验收关联：** T20、T22。

**完成门槛：** 后续模块不再各自拼路径、算不一致摘要或直接写半份 manifest。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-012"></a>
#### SG-012 · 实现 Git 仓库身份与固定基线解析

**阶段：** M1　**前置：** SG-008、SG-011　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F03、§10.4、T14

**可独立验收的目标：** 准确知道正在测哪个仓库和哪个比较基线。

**创建 / 修改文件：** 新增 packages/adapter-git/src/{git-command,repository,baseline}.ts、tests/support/git-repo.ts、tests/integration/git/baseline.test.ts。

**输入输出与共享接口：** resolveBaseline(request:{project_root:string;target_ref:string;head_ref?:string}):Promise<Baseline>; Baseline 保存固定 base_oid/head_oid/target_tip_oid 与 git_object_format。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 使用受信 Git 可执行路径和参数数组；必要时关闭外部 diff/textconv/fsmonitor 等会执行仓库配置的路径；不自动 fetch。
- [ ] 2. 读取顶层、common dir、worktree、对象格式；本地身份保存为不含路径原文的标识；无 Git 或 unresolved merge 给具体错误。
- [ ] 3. 解析目标 ref 到固定 tip，求 merge-base；多个共同基线或对象缺失不静默选择最近提交。
- [ ] 4. 建立真实临时 Git repo helper，支持多个提交、分支、detached HEAD、worktree 和目标前进的测试构造。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 目标分支比 HEAD 新 | 记录真实 merge-base 和目标 tip |
| shallow clone 缺对象 | 明确基线缺失，不能降级 HEAD~1 |
| 路径以 - 开头 | 按路径处理，不注入选项 |
| detached HEAD | 有明确 head_oid |

**验证命令：**

```text
pnpm exec vitest run tests/integration/git/baseline.test.ts
```

**原稿验收关联：** T14、T22。

**完成门槛：** 记录的是固定 OID，不以 origin/main 字符串冒充不可变基线。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-013"></a>
#### SG-013 · 捕获完整被测输入与脏工作区变化

**阶段：** M1　**前置：** SG-011、SG-012　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F03、§10.4、§11.2

**可独立验收的目标：** 纳入暂存、未暂存和未跟踪源码，不让旧报告漏判变更。

**创建 / 修改文件：** 新增 packages/adapter-git/src/{input-manifest,change-set,file-inventory}.ts、tests/integration/git/input-manifest.test.ts。

**输入输出与共享接口：** captureInputs(project:ProjectContext,baseline:Baseline,scope:InputScope):Promise<InputManifest>; files 含路径/类型/字节 hash/mode/source_state。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 使用 -z 格式读取 Git 文件/状态，按实际工作区最终字节构造输入；单独保存 staged/unstaged 解释清单。
- [ ] 2. 将范围内 untracked 纳入，deleted 保存 tombstone；排除 .git、state、已声明缓存/构建产物和凭证值。
- [ ] 3. 解析用户明确纳入的 ignored 构建输入；无法确认关键输入或生成源时 completeness=UNVERIFIED。
- [ ] 4. 检测冲突、submodule、LFS pointer/缺失对象、超限文件和越界链接；P0 阻塞受影响验收，不透明放行。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 同一文件 staged 为 A、工作区为 B | 被测字节为 B，并说明两份变化 |
| 新增未跟踪前端文件 | input_hash 改变 |
| 只改依赖锁 | input_hash 改变 |
| 删除输入文件 | 有 tombstone，不忽略 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/git/input-manifest.test.ts
```

**原稿验收关联：** T12、T13、T22。

**完成门槛：** 输入范围/排除项可解释；不是仅 git diff 输出摘要。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-014"></a>
#### SG-014 · 实现新鲜度与目标分支推进策略

**阶段：** M1　**前置：** SG-007、SG-013　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §10.4、T12—T14

**可独立验收的目标：** 让计划/报告能在代码、目标分支、任务或策略变化后明确失效。

**创建 / 修改文件：** 新增 packages/core/src/domain/{compare-inputs,evaluate-freshness}.ts、tests/unit/freshness.test.ts、tests/integration/git/target-advance.test.ts。

**输入输出与共享接口：** evaluateFreshness(recorded:EvidenceIdentity,current:EvidenceIdentity,requirements:FreshnessRequirements):FreshnessResult; 返回 FRESH/STALE/UNVERIFIED 和字段级原因。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 比较 repo/worktree/platform、base/head/target tip、input/task/target/policy/toolchain/environment requirements 等声明输入。
- [ ] 2. 目标 tip 是否必须最新由已确认 CI 策略决定；要求最新时本地 ref 未更新只能 UNVERIFIED，不偷偷联网更新。
- [ ] 3. 运行前后 input 不同将当前 run 标失效；文档排除必须是显式范围配置。
- [ ] 4. 时间戳仅用于配置的 TTL，不把“刚执行”作为 freshness 证据；产物目录变化不污染源码快照。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 代码同 SHA，但未跟踪源码变更 | STALE |
| 目标 ref 前进，严格策略要求最新 | STALE 或缺可信 tip 时 UNVERIFIED |
| 临时环境正常清理 | 历史环境证据仍可评估，不仅因服务下线 stale |

**验证命令：**

```text
pnpm exec vitest run tests/unit/freshness.test.ts tests/integration/git/target-advance.test.ts
```

**原稿验收关联：** T12、T13、T14、T23。

**完成门槛：** 新鲜度有逐字段原因，不通过 mtime 或单一 commit SHA 判断。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-015"></a>
#### SG-015 · 实现只读项目识别与 doctor

**阶段：** M1　**前置：** SG-004、SG-011、SG-012　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F01、§4、§13.1

**可独立验收的目标：** 首次使用可发现配置缺口，且不触发安装、业务 import 或服务启动。

**创建 / 修改文件：** 新增 packages/core/src/services/project-service.ts、packages/core/src/domain/capability-discovery.ts、apps/cli/src/commands/doctor.ts、tests/integration/cli/doctor.test.ts。

**输入输出与共享接口：** ProjectService.inspect(root:string):Promise<CapabilitiesReport>; 结果包括 capabilities/missing/unsupported/conflicts，不包含验收 PASS。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 限定读取根 manifest、Git 文件清单、已配置目录；识别前端/API/测试/OpenAPI 和工具入口。
- [ ] 2. 检查命令声明/可执行文件是否存在，不执行 npm lifecycle、Python import、tsconfig 指向的插件脚本。
- [ ] 3. 展示相对路径、缺少 OpenAPI、同名配置冲突、未测平台；安全的工具版本探测与业务执行区分。
- [ ] 4. 输出 JSON stdout 和简明终端说明；默认不写业务文件、state 或安装记录。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| package.json 的 postinstall 会写文件 | doctor 不触发该脚本 |
| 缺 OpenAPI/无 Docker | 列出缺口，不自动安装 |
| 中文目录且存在无效项目配置 | 具体诊断，不扫描父盘 |

**验证命令：**

```text
pnpm build
pnpm exec vitest run tests/integration/cli/doctor.test.ts
```

**原稿验收关联：** T22。

**完成门槛：** 只读前后文件快照一致；没有把工具存在误写为测试可通过。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-016"></a>
#### SG-016 · 实现严格配置解析与不可放宽策略合并

**阶段：** M1　**前置：** SG-004、SG-005、SG-011、SG-015　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §12.1、§15.4、T27

**可独立验收的目标：** 让用户配置和可信约束组合后仍然保持最严格的安全与验收要求。

**创建 / 修改文件：** 新增 packages/core/src/services/config-service.ts、packages/core/src/domain/{merge-policy,resolve-references}.ts、tests/unit/config/{parse,merge}.test.ts。

**输入输出与共享接口：** loadConfiguration(path:string):Promise<ProjectConfig>; mergePolicy(defaults,repo,local,ci):EffectivePolicy；来源信息跟随每项有效约束。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 采用能报告重复 key 的 YAML 解析；限制文件大小/嵌套/alias 扩张；禁止自定义执行标签和 eval。
- [ ] 2. 验证 workspace/command/check/environment 引用、循环依赖和参数来源；结构错误为 64。
- [ ] 3. 必检并集、origin 权限交集、路径以所有权限谓词同时满足判定，不错误地做 glob 字符串交集；最低 provenance 取更严格值。
- [ ] 4. 仓库候选修改与 CI 保护约束冲突给出具体字段和来源；CLI 参数不能删除必检或打开生产权限。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| YAML 重复 timeout | 64 |
| 候选把 required_checks 置空 | 可信必检仍保留，尝试降级报告冲突 |
| 两个允许路径 glob 有交叉 | 具体路径必须同时匹配两者 |
| 循环/未知检查引用 | 64 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/config
pnpm typecheck
```

**原稿验收关联：** T27。

**完成门槛：** 配置合并是可测试纯规则；没有最后一个配置直接覆盖安全字段。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-017"></a>
#### SG-017 · 实现不可变任务 revision 与本地确认

**阶段：** M1　**前置：** SG-005、SG-011、SG-013、SG-016　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F02、F05、F08、§12.3；E06

**可独立验收的目标：** 固定目标契约与验收意图，阻止实现过程中悄悄改标准。

**创建 / 修改文件：** 新增 packages/core/src/services/task-service.ts、packages/core/src/storage/task-revisions.ts、apps/cli/src/commands/task.ts、tests/integration/tasks/confirm.test.ts。

**输入输出与共享接口：** TaskService.validate(file); TaskService.confirm(file,expected_payload_hash,review_context); TaskService.loadConfirmed(task_id,revision)。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. validate 只校验结构/引用并给出待确认摘要；confirm 必须精确匹配该摘要和当前目标字节。
- [ ] 2. 将目标、任务 payload、保护输入和确认来源写入新 revision 的不可变目录；再次确认相同输入幂等，不覆盖旧内容。
- [ ] 3. 更改目标/必检/断言/例外使旧确认不再适用；要求新 revision 并显示差异，不能自动重写旧结果。
- [ ] 4. 本地人机确认记录不自称签名；非 TTY 需要明确摘要和已授权上下文，不能静默确认。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 只把 YAML status 改成 CONFIRMED | 不能通过完整验收 |
| 确认后修改 target | 旧计划 stale/需新确认 |
| 用户确认同一 revision 同一摘要两次 | 不破坏历史 |
| 确认时文件被改动 | 拒绝 TOCTOU 不一致 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/tasks/confirm.test.ts
```

**原稿验收关联：** T04、T23。

**完成门槛：** 目标来自不可变副本，且工作区目标变更可检测；确认与业务脚本执行授权分离。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-018"></a>
#### SG-018 · 实现执行预览与仓库外本地信任记录

**阶段：** M1　**前置：** SG-011、SG-016、SG-017　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F04、§16；E11/E14

**可独立验收的目标：** 执行前让用户知道将运行哪些命令、访问哪些目标和写哪些位置。

**创建 / 修改文件：** 新增 packages/core/src/services/trust-service.ts、packages/core/src/storage/user-trust-store.ts、apps/cli/src/commands/trust.ts、tests/integration/trust/review.test.ts。

**输入输出与共享接口：** buildExecutionPreview(config,policy,tools):ExecutionPreview；TrustRecord 绑定 repo/worktree、配置摘要、解析后的工具身份、命令集合和允许目标。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 预览 executable/argv/cwd、环境变量名称、网络目标、Docker 操作、可写路径与超时，不展示变量密钥值。
- [ ] 2. 信任存储位于操作系统用户数据目录而非候选仓库，按平台隔离；改变命令、工具路径、网络权限后重新确认。
- [ ] 3. 把脚本内容变化纳入执行预览的相关输入摘要；本地提示不能防同身份恶意进程，说明边界。
- [ ] 4. 实现 trust --review、--confirm-digest 和 §7.8 的机器预览字段；CI loader 在 M4 独立实现，不能通过伪 CI 环境变量复用本地信任。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 确认后 args 指向新脚本 | 信任失配 |
| 环境变量含秘密 | 仅显示名称 |
| 从另一 worktree 复制 trust.json | 身份不匹配 |
| 无 TTY 无显式摘要 | 不执行 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/trust/review.test.ts
```

**完成门槛：** 未授权不启动业务进程；信任提示不被宣传为安全沙箱。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-019"></a>
#### SG-019 · 实现 OpenAPI 安全加载与已测子集预检

**阶段：** M1　**前置：** SG-006、SG-011、SG-016　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F05/F06、§16.2；官方 W06/W07/W10

**可独立验收的目标：** 在第三方解析器读取规范之前阻断外部引用、未知方言与不支持结构。

**创建 / 修改文件：** 新增 packages/adapter-oasdiff/src/{load-contract,inspect-refs,supported-schema,operation-scope}.ts、tests/unit/openapi/safe-loader.test.ts。

**输入输出与共享接口：** loadContract(bytes,source):LoadedContract；inspectSupportedSchema(contract,operation_scope):CapabilityDiagnostics。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 先严格解析 JSON/YAML，再遍历完整文档检查 $ref；P0 只允许同文档 # 片段，不访问 URL、文件或内网。
- [ ] 2. 验证 3.1 系列、基本对象/数组/required/type/enum/null、本地片段和简单 T|null 联合；复杂 oneOf/allOf、动态引用、条件和递归未测构造返回 UNSUPPORTED_SCHEMA。
- [ ] 3. 有影响的操作与目标必检范围递归分析引用；无法确认影响时保守扩大；安全引用检查不只限目标操作。
- [ ] 4. 限制文档大小、深度和引用遍历次数；声明不支持的 format/annotation 不静默变成校验通过。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| external HTTP ref 指向本地监听服务器 | 服务器收到 0 次请求 |
| 本地片段引用不存在 | 具体 pointer 诊断 |
| 复杂 oneOf 影响必检操作 | INCOMPLETE 而非 PASS |
| 简单 number\|null | 仅已测规则范围通过预检 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/openapi/safe-loader.test.ts
```

**原稿验收关联：** T07、T20。

**完成门槛：** 外部 ref 在任何外部工具执行前拒绝；支持范围有精确能力表。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-020"></a>
#### SG-020 · 适配真实 oasdiff 并保存原始发现

**阶段：** M1　**前置：** SG-008、SG-018、SG-019　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F05/F06、§9.4；官方 W06/W07

**可独立验收的目标：** 复用可靠差异工具而不重新发明全套兼容性语义。

**创建 / 修改文件：** 新增 packages/adapter-oasdiff/src/{tool,breaking,diff,normalize-findings}.ts、tests/contract/oasdiff.test.ts、tests/fixtures/oasdiff/。

**输入输出与共享接口：** OasdiffAdapter.diff(base,target):Promise<ContractDiff>; breaking(base,target):Promise<CompatibilityFinding[]>；记录真实版本及原始 JSON。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 用实际锁定版本的 --help 和样例核对命令/退出码/JSON；至少调用一次真实二进制，不能只模拟 stdout。
- [ ] 2. 参数显式包含 --allow-external-refs=false（必须用等号形式）；输入仅为审核后的临时契约文件。
- [ ] 3. 把工具规则 ID 映射为稳定 SG-CONTRACT 分类并保留原始 ID；工具错误与业务 breaking 分开。
- [ ] 4. 不自动使用 upgrade、auto-upgrade 或 flatten-allof 改写方言；工具缺失/版本不支持是能力缺口。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 字段删除/请求新增必填/响应枚举扩张 | 按方向保存真实工具发现 |
| 格式有效但未知工具 JSON 结构 | ERROR，不猜解析 |
| 工具未安装 | 该检查 BLOCKED，不返回空发现假通过 |

**验证命令：**

```text
pnpm exec vitest run tests/contract/oasdiff.test.ts
pnpm test:contract
```

**原稿验收关联：** T05、T06、T07、T20。

**完成门槛：** 至少有真实外部工具合同测试与版本记录；原始发现可追溯。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-021"></a>
#### SG-021 · 实现三方契约编排与精确批准变化

**阶段：** M1　**前置：** SG-017、SG-019、SG-020　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F05/F06/F16、§12.2；本计划 §2.1

**可独立验收的目标：** 区分兼容性、安全批准和当前实现对齐，不让改规范自动修绿。

**创建 / 修改文件：** 新增 packages/core/src/domain/{contract-policy,contract-projection}.ts、packages/core/src/services/contract-service.ts、tests/unit/openapi/three-way.test.ts、tests/integration/contracts/three-way.test.ts。

**输入输出与共享接口：** compareThreeWay({baseline,target,candidate,task,policy}):ContractAssessment；compatibility、implementation_alignment、runtime_validation 分字段。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 基线→目标执行 compatibility；只匹配经确认的 operation/rule/base_hash/target_hash 批准记录。
- [ ] 2. 目标→候选比较支持范围的行为投影，包含 operation、状态/媒体类型、schema、参数和安全声明；仅明确的非行为元数据可忽略。
- [ ] 3. 保留 raw hash 用于新鲜度；语义相同不意味原确认文件可任意改写。
- [ ] 4. 把候选缺失、导出错误、未授权目标变化分开；不能用候选契约覆盖 target 后继续比较。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 两份互相非 breaking 但目标新增行为未实现 | alignment 仍 FAIL |
| 批准记录只覆盖某个 operation | 其他破坏性变化仍拒绝 |
| target 文件后来改变 | 当前 plan 不可继续 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/openapi/three-way.test.ts tests/integration/contracts/three-way.test.ts
```

**原稿验收关联：** T04、T05、T06。

**完成门槛：** 报告有三方来源和不同结论，不仅一个 diff 是否为空。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-022"></a>
#### SG-022 · 实现请求/响应方向的严格 schema 校验

**阶段：** M1　**前置：** SG-019、SG-021　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F06/F11、§9.4；官方 W10

**可独立验收的目标：** 为真实 probe 做不强制转换、不偷偷补值的数据验证。

**创建 / 修改文件：** 新增 packages/adapter-oasdiff/src/{runtime-validator,direction-projection}.ts、tests/unit/openapi/runtime-validator.test.ts。

**输入输出与共享接口：** validatePayload({contract,operation_key,direction,status_code,media_type,payload}):PayloadValidation；返回 violations JSON pointer 与 supported 状态。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 使用 Ajv 2020-12，关闭 coerceTypes、useDefaults、removeAdditional；无法识别方言/格式先输出能力缺口。
- [ ] 2. 按请求与响应方向处理 readOnly/writeOnly 的 required 语义；对状态码和媒体类型先选择正确 schema。
- [ ] 3. 支持清单逐项测试基本对象、数组、必填、enum、null、布尔 additionalProperties 和已声明简单联合；不支持特性不转为 any。
- [ ] 4. 业务断言留给测试，不把 schemaValid 当“收益显示正确”；原始合成 payload 供核心复验但先去敏。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| number 实际是字符串 | FAIL，payload 不被修改 |
| required 缺失或不允许 null | 具体 pointer 失败 |
| 响应中只读字段 required | 按响应要求校验 |
| 未知复杂格式参与必检 | INCOMPLETE |

**验证命令：**

```text
pnpm exec vitest run tests/unit/openapi/runtime-validator.test.ts
```

**原稿验收关联：** T05、T06、T07。

**完成门槛：** 验证器无输入副作用；请求和响应方向不混用。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-023"></a>
#### SG-023 · 实现显式消费者映射与已知覆盖关系

**阶段：** M1　**前置：** SG-003、SG-013、SG-016　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F07

**可独立验收的目标：** 先建立可靠的 API→客户端→模块→验收检查关系。

**创建 / 修改文件：** 新增 schemas/0.1/mappings.schema.json、packages/adapter-typescript/src/{explicit-mappings,impact-graph}.ts、tests/unit/impact/mappings.test.ts。

**输入输出与共享接口：** loadMappings(config,inventory):ImpactGraph；节点类型 operation/client/module/test/workspace，边带 origin 与 confidence=EXPLICIT|GENERATED|STATIC_CANDIDATE。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 映射文档包括 operation_key、consumer_paths、check_ids、test_ids 和 workspace；所有引用必须存在或明确 missing。
- [ ] 2. 规范操作键不依赖 operationId 恒定；generated client 元数据仅在明确提供时使用。
- [ ] 3. 输出 known/candidate/unresolved 三集合，不生成无依据百分比。
- [ ] 4. 映射的失效路径产生缺口并触发回归，不把该消费者删除出影响范围。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 映射路径被删但 operation 仍变更 | unresolved，而不是无影响 |
| operationId 改名但方法路径相同 | 仍可稳定关联 |
| 同一 test 映射多操作 | 去重选择，保留多个来源 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/impact/mappings.test.ts
```

**原稿验收关联：** T08、T09。

**完成门槛：** 用户可追踪每条关联的来源，首版不依赖完整静态图才有价值。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-024"></a>
#### SG-024 · 实现有限 TypeScript 静态关联

**阶段：** M1　**前置：** SG-023　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F07、§9.4

**可独立验收的目标：** 补充常见静态模式，同时把不确定性保留下来。

**创建 / 修改文件：** 新增 packages/adapter-typescript/src/{program,literal-calls,imports}.ts、tests/unit/impact/typescript.test.ts、tests/fixtures/ts-impact/。

**输入输出与共享接口：** analyzeTypeScript(scope,compiler_options):StaticImpactResult；只读解析，不执行 TS 插件或仓库脚本。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 使用 Compiler API 解析被配置工作区文件；实现 import/export、静态字符串 fetch、明确配置的客户端包装器。
- [ ] 2. 路径别名只在已解析 tsconfig 静态字段支持范围内处理；不 require 自定义 JS 配置或插件。
- [ ] 3. 动态模板 URL、依赖注入客户端、跨语言消费者、无法解析别名均留 unresolved。
- [ ] 4. 该图只能增加检查或触发回退，不能删除显式必检和回归。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| fetch("/api/performance") | 静态候选关联 |
| fetch(base + dynamicPath) | unresolved |
| 类型文件改动 | 传递导入的相关模块可列出 |
| tsconfig 引入执行插件 | 不执行，给限制 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/impact/typescript.test.ts
```

**原稿验收关联：** T08、T09。

**完成门槛：** 有可信范围说明；动态情况不静默视为安全。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-025"></a>
#### SG-025 · 实现影响汇总与保守测试选择

**阶段：** M1　**前置：** SG-021、SG-023、SG-024　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F07/F09

**可独立验收的目标：** 把变更范围转成之后执行器可使用的有效必检集合。

**创建 / 修改文件：** 新增 packages/core/src/domain/{select-checks,aggregate-impacts}.ts、tests/unit/impact/selection.test.ts。

**输入输出与共享接口：** selectChecks(task,policy,impacts,configured_checks):SelectionResult；required 集合为任务/策略必检并集加映射及回退检查。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 显式必检永远保留，映射只新增不缩小；去重不丢失来源和稳定 test ID。
- [ ] 2. 未知消费者影响使用受确认的 workspace-regression 集；缺少该集生成 coverage_gap。
- [ ] 3. 记录为什么选择每一项以及哪些影响无法覆盖；扫描不自动承诺“全库无漏检”。
- [ ] 4. 可选测试失败的策略在计划前固定，不在结果汇总时改变。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 没有变更但任务指定 e2e 必检 | 仍选择 e2e |
| 未知影响+回归集 | 回归选中，分析缺口仍可见 |
| 未知影响+无回归集 | INCOMPLETE 前置原因 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/impact/selection.test.ts
```

**原稿验收关联：** T08、T09。

**完成门槛：** 任何选择优化都不能移除可信必检；每个 gap 可追溯。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-026"></a>
#### SG-026 · 实现验收输入与测试漂移检测

**阶段：** M1　**前置：** SG-013、SG-017、SG-025　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F08、§16.1

**可独立验收的目标：** 发现通过删测试、改标准、改 Mock 来制造绿色结果的行为。

**创建 / 修改文件：** 新增 packages/core/src/domain/{protected-input-drift,test-inventory-drift}.ts、tests/unit/policy/drift.test.ts。

**输入输出与共享接口：** detectAcceptanceDrift(confirmed,current):DriftFinding[]；确定性 known patterns 与 REVIEW_REQUIRED 分开。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 比較已确认 protected-inputs、必检 IDs、最小执行数、检查 adapter/result_kind 和 target 配置摘要。
- [ ] 2. 已知删除、skip、only、目标改 Mock 等模式输出明确发现；无法判断断言是否削弱的修改一律要求审查，不声称语义完全理解。
- [ ] 3. approved change 仅匹配已确认 revision 的具体输入，不因确认过别的变更自动认可。
- [ ] 4. 没有实际运行 inventory 时不能断言全部 tests executed；该项在 M3 reporter 联动补证。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 删除必检/改 test ID | 缺失或未批准漂移 |
| 把 unit result_kind 改 exit-code | 拒绝降低验证要求 |
| 改断言但语义不明确 | REVIEW_REQUIRED，严格 deny |

**验证命令：**

```text
pnpm exec vitest run tests/unit/policy/drift.test.ts
```

**原稿验收关联：** T03、T04。

**完成门槛：** 确定变化与疑似语义漂移分开；测试修改不能被默认为合理。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-027"></a>
#### SG-027 · 实现安全初始化与静态 CLI 主流程

**阶段：** M1　**前置：** SG-015、SG-016、SG-017、SG-018、SG-021、SG-025、SG-026　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §4、F01、§13.1

**可独立验收的目标：** 让用户从一个命令进入真实只读扫描，而不是手动拼模块。

**创建 / 修改文件：** 新增 apps/cli/src/commands/{init,scan,task,trust}.ts、packages/core/src/services/scan-service.ts、presets/fastapi-react/config.template.yaml、tests/integration/cli/static-workflow.test.ts。

**输入输出与共享接口：** init/doctor/task validate/task confirm/trust --review/scan；scan JSON 输出差异、影响、检查缺口，命令成功≠gate PASS。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. init 默认输出新增文件/冲突/权限预览；apply 只写显示过且未冲突的文件，不安装依赖。
- [ ] 2. 所有生成任务保持 DRAFT；state gitignore 更新以独立显式补丁展示，不能覆盖用户已有规则。
- [ ] 3. 接通 source/target 静态比较与 mapping；candidate 导出需要执行权限时显示尚未执行，不在 scan 偷跑。
- [ ] 4. 实现 stdout JSON 独占、stderr 进度、相对路径、稳定诊断，输出所有当前真实可用命令。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| init --dry-run 前后 snapshot | 无变动 |
| init --apply 两次 | 第二次显示冲突/无变更，不覆盖 |
| scan 检出 breaking | 可以成功返回数据 0，但无 ALLOW |
| 执行路径中文空格 | 保持参数完整 |

**验证命令：**

```text
pnpm build
pnpm exec vitest run tests/integration/cli/static-workflow.test.ts
```

**原稿验收关联：** T22、T24。

**完成门槛：** 首次只读路径端到端可用；无生成伪候选或伪绿色报告。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-028"></a>
#### SG-028 · 完成只读阶段验收与故障说明

**阶段：** M1　**前置：** SG-014、SG-019、SG-020、SG-022、SG-027　**初始状态：** NOT_STARTED

**需求依据：** 原稿 M1、F01—F08

**可独立验收的目标：** 证明只读能力正确，且没有悄悄进入执行阶段。

**创建 / 修改文件：** 新增 tests/integration/stages/m1.test.ts、tests/fixtures/stages/M1.json、docs/implementation/evidence/M1-summary.md。

**输入输出与共享接口：** M1 stage 运行真实 Git/oasdiff fixture、配置/确认/扫描入口和安全读取测试；不会声称 runtime 已通过。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 建立恶意 postinstall/Python import 哨兵文件测试，M1 所有入口不触发。
- [ ] 2. 测无基线、unsupported schema、untracked、目标变更、未知消费者、中文路径的完整报告。
- [ ] 3. 核对每个 P0 F01—F08 功能在当前阶段已实现和仍需 runtime 补充的范围，记录不完整项。
- [ ] 4. 把真实命令和退出码写进阶段记录，后续只加载这些接口摘要而非再次全仓扫描。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| M1 成功 | 静态能力通过，runtime 明确 NOT_EXECUTED |
| oasdiff 不可用 | 阶段不能伪通过 |
| 候选脚本有副作用 | 哨兵始终未创建 |

**验证命令：**

```text
pnpm verify:stage -- --stage M1
```

**完成门槛：** M1 可复现；进入 M2 前共享字段和枚举冻结，接口变更需同步 tests/schema。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。


### M2 阶段任务

<a id="sg-029"></a>
#### SG-029 · 建立 Run 目录、原子存储与幂等事件日志

**阶段：** M2　**前置：** SG-006、SG-008、SG-011、SG-028　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §11.3—11.4、F13

**可独立验收的目标：** 让每次运行都有独立、可追踪、失败后仍可读取的存储。

**创建 / 修改文件：** 新增 packages/core/src/storage/{evidence-store,event-journal,run-layout}.ts、tests/integration/storage/store.test.ts。

**输入输出与共享接口：** FileEvidenceStore.createRun/appendEvent/writeCheck/readRun；每条事件严格验证 run_id/event_id/seq/schema_version。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 按原稿 state/plans/runs 布局创建独立目录；运行中以临时文件原子更新，完成后事实文件只读语义。
- [ ] 2. JSONL 每行独立 schema；最后一行被截断时标日志不完整，不能悄悄丢弃后宣布完整。
- [ ] 3. 重复 event_id 不重复计数；同 seq 不同内容、事件跨 run、非法状态顺序均诊断。
- [ ] 4. state_dir 支持显式仓库外目录，但需独立信任与写边界；不得让任意配置指到用户主目录后清理。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 同一个 check.finished 重放两次 | 执行计数不增加 |
| 崩溃留下半行事件 | 可读既有证据，run 未完成 |
| 两个 run 相同产物名称 | 各自在独立目录，互不覆盖 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/storage/store.test.ts
```

**完成门槛：** 存储可诊断部分失败；不以文件存在替代完整性。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-030"></a>
#### SG-030 · 实现日志脱敏、产物分级与容量预算

**阶段：** M2　**前置：** SG-011、SG-029　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F13/F14、§16.3、§17.1；E12

**可独立验收的目标：** 证据既可用于排错，又不默认泄露凭证或挤满磁盘。

**创建 / 修改文件：** 新增 packages/core/src/storage/{redactor,artifact-writer,budget}.ts、tests/security/{redaction,artifact-budget}.test.ts。

**输入输出与共享接口：** ArtifactWriter.store({kind,sensitivity,source,run_id,check_id}):Promise<ArtifactRef>; RedactionStream 跨 chunk 保留有限上下文。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 结构化删除 Authorization/Cookie/Set-Cookie/数据库密码等值，文本遮盖已知本次秘密；不把原始敏感日志先写常规目录再清理。
- [ ] 2. 对跨 chunk、多字节 UTF-8、ANSI 控制符和日志中的 Markdown 指令做安全输出；未知敏感结构可以拒绝保留或放 restricted。
- [ ] 3. 总预算默认 100 MB，预留结构证据；超限丢非关键大附件前记录原因，关键报告无法保存则 completeness 未满足。
- [ ] 4. manifest 保存已存字节摘要、大小、截断与敏感等级；不存秘密的普通 hash 以免低熵密钥被猜测。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| Authorization 在两个流块中被拆开 | 常规落盘无原值 |
| 大量 stdout 占满预算 | 失败断言/退出码仍有记录；缺证据不可 PASS |
| 截图/trace 含页面数据 | 默认 restricted，不进入 handoff |
| 日志有终端转义 | 报告安全转义 |

**验证命令：**

```text
pnpm exec vitest run tests/security/redaction.test.ts tests/security/artifact-budget.test.ts
```

**原稿验收关联：** T21。

**完成门槛：** 脱敏与截断状态可见；不宣传能自动彻底脱敏截图。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-031"></a>
#### SG-031 · 实现完成封存与证据完整性校验

**阶段：** M2　**前置：** SG-029、SG-030　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §10.4、§11.2、§16.4

**可独立验收的目标：** 防止半写报告、替换附件或外部 success 字段影响门槛。

**创建 / 修改文件：** 新增 packages/core/src/storage/{seal-run,verify-run,integrity-index}.ts、tests/integration/storage/integrity.test.ts。

**输入输出与共享接口：** sealRun(run_id):Promise<RunSeal>; verifyRun(run_id):Promise<IntegrityResult>; seal 摘要排除自身并包含所有必需事实文件及产物索引。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. FINALIZING 时验证 check/事件/产物引用全可解析，写 checks/findings/environment，再写封存索引，最后发布完成 manifest。
- [ ] 2. 核对每个 artifact 的路径、字节摘要、所属 run/check、必要性；不能只看 mtime 或 JSON 中 success。
- [ ] 3. 报告渲染失败不篡改事实；关键证据缺失使 ERROR/INCOMPLETE，按原因而非统一吞错。
- [ ] 4. 后续 gate evaluation 另存，禁止覆盖已封存 run；原始 trace 和报告不是密码学可信证明。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 完成后改 checks.json 的 FAIL 为 PASS | 完整性校验 INVALID，gate 3 |
| 删除必需附件 | 相关完整性失败 |
| renderer 报错 | 已有事实仍能独立读取 |
| 清理临时环境 | 不删除被引用的证据 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/storage/integrity.test.ts
```

**原稿验收关联：** T15。

**完成门槛：** 完整性、业务成功与新鲜度分别判定；没有自引用哈希循环。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-032"></a>
#### SG-032 · 实现跨平台命令解析与最小环境变量

**阶段：** M2　**前置：** SG-008、SG-018、SG-028　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F09、§13.2、§15.1；E11；官方 W05

**可独立验收的目标：** 把已授权的命令声明转成安全、可追踪的进程启动参数。

**创建 / 修改文件：** 新增 packages/core/src/services/command-resolver.ts、packages/core/src/domain/environment-filter.ts、tests/compatibility/command-resolver.test.ts。

**输入输出与共享接口：** resolveCommand(command,tools,platform):ResolvedCommand {executable,args,cwd,env,identity}; 生产启动默认 shell:false。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 解析可执行路径并校验属于已确认工具身份，拒绝仓库放置的假 git/npm 抢占 PATH；保留用户允许的 PATH 来源。
- [ ] 2. Windows 对已测 npm/pnpm wrapper 解析真实 JS 入口后用受信 node.exe 执行；未知 .cmd/.bat 明确不支持并给手动登记方案。
- [ ] 3. 只传 PATH/SystemRoot/TEMP 等明确需要的系统环境及 allowlist 变量；Windows 环境 key 大小写去重，防止 PATH/Path 歧义。
- [ ] 4. 注入 run/check/output/origins 变量；日志只记录变量名和工具身份，不记录令牌值，不从错误日志拼 shell。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 参数包含空格、中文、&、分号 | 作为单个 argv 到达工具，不能执行第二条命令 |
| 项目内伪 npm.cmd | 拒绝未确认工具 |
| 允许的 npm run typecheck | 在 Windows 正常解析 JS 入口 |
| 未支持 bat | 清楚阻塞，不自动 shell:true |

**验证命令：**

```text
pnpm exec vitest run tests/compatibility/command-resolver.test.ts
```

**原稿验收关联：** T22。

**完成门槛：** 确切解决 .cmd 问题；未支持情况不会触发隐式 shell 降级。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-033"></a>
#### SG-033 · 实现子进程执行、流式日志与有界取消

**阶段：** M2　**前置：** SG-029、SG-030、SG-032　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F09/F12、§15.1

**可独立验收的目标：** 执行真实命令并准确记录退出、超时、取消和工具故障。

**创建 / 修改文件：** 新增 packages/core/src/services/{process-runner,process-ownership}.ts、tests/support/process-fixtures/、tests/integration/runner/process.test.ts。

**输入输出与共享接口：** RunnerPort.run(command:ResolvedCommand,context:ExecutionContext):AsyncIterable<RunEvent>; result 保留 raw_exit_code/signal/termination_reason。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. spawn 参数数组，持续消费 stdout/stderr 避免 pipe 阻塞；以脱敏流保存，不用无限 exec buffer。
- [ ] 2. timeout 和用户 cancel 各有原因；先停止新工作，再有界终止自有进程树，等待 close 并保存退出事实。
- [ ] 3. 记录进程创建身份和 ownership token；只按仍存活且可核验的所属进程终止，不按名称 pkill。
- [ ] 4. Windows 对无法核验的 detached 子进程保留告警/ERROR，不假称彻底清理；POSIX 进程组也只清理自有组。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 子进程输出超过管道容量 | 不死锁；预算工作正常 |
| 退出 7 | 保留 7，不改成 1 后丢细节 |
| 超时/用户 cancel | 原因不同，均不会 PASS |
| 伪造旧 PID 记录 | 不能终止无关进程 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/runner/process.test.ts
```

**原稿验收关联：** T18、T22。

**完成门槛：** 真实 spawn 测试覆盖至少一个派生子进程；没有全局进程清理命令。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-034"></a>
#### SG-034 · 实现固定输入的检查计划 DAG

**阶段：** M2　**前置：** SG-006、SG-014、SG-018、SG-025、SG-026、SG-028　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F09、§10.4、§13.1

**可独立验收的目标：** 让执行步骤和门槛在运行前就固定，执行时不能任意改变要求。

**创建 / 修改文件：** 新增 packages/core/src/services/plan-service.ts、packages/core/src/domain/{build-dag,plan-hash}.ts、apps/cli/src/commands/plan.ts、tests/unit/plan/dag.test.ts。

**输入输出与共享接口：** PlanService.create({task_id,base,profile}):Promise<CheckPlan>; validatePlan(plan,current):PlanValidity。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 合并任务/策略/映射/回归必检，构造契约预检、静态检查、环境、候选导出、probe、e2e 的明确依赖。
- [ ] 2. 检出依赖环、缺步骤、重复 check/test ID、资源锁不明和 required_set 空集；不靠空集合全部满足返回成功。
- [ ] 3. plan_hash 使用固定输入和有效步骤；计划写入后不可原地改 profile/命令/最小测试数。
- [ ] 4. 环境尚未创建的字段只存 requirements，不伪造 instance；能力缺口可输出不可执行计划并给出阻塞原因。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 必检 e2e 依赖环境但环境未知 | 计划含明确阻塞，不删 e2e |
| 变更目标 profile 再 run 原 plan | 拒绝 |
| 命令依赖成环 | 64 |
| 未知影响回归 | 回归检查在 required_set 中 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/plan/dag.test.ts
pnpm build
```

**原稿验收关联：** T08、T09、T14。

**完成门槛：** 计划具备重验身份和固定门槛；不在运行中悄悄“优化”必检。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-035"></a>
#### SG-035 · 实现 DAG 调度、资源锁与阻塞传播

**阶段：** M2　**前置：** SG-033、SG-034　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F09/F12、§11.4；E07

**可独立验收的目标：** 在不会互相覆盖环境的前提下执行独立检查。

**创建 / 修改文件：** 新增 packages/core/src/services/{scheduler,resource-locks}.ts、tests/unit/runner/scheduler.test.ts、tests/integration/runner/locks.test.ts。

**输入输出与共享接口：** executePlan(plan,adapters,context):AsyncIterable<RunEvent>; 默认并发 2，同 worktree 有副作用 run 锁唯一。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 仅前置满足且资源锁可获得的步骤启动；等待/执行时间分开统计。
- [ ] 2. 环境失败令其下游 BLOCKED，不伪装业务 FAIL；独立静态检查仍可按已确认策略收集。
- [ ] 3. 同一 shared workspace/service 写步骤互斥；同一个锁不能因不同 adapter 名称绕过。
- [ ] 4. 取消后不再启动步骤；finalization/cleanup 独立确保执行；锁异常退出留下可诊断台账。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 两个步骤竞争同一环境锁 | 不重叠执行 |
| 环境准备失败 | probe/e2e 未启动且 BLOCKED |
| 独立步骤且锁不冲突 | 最多按配置并发 |
| 取消发生在排队中 | 后续无新子进程 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/runner/scheduler.test.ts tests/integration/runner/locks.test.ts
```

**原稿验收关联：** T17、T18。

**完成门槛：** 调度事件可复算；不会从子 Agent 文本判断任务已完成。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-036"></a>
#### SG-036 · 实现退出码型检查适配器

**阶段：** M2　**前置：** SG-008、SG-031、SG-033　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F09、§12.2

**可独立验收的目标：** 为类型检查/构建等无测试 inventory 的合法命令建立准确语义。

**创建 / 修改文件：** 新增 packages/core/src/services/adapters/command-adapter.ts、tests/integration/adapters/command.test.ts。

**输入输出与共享接口：** CommandAdapter 实现 Adapter；result_kind=exit-code 仅用于已确认无需用例计数的检查。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 保存实际 command、开始/结束、退出码、日志摘要和输入身份；退出 0 才满足该命令检查。
- [ ] 2. 命令不存在/启动失败为 ERROR 或缺必要工具的 BLOCKED；正常命令返回非零为 FAIL，保留原码。
- [ ] 3. 不允许把要求 JUnit/probe/Playwright 的检查换成 exit-code；受确认 config 决定结果类型。
- [ ] 4. 取消/超时不能显示命令正常完成；stdout 中写 PASS 无效。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| typecheck 退出 0，测试数 0 | 该检查 PASS 是合法的 |
| 脚本打印 PASS 后退出 1 | FAIL |
| 原 unit 被改成 exit-code | SG-026 拦截策略漂移 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/adapters/command.test.ts
```

**原稿验收关联：** T03、T15。

**完成门槛：** 区分“无测试概念”与“测试未执行”，避免统一计数规则误伤。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-037"></a>
#### SG-037 · 实现安全 JUnit 收集与实际用例计数

**阶段：** M2　**前置：** SG-030、SG-031、SG-033、SG-036　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F09/F13、§12.2、§15.3

**可独立验收的目标：** 兼容现有测试框架，同时防止 XML 摘要或旧文件制造假通过。

**创建 / 修改文件：** 新增 packages/core/src/services/adapters/junit-adapter.ts、packages/core/src/domain/junit-parser.ts、tests/unit/reports/junit-input.test.ts、tests/integration/adapters/junit.test.ts。

**输入输出与共享接口：** parseJunit(bytes):ParsedTestReport；计数由 testcase 节点计算，不相信 testsuite tests 属性。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 只读本次独立 output 目录的约定 junit.xml；校验归属、完成、文件大小和 parser 格式。
- [ ] 2. XML 禁止 DTD/外部实体；限制嵌套与节点数；重复用例名/ID产生诊断而非静默去重后通过。
- [ ] 3. 0 testcase、全 skip、缺必检 ID、无报告且退出 0→INCOMPLETE；XML 损坏/不支持格式→ERROR。
- [ ] 4. 正常非零且有真实失败 testcase 为 FAIL；非零但无任何可信断言证据区分工具错误，不引导 Agent 乱改业务。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| testsuite tests=100，实际 0 testcase | INCOMPLETE |
| 报告是上一次 run 的符号链接 | 拒绝 |
| DOCTYPE 读取本地文件 | 无文件读取且拒绝 |
| 一个失败 testcase | FAIL 并引用证据 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/reports/junit-input.test.ts tests/integration/adapters/junit.test.ts
```

**原稿验收关联：** T03、T15、T21。

**完成门槛：** 真实执行数量可核查；旧 JUnit 和统计属性不能冒充当前测试。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-038"></a>
#### SG-038 · 实现 Probe 结果协议与收集器

**阶段：** M2　**前置：** SG-006、SG-022、SG-030、SG-031、SG-033　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F11、§12.2；E15

**可独立验收的目标：** 在 M3 真正发请求前，固定跨语言 probe 的机读接口。

**创建 / 修改文件：** 新增 packages/core/src/services/adapters/probe-adapter.ts、schemas/0.1/probe.schema.json、tests/contract/probe-envelope.test.ts。

**输入输出与共享接口：** collectProbe(output_dir,expected_run,expected_check,required_operations,target):CheckResult；输入按 §4.5。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 核对 run/check/attempt、completed 标记、预期 operations、状态码、断言集合和 evidence 引用。
- [ ] 2. 对已保留且允许的合成响应由核心再次 schema 验证，不直接信任脚本自报 schema_valid。
- [ ] 3. 缺断言、重复 operation 响应身份冲突、只有健康请求无业务操作均为缺口。
- [ ] 4. 把 backend observation 等证据指针保留，真实链路来源由 SG-060 汇总判断，此阶段不能模拟来源已确认。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| probe 自报 valid=true，payload 类型错误 | FAIL |
| 只有 GET /health，无必检操作 | INCOMPLETE |
| run_id 是历史运行 | 归属拒绝 |
| 有效格式但没有后端证据 | 不能满足真实链路 |

**验证命令：**

```text
pnpm exec vitest run tests/contract/probe-envelope.test.ts
```

**原稿验收关联：** T05、T06、T15。

**完成门槛：** 协议可供 Python helper 和 Node collector 共同使用；没有隐藏 eval。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-039"></a>
#### SG-039 · 实现 RunService 生命周期与前后快照复核

**阶段：** M2　**前置：** SG-029、SG-031、SG-033、SG-034、SG-035、SG-036、SG-037、SG-038　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F03/F09/F12、§10.1

**可独立验收的目标：** 将计划、执行、证据、清理连接成一次完整、可审计的运行。

**创建 / 修改文件：** 新增 packages/core/src/services/run-service.ts、packages/core/src/domain/run-state-machine.ts、tests/integration/run/lifecycle.test.ts。

**输入输出与共享接口：** RunService.execute(plan_id,execution_authorization):Promise<RunReference>; 每次调用生成新 run，不覆盖前一 run。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 加载 plan 后先校验授权/任务/当前输入/工具身份；失效计划退出 4，不启动任何业务命令。
- [ ] 2. CREATED→PLANNED→RUNNING→FINALIZING→COMPLETED/CANCELED/ABORTED 严格转移；各状态记录事件。
- [ ] 3. 执行结束重新抓输入与环境记录，先保存检查事实，再评估 gate，再封存；不把最后一次代码状态冒充全程状态。
- [ ] 4. M2 只用隔离测试适配器验证生命周期；真实 integration 环境 adapter 未完成时必须诊断不可用，不能替换为 always-pass。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| run 前任务/代码已变 | 无业务进程，退出 4 |
| run 中源码变动 | freshness STALE |
| 一次失败后重跑 | 新 run_id，旧事实未改 |
| handler 异常 | ABORTED/ERROR，尝试有界清理 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/run/lifecycle.test.ts
```

**原稿验收关联：** T12、T13、T18。

**完成门槛：** 真实进程与存储已联通；M2 的 fake 仅测试内使用，发行入口不会假装有环境。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-040"></a>
#### SG-040 · 实现 GateService 完整校验与重新评估

**阶段：** M2　**前置：** SG-007、SG-014、SG-017、SG-026、SG-031、SG-039　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §10、§11.2、§13.1

**可独立验收的目标：** 对当前状态重新决定能否通过，而不是复用历史 decision。

**创建 / 修改文件：** 新增 packages/core/src/services/gate-service.ts、packages/core/src/storage/evaluations.ts、tests/integration/gate/current-state.test.ts。

**输入输出与共享接口：** GateService.evaluate(run_id,policy_source,current_context):Promise<GateEvaluation>; 调用 evaluateGate，另存评估不修改 Run。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 加载封存证据并验证完整性、引用、有效 required_set、实际用例和来源；客户端不能直接提交 success。
- [ ] 2. 刷新当前 input/task/policy/目标 tip 等已声明信息，计算 freshness；报告里旧 decision 仅历史视图。
- [ ] 3. 严格核对确认来源和最低环境等级；CI=true、文件路径名字含 trusted 均无效。
- [ ] 4. 返回所有阻塞原因和规范退出码；清理完成不要求临时服务仍运行。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 原 PASS 后 untracked 源码变动 | 新评估 STALE/DENY/4，原 manifest 不变 |
| 原 FAIL 但 report 命令成功 | 仍 DENY/1 |
| 本地记录伪装 CI | 不获得 CONTROLLED |
| 证据文件被改 | 3 优先 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/gate/current-state.test.ts
```

**原稿验收关联：** T12、T23、T24、T27。

**完成门槛：** 门槛是服务端确定性计算；报告 renderer 与 Agent 不能直接更改。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-041"></a>
#### SG-041 · 实现 JSON 与终端第一屏报告

**阶段：** M2　**前置：** SG-030、SG-031、SG-040　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F13、§4.3、§12.4

**可独立验收的目标：** 让开发者和 Agent 先看到结论、范围、阻塞和下一步。

**创建 / 修改文件：** 新增 packages/reporters/src/{json,terminal,report-view}.ts、tests/unit/reports/{json,terminal}.test.ts。

**输入输出与共享接口：** buildReportView(run,evaluation):ReportView；renderJson(view):string；renderTerminal(view,options):string；无执行副作用。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 第一屏严格按结论→被测状态→阻塞→未验证→复现排列；历史 verdict 与当前 freshness 同时显示。
- [ ] 2. 每条结论挂 check_id/evidence_id，事实/建议分栏；不将怀疑原因写成已验证事实。
- [ ] 3. JSON 包含完整 required/executed/missing 列表、工具与来源；终端无色模式可读，转义控制字符。
- [ ] 4. 路径使用相对形式，环境变量值不输出；长日志只给安全片段与本地索引。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| PASS 但当前 STALE | 显著显示 DENY/STale 原因，不只绿色 |
| ERROR 与 FAIL 同时存在 | 保留真实业务失败和工具错误 |
| 终端 --json | stdout 只含一个可解析 JSON 对象 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/reports/json.test.ts tests/unit/reports/terminal.test.ts
```

**完成门槛：** 机读输出不依赖终端布局；只有 verified scope 被描述为通过。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-042"></a>
#### SG-042 · 实现 Markdown 与 JUnit 输出报告

**阶段：** M2　**前置：** SG-041　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F13、§15.3；官方 W04

**可独立验收的目标：** 提供团队审查和 CI 展示所需的可携带产物。

**创建 / 修改文件：** 新增 packages/reporters/src/{markdown,junit-output}.ts、tests/unit/reports/{markdown,junit-output}.test.ts。

**输入输出与共享接口：** renderMarkdown(view):string；renderJunit(view):string；输出 JUnit 与输入 JUnit parser 分模块。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. Markdown 包含运行身份、范围、发现、缺口、例外、复现和限制；证据链接只能落在安全相对目录。
- [ ] 2. JUnit 为每个稳定 check/test 建唯一名字；FAIL 写 failure、ERROR 写 error、BLOCKED/SKIPPED 写 skipped，并增加 gate 汇总 testcase 展示 DENY。
- [ ] 3. 转义 XML/Markdown 中日志和用户内容，禁止把日志作为模板执行。
- [ ] 4. 文档明示 JUnit 展示不决定 job 状态，真正 gate/run 非零必须保留。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 日志含 XML 标签与 & | 导出可解析且不执行实体 |
| INCOMPLETE | 报告显示阻塞，不呈现全通过 |
| 同名测试来自两检查 | 输出稳定唯一标识 |
| report 成功但 gate deny | CI 仍需用 gate 码 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/reports/markdown.test.ts tests/unit/reports/junit-output.test.ts
```

**原稿验收关联：** T24。

**完成门槛：** 四种报告结论一致；JUnit 不是能覆盖真实退出码的第二套判定。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-043"></a>
#### SG-043 · 实现最小失败交接包与接手校验

**阶段：** M2　**前置：** SG-017、SG-026、SG-040、SG-041、SG-042　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F14、§14.5

**可独立验收的目标：** 让下一位 Agent 直接从失败事实开始，而不是重读全部聊天和仓库。

**创建 / 修改文件：** 新增 packages/core/src/services/handoff-service.ts、packages/reporters/src/handoff.ts、schemas/0.1/handoff.schema.json、tests/integration/handoff.test.ts。

**输入输出与共享接口：** prepareHandoff(run_id,target):HandoffBundle；validateHandoff(bundle,current):HandoffValidity；targets 只影响提示包装，不改变事实。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 包含任务/目标/输入身份、失败与缺口、最小文件、证据索引、复现、允许修复路径、禁止改标准和重新验收步骤。
- [ ] 2. 先按必检阻塞排序；正文有明确长度预算和截断提示，详细产物按索引读取，不能压掉失败码或缺口。
- [ ] 3. 排除聊天记录、所有源码、宿主认证、restricted 附件和原始密钥；日志区明确标为不可信数据。
- [ ] 4. 接手先核对 repo/worktree/task/input；跨分支或不同 revision 只可当历史参考，重新定位路径/行号。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| Codex 包交给 Claude | 事实一致，只有入口文字不同 |
| 任务 revision 改变 | 包失效，不沿用通过 |
| 日志要求删除测试 | 作为数据，不进入操作指令 |
| 输出长度超预算 | 保留阻塞摘要并给安全索引 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/handoff.test.ts
```

**原稿验收关联：** T21、T23。

**完成门槛：** 交接不是授权凭据，不自动启动模型或发送外部消息。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-044"></a>
#### SG-044 · 接通执行、报告、门槛与交接 CLI

**阶段：** M2　**前置：** SG-034、SG-039、SG-040、SG-041、SG-042、SG-043　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §4.2、§13.1；E13

**可独立验收的目标：** 用户和宿主能通过稳定命令完成计划→运行→失败交接。

**创建 / 修改文件：** 新增 apps/cli/src/commands/{plan,run,report,gate,handoff}.ts、apps/cli/src/{output,exit}.ts、tests/integration/cli/execution-workflow.test.ts。

**输入输出与共享接口：** run --plan ID；report --run ID --format json|markdown|junit --output PATH；gate --run ID --strict；handoff --run ID --target codex|claude；handoff --validate FILE --json；互斥参数与data字段按 §7.8。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 每个入口验证仓库和参数；未知 ID/非法路径/输出冲突给具体诊断，不自动选择 latest run。
- [ ] 2. run/gate 使用 §4.2 门槛退出码；report/handoff 的 0 只表示数据操作成功。
- [ ] 3. report/handoff 默认读取，不运行新测试；输出写入边界与覆盖行为需显式，不覆盖旧事实文件。
- [ ] 4. JSON 时禁止彩色 banner 污染 stdout；CLI 错误栈只有 debug 下显示并脱敏。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| run FAIL=1，再 report 成功=0，再 gate=1 | 退出码正确分离 |
| 旧 plan 被改 profile | 拒绝 4/64，按原因 |
| report 失败时已有原始证据 | 不删除 Run |
| 用户路径含空格 | 完整参数传递 |

**验证命令：**

```text
pnpm build
pnpm exec vitest run tests/integration/cli/execution-workflow.test.ts
```

**原稿验收关联：** T24。

**完成门槛：** 端到端机读调用可用；不引入最新报告猜测或 force-pass。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-045"></a>
#### SG-045 · 实现安全清理、取消与遗留资源诊断

**阶段：** M2　**前置：** SG-029、SG-033、SG-035、SG-039、SG-044　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F12、§11.4、§13.1

**可独立验收的目标：** 停止或崩溃后不误杀用户服务，也不让残留资源不可见。

**创建 / 修改文件：** 新增 packages/core/src/services/cleanup-service.ts、apps/cli/src/commands/clean.ts、tests/integration/cleanup/process-resources.test.ts。

**输入输出与共享接口：** planCleanup(run_id):CleanupPlan；applyCleanup(plan,expected_hash):CleanupResult；默认 dry-run。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 列出本次创建的进程/临时文件/锁及归属证据；业务仓库文件和 attach 服务不进入清理清单。
- [ ] 2. apply 前复核 ownership 和资源身份；过期 PID、被替换目录、未知锁归属保留并告警。
- [ ] 3. 取消路径保存已有证据后有界清理；原始检查失败事实不因清理成功被删除。
- [ ] 4. doctor 展示遗留资源；禁用 global prune、killall、按名称清服务、删除整个用户 state 根的快捷做法。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 用户预先启动的服务 | 取消后仍运行 |
| 锁 PID 已重用 | 不能删除/终止无关资源 |
| clean 无 --apply | 只有预览 |
| 清理失败导致安全状态不明 | 最终 ERROR，证据仍可读 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/cleanup/process-resources.test.ts
```

**原稿验收关联：** T18、T19。

**完成门槛：** 只清理自有且已核验资源；Docker 资源的具体实现留 SG-061，不在此模拟可用。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-046"></a>
#### SG-046 · 实现仅用于纯解析的内容缓存

**阶段：** M2　**前置：** SG-011、SG-019、SG-024、SG-029　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §10.4、§17.2

**可独立验收的目标：** 降低重复计划开销，但不复用陈旧的集成通过结果。

**创建 / 修改文件：** 新增 packages/core/src/storage/parse-cache.ts、tests/unit/storage/cache.test.ts。

**输入输出与共享接口：** cache key=内容摘要+parser/tool版本+schema版本+相关配置摘要；get/put 只接受明确静态解析结果类型。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 缓存 OpenAPI 安全解析投影、有限 AST 和已声明纯配置解析；不缓存 Run verdict/业务通过。
- [ ] 2. 缓存缺失或损坏可重算，不能误当原始证据损坏；记录 hit/miss 和重新解析成本。
- [ ] 3. 配置、工具版本、内容、平台相关解析方式变化时失效；缓存大小有界并只清理自有项。
- [ ] 4. 首版不做跨 run e2e、runtime、数据库、环境来源的 PASS 缓存。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 相同字节相同解析器 | 命中 |
| 只升级 parser | 失效重算 |
| 试图存 CheckResult PASS | 类型/边界拒绝 |
| 缓存文件损坏 | 安全重算，不错误通过 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/storage/cache.test.ts
```

**完成门槛：** 日志可区分静态 cache 和真实执行；不得声称减少固定比例 token。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-047"></a>
#### SG-047 · 实现 schema 兼容读取与非覆盖导出

**阶段：** M2　**前置：** SG-006、SG-031、SG-041、SG-042　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §11.3、§20.3；E04

**可独立验收的目标：** 保证升级后不会误读未知字段或改写历史证据。

**创建 / 修改文件：** 新增 packages/core/src/storage/{schema-reader,export-bundle}.ts、tests/contract/schema-compatibility.test.ts。

**输入输出与共享接口：** readVersionedDocument(bytes,kind):VersionedReadResult；exportBundle(run,selection):ExportPlan，不修改原目录。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 配置未知字段严格拒绝；同版本产物仅允许已声明兼容扩展；未知主版本清楚不支持。
- [ ] 2. 对受支持旧视图做内存转换或写新副本并记录转换版本，保留原文件摘要。
- [ ] 3. 安全导出仅 regular/sanitized 产物，显式选敏感附件前给预览，不直接 zip 整个 state。
- [ ] 4. 稳定 JSON 字段/规则 ID/退出码变更需要兼容测试和 ADR，不能仅改 README。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 读取未知主版本报告 | 明确不支持，不回退假成功 |
| 新扩展在允许容器内 | 可读且保留 |
| 导出含 restricted trace | 默认排除 |
| 旧报告被转换 | 原字节不变 |

**验证命令：**

```text
pnpm exec vitest run tests/contract/schema-compatibility.test.ts
```

**完成门槛：** 导出/升级都不就地修改历史证据；机读调用方有明确版本合同。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-048"></a>
#### SG-048 · 完成执行器反例矩阵与零测试防绕过

**阶段：** M2　**前置：** SG-036、SG-037、SG-038、SG-039、SG-040、SG-044　**初始状态：** NOT_STARTED

**需求依据：** 原稿 T03/T15/T16/T24/T26

**可独立验收的目标：** 用真实子进程反例测试整个门槛，而不是只测纯函数。

**创建 / 修改文件：** 新增 tests/integration/runner/negative-matrix.test.ts、tests/support/process-fixtures/{no-tests,missing-report,broken-report,contradictory-exit}.mjs。

**输入输出与共享接口：** 矩阵至少包含 process_exit/report_presence/parseability/executed_count/required_ids/retries，期望 verdict/exit_code 全部固定。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 生成只打印通过、退出 0 无报告、空 JUnit、缺 test ID、报告 FAIL 进程 0、进程非零却报告 PASS 等真实脚本。
- [ ] 2. 验证异常/信号/超时与业务断言的分类，不对所有非零都建议修前端代码。
- [ ] 3. 实现基线已有失败标注只作来源说明，不自动免除当前必检失败。
- [ ] 4. 失败消息中包含 check/evidence 和具体原因；不存在“有 report 文件就全部满足”。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| process 0 + FAIL testcase | FAIL/1 |
| process nonzero + 无可信报告 | ERROR/3 或明确工具缺前提 2，不能 PASS |
| 0 tests + process 0 | 2 |
| 基线与候选都失败 | 仍拒绝当前必检 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/runner/negative-matrix.test.ts
```

**原稿验收关联：** T03、T15、T16、T24、T26。

**完成门槛：** 端到端“假绿”通道被回归覆盖；分类规则已写入诊断手册。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-049"></a>
#### SG-049 · 验证崩溃、并发锁与完成封存竞态

**阶段：** M2　**前置：** SG-029、SG-031、SG-035、SG-039、SG-045　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F12、§11.4、§19.1

**可独立验收的目标：** 让异常终止后的状态可信且不会引出破坏性恢复。

**创建 / 修改文件：** 新增 tests/integration/run/{crash,concurrent-runs,finalization-race}.test.ts、docs/diagnostics/recovery.md。

**输入输出与共享接口：** 崩溃 run 保持 ABORTED/未封存，下一次 createRun 使用新 ID；P0 不实现中间步骤恢复为通过。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 在写事件、check 结束、manifest 临时写、cleanup 前后注入受控崩溃。
- [ ] 2. 并发两个 CLI 操作同工作树，只有一个可获副作用锁；另一个诊断等待/冲突，不写同一目录。
- [ ] 3. 验证锁回收时进程身份、owner token 和台账，不只看 PID 不存在。
- [ ] 4. 重新执行只能建新 run；旧不完整记录仍可 report，不得从部分成功拼成新的 PASS。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| manifest 封存前强制退出 | 无完整 PASS |
| 两进程同时写 state | 不互相覆盖 |
| 清理后重跑 | 新 run 指向 previous_run_id，仅作为历史 |
| 旧 PID 恰好被复用 | 不自动删除锁归属 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/run/crash.test.ts tests/integration/run/concurrent-runs.test.ts tests/integration/run/finalization-race.test.ts
```

**原稿验收关联：** T18。

**完成门槛：** 恢复文档与真实行为一致；没有无条件删除锁/目录脚本。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-050"></a>
#### SG-050 · 完成命令执行与证据阶段出口

**阶段：** M2　**前置：** SG-040、SG-041、SG-042、SG-043、SG-044、SG-045、SG-046、SG-047、SG-048、SG-049　**初始状态：** NOT_STARTED

**需求依据：** 原稿 M2、F09/F12—F14、§10

**可独立验收的目标：** 为 M3 环境集成提供已稳定的执行与证据基础。

**创建 / 修改文件：** 新增 tests/integration/stages/m2.test.ts、tests/fixtures/stages/M2.json、docs/implementation/evidence/M2-summary.md。

**输入输出与共享接口：** M2 stage 运行全部领域/适配器 parser/CLI/进程/存储测试；静态与 fake 集成结果明确标签。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 用完整 CLI 调用从确认任务、生成 plan、执行真实测试脚本到生成报告/交接/gate。
- [ ] 2. 验证 0/1/2/3/4/64 所有退出码和 report=0 不代表通过。
- [ ] 3. 核对两种 freshness 视图、日志隐私、锁/取消、不可变历史、source task 追溯。
- [ ] 4. 没有真实浏览器与环境来源时，文档标明“执行器阶段通过”，不能称全栈 MVP 完成。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 完整模拟协议流程 | 只证明执行器联通 |
| 尝试真实 integration 但 env adapter 未实现 | 明确缺口/非零 |
| 四种 renderer | gate/verdict/reasons 一致 |

**验证命令：**

```text
pnpm verify:stage -- --stage M2
```

**完成门槛：** M2 真实产物可读、退出码正确；M3 只需适配真实环境，不重建第二套执行器。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。


### M3 阶段任务

<a id="sg-051"></a>
#### SG-051 · 实现真实 FastAPI 样例与本次候选契约导出

**阶段：** M3　**前置：** SG-009、SG-020、SG-022、SG-038、SG-050　**初始状态：** NOT_STARTED

**需求依据：** 原稿 S01、F05/F11、§3.2；官方 W12

**可独立验收的目标：** 提供真实响应和应用导出的契约，而不是手写“后端已通过”。

**创建 / 修改文件：** 新增 examples/contract-drift-demo/apps/api/{app/main.py,app/models.py,scripts/export_openapi.py,tests/test_performance.py,pyproject.toml}、tests/integration/demo/api.test.ts。

**输入输出与共享接口：** GET /api/performance 返回 data.performance.total_return:number；GET /health 只表 readiness；export_openapi.py 写 STACKGATE_OUTPUT_DIR/candidate-openapi.json。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 建立固定合成数据 0.1234，不接外部行情；API 业务响应与 Pydantic 模型一致，候选契约由实际 app.openapi() 导出。
- [ ] 2. 导出路径仅使用本次 runner 注入的目录，写入后由主进程重新校验 run/check 归属；导出属于授权代码执行。
- [ ] 3. health 与测试来源端点不混入业务目标契约，测试专用路径默认仅在显式测试配置中启用。
- [ ] 4. 锁定 Python/FastAPI/Pydantic 真实版本并测试其 OpenAPI 输出是否落在已支持子集；不靠关闭检查兼容框架。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 真实 API 请求 | 200 且 total_return 为 JSON number |
| 修改后端响应类型 | 候选/runtime 差异被发现 |
| 旧 candidate 文件残留在仓库 | 当前 export 不读取它 |
| 执行 import 有错误 | 工具 ERROR 而非假兼容 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/demo/api.test.ts
pnpm test:contract
```

**原稿验收关联：** T05、T06、T15。

**完成门槛：** 后端能单独启动/测试/导出；版本、命令和真实证据齐备。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-052"></a>
#### SG-052 · 实现 React 页面与彼此独立的 Mock 单测

**阶段：** M3　**前置：** SG-009、SG-051　**初始状态：** NOT_STARTED

**需求依据：** 原稿 S01、§19.1；本计划 §1.3

**可独立验收的目标：** 构造足够真实的“单测绿但联调坏”样例及可审查修复补丁。

**创建 / 修改文件：** 新增 examples/contract-drift-demo/apps/web/{package.json,vite.config.ts,src/api/performance.ts,src/pages/PerformancePage.tsx,src/main.tsx,tests/performance.test.tsx}、examples/contract-drift-demo/patches/、tests/integration/demo/web-fixtures.test.ts。

**输入输出与共享接口：** 页面提供 data-testid=performance-summary 和 total-return；默认 broken 状态客户端读取旧字段，fixed 补丁改为目标字段并保留空状态。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 用真实 React/Vite 页面请求实际配置的 API，展示百分比和空状态；不另建产品管理控制台。
- [ ] 2. broken 前端单测使用旧 Mock 且能真实通过，后端单测使用新模型也通过，公开说明两者各自覆盖范围。
- [ ] 3. fixed 补丁同时更新前端代码及允许修改的应用单测；受保护端到端验收标准不随补丁变化。
- [ ] 4. 故障/修复仅在样例或测试临时副本应用，产品核心不得调用自动业务修复逻辑。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| broken+前端自己的 Mock | 前端单测真通过 |
| broken+真实新 API | 页面不满足 12.34% 验收 |
| fixed+真实 API | 页面显示 12.34% |
| 合法空状态场景 | 按其独立目标显示空状态；非法API响应仍不能通过 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/demo/web-fixtures.test.ts
```

**原稿验收关联：** T01、T02。

**完成门槛：** 同一确认任务能经历故障和修复；没有为了成功改保护契约或 e2e 断言。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-053"></a>
#### SG-053 · 实现 Playwright reporter 与稳定验收 ID

**阶段：** M3　**前置：** SG-006、SG-030、SG-031、SG-038、SG-052　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F11、§12.2、§17.3；官方 W08/W09

**可独立验收的目标：** 收集真实执行、重试、缺失和附件，避免只看框架退出码。

**创建 / 修改文件：** 新增 packages/adapter-playwright/src/{reporter,collector,inventory}.ts、examples/contract-drift-demo/apps/web/tests/acceptance/performance.spec.ts、tests/contract/playwright-reporter.test.ts。

**输入输出与共享接口：** 自定义 Reporter 导出 default class；annotation type=stackgate-id、description=performance-summary；产物写 playwright.json。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 实现 onBegin/onTestEnd/onEnd/onError，记录全 inventory 和每次 retry；不依赖标题/文件路径生成的自动 ID。
- [ ] 2. reporter 出错需保存独立失败诊断且不写有效 completed；collector 检查完成 marker、运行身份与进程事实，不能仅指望框架替 reporter 抛错 [W08]。
- [ ] 3. 示例测试真实导航、等待 API、断言数值与空状态；对核心业务断言建立稳定 assertion_id 记录，不能只有 page.goto。
- [ ] 4. 缺失/重复 ID、expected failure、skipped、flaky、只有截图无断言分别报告；不通过 reporter 覆盖框架原始状态。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 测试实际重试后通过 | flaky 记录保留 |
| 两个必检 test 用同一 annotation | 完整性不满足 |
| reporter 在 onEnd 崩溃 | 不能由框架 0 退出误判 PASS |
| 必检测试被 grep 排除 | 缺失 ID |

**验证命令：**

```text
pnpm exec vitest run tests/contract/playwright-reporter.test.ts
```

**原稿验收关联：** T03、T15、T16。

**完成门槛：** 至少一次运行真实浏览器 runner 验证 reporter 形状；只用伪 JSON 的测试不足以完成此任务。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-054"></a>
#### SG-054 · 实现受限 HTTP probe 与 Python 预设 helper

**阶段：** M3　**前置：** SG-018、SG-022、SG-038、SG-051　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F11、§12.2、§16.2；E15

**可独立验收的目标：** 按声明操作执行实际请求，输出可重新核验的协议证据。

**创建 / 修改文件：** 新增 presets/fastapi-react/scripts/probe_helpers.py、examples/contract-drift-demo/apps/api/scripts/probe_performance.py、packages/core/src/services/http-policy.ts、tests/integration/probe/http.test.ts。

**输入输出与共享接口：** probe_performance.py 只执行配置的 GET /api/performance；生成 §4.5 probe.json 和受允许的合成响应证据。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 请求前校验 scheme/origin/路径/方法/测试身份；默认不跟随跨 origin 重定向，不批量扫描全部 OpenAPI。
- [ ] 2. 给每次请求注入 run/check/request ID；超时与状态失败分开；凭证通过 allowlist 引用，不进入产物。
- [ ] 3. 执行稳定业务断言和 schema 验证，保存足够的合成数据让核心复核；不从响应内容生成可执行表达式。
- [ ] 4. 允许目标必须显式配置或来自已验证的本次 Compose 绑定；localhost 不自动代表安全测试环境。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 允许 API 正常请求 | 真实记录 operation/status/assertion |
| 302 到未授权 origin | 拒绝跟随 |
| 目标是未允许外部服务 | 请求数为 0 |
| GET 有副作用的配置 | 仍需显式授权，不能默认遍历 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/probe/http.test.ts
```

**原稿验收关联：** T05、T06、T20、T21。

**完成门槛：** Probe 不只是 wrapper 打印预期 JSON；有实际请求与失败记录。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-055"></a>
#### SG-055 · 实现测试专用后端访问观察与实例标识

**阶段：** M3　**前置：** SG-030、SG-051、SG-054　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F10/F11、§16.3；E10

**可独立验收的目标：** 为来源核验提供独立于浏览器响应日志的后端访问证据。

**创建 / 修改文件：** 新增 presets/fastapi-react/scripts/stackgate_observation.py、examples/contract-drift-demo/apps/api/app/test_observation.py、tests/integration/environment/observation.test.ts。

**输入输出与共享接口：** BackendObservation={run_id,check_id,request_id,instance_id,operation_key,status_code,started_at,response_digest}; 不包含 Authorization/Cookie 原值。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 测试配置开启 middleware，记录固定路径的业务请求与返回状态；instance ID 在启动时生成并与启动记录关联，不由请求参数直接指定。
- [ ] 2. 来源记录包含启动/构建信息和数据版本；app 自报 hash 只是线索，之后需外部 launcher/Compose 复核。
- [ ] 3. 请求/响应关联摘要仅对合成允许内容计算，不对秘密值做可公开 hash；日志分离业务与系统元数据。
- [ ] 4. 观测端点只在显式测试配置开启，禁止默认绑定公网或暴露环境变量；文档保留服务端内部 Mock 边界。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 浏览器/探针请求带 request_id | 后端有匹配实际访问记录 |
| 伪造输入 instance_id | 后端记录真实启动 instance |
| 禁用测试模式 | 观测端点不可用 |
| 请求含 token | 观测文件无原值 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/environment/observation.test.ts
```

**原稿验收关联：** T10、T11、T21。

**完成门槛：** 观测是证据线索不是签名；测试模板不会成为生产凭证泄露入口。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-056"></a>
#### SG-056 · 实现 attach 环境来源核验

**阶段：** M3　**前置：** SG-014、SG-018、SG-039、SG-051、SG-055　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F10/F12、§15.1

**可独立验收的目标：** 接入已有服务时明确能证明什么，并拒绝只凭 localhost/健康状态升格。

**创建 / 修改文件：** 新增 packages/adapter-compose/src/attach/{adapter,provenance,process-observation}.ts、examples/contract-drift-demo/scripts/demo-env.mjs、tests/integration/environment/attach.test.ts。

**输入输出与共享接口：** AttachAdapter.prepare/observe 不负责启动或关闭用户服务；Demo launcher 是用户显式运行的独立样例工具，保存启动身份与输入摘要。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 读取声明 URL/健康路径，验证目标许可；只有 app 自报 revision 或 provenance 文件时保持 DECLARED。
- [ ] 2. 在预设 launcher 场景核对 OS 进程启动信息、owner/instance、输入与数据摘要及请求关联；缺一不可满足 OBSERVED。
- [ ] 3. launcher 明确 start/stop 操作、独立台账、合成数据，无热加载输入漂移；不是产品在 attach 下偷偷管理服务。
- [ ] 4. 识别当前仓库代码变动后仍运行的旧进程；输出重新启动正确测试实例的具体说明。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 服务健康但没有可核对启动来源 | strict DENY/2 |
| 随手写 provenance.json | 仍不能 OBSERVED |
| launcher 启动正确输入且请求匹配 | 可 OBSERVED |
| attach 后 clean | 原服务仍在 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/environment/attach.test.ts
```

**原稿验收关联：** T10、T11、T19。

**完成门槛：** 最弱来源不会自动升级；attach 的所有权边界清楚。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-057"></a>
#### SG-057 · 实现 Compose 有效配置安全预检

**阶段：** M3　**前置：** SG-016、SG-018、SG-032、SG-055　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F10、§15.2、§16.2；官方 W11

**可独立验收的目标：** 在创建容器前识别共享资源和危险配置，不靠 project 名假装隔离。

**创建 / 修改文件：** 新增 packages/adapter-compose/src/{config,preflight,target-bindings}.ts、tests/security/compose-preflight.test.ts、examples/contract-drift-demo/compose.test.yaml。

**输入输出与共享接口：** ComposePreflightResult={approved,diagnostics,resource_plan,origin_binding_requirements,config_hash}; 只处理用户已提供的测试文件。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 解析实际 docker compose config，命令需已授权；避免 interpolation 读取未授权环境，输出先脱敏再保留摘要。
- [ ] 2. 检测固定 container_name、固定宿主端口、external volume/network、host network、privileged、Docker socket、仓库外敏感挂载、production 目标与凭证来源。
- [ ] 3. 允许本次自有网络/卷与审查过的只读输入挂载；默认预设不用外部数据库，专用数据来自固定 seed。
- [ ] 4. 动态端口采用审批过的服务→本次容器资源绑定，实际端口在启动后解析，不能为方便允许任意 origin。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| Compose 有固定生产数据库连接 | 阻塞，不因库名有 test 而通过 |
| 绑定 Docker socket | P0 预设拒绝 |
| 固定端口被占 | 先报告冲突，不杀进程 |
| 干净专用测试文件 | 产生可执行资源计划 |

**验证命令：**

```text
pnpm exec vitest run tests/security/compose-preflight.test.ts
```

**原稿验收关联：** T17、T19、T21。

**完成门槛：** 所有可能共享/越界资源在启动前可见；没有自动生产拓扑推断。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-058"></a>
#### SG-058 · 实现 Compose 启动、动态端口与实际来源记录

**阶段：** M3　**前置：** SG-031、SG-033、SG-035、SG-039、SG-057　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F10、§15.2；E05

**可独立验收的目标：** 为每次运行创建真正独立的测试实例并记录实际资源。

**创建 / 修改文件：** 新增 packages/adapter-compose/src/{compose-adapter,start,inspect,provenance}.ts、tests/integration/environment/compose-start.test.ts。

**输入输出与共享接口：** ComposeAdapter.prepare(plan,context):EnvironmentManifest；实际 origin/image/container/network/volume/instance 与输入 hash 写入 environment.json。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 生成唯一 project 名和 ownership labels，按预检资源计划启动；保留实际构建输入摘要和镜像 ID。
- [ ] 2. 解析 docker inspect/compose port 的真实绑定，区分宿主 probe 地址、浏览器地址、容器 service DNS；不默认 8000/5173。
- [ ] 3. 按审批模板为 worker 注入合成数据和 run 关联信息；构建与启动错误分离，日志按规则脱敏。
- [ ] 4. 本地受控 Compose 仍不能仅凭自己启动就宣称可信 CI 的 CONTROLLED；由上层 trust context 决定可用等级。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 同时两个独立临时仓库运行 | 资源名/端口不碰撞 |
| 外部端口已占 | 该环境 BLOCKED |
| 镜像/代码身份不匹配 | 来源不可满足 |
| 本地设置 CI=true | 不升级 CONTROLLED |

**验证命令：**

```text
pnpm exec vitest run tests/integration/environment/compose-start.test.ts
```

**原稿验收关联：** T10、T11、T17。

**完成门槛：** 台账记录实际资源而非预计名称；没有共享生产资源或自动权限升级。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-059"></a>
#### SG-059 · 实现 readiness、旧服务与环境状态验证

**阶段：** M3　**前置：** SG-056、SG-058　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F10、T10/T11/T17；官方 W11

**可独立验收的目标：** 区分进程已启动、服务已健康和当前候选已准备好。

**创建 / 修改文件：** 新增 packages/adapter-compose/src/{readiness,origin-identity}.ts、tests/integration/environment/readiness.test.ts。

**输入输出与共享接口：** waitForEnvironment(requirements,observations,deadline):EnvironmentReadiness；返回 READY/BLOCKED/ERROR 及来源事实。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 按有界退避做健康检查，并核对实例/启动/输入/数据；启动不等于 readiness。
- [ ] 2. 检查最终目标是否与计划绑定资源一致；host/container 地址不能互相猜测替换。
- [ ] 3. 探针与浏览器开始前都核对预期 instance，期间服务重启或后端切换保留来源缺口。
- [ ] 4. 失败依赖传播为 BLOCKED，不把端口冲突报告成“前端业务断言失败”。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| health 200 但来自旧分支 | 拒绝当前候选验收 |
| 容器 running 但数据库/seed 未就绪 | 等待后明确超时 BLOCKED |
| 中途进程重启为新 instance | 来源不连续，不能完整通过 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/environment/readiness.test.ts
```

**原稿验收关联：** T10、T11、T17。

**完成门槛：** 健康、来源、准备状态分开显示，且有具体复现说明。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-060"></a>
#### SG-060 · 建立浏览器→API→后端观察的真实链路关联

**阶段：** M3　**前置：** SG-022、SG-053、SG-054、SG-055、SG-059　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F11、§16.2；E10

**可独立验收的目标：** 证明已纳入范围的页面流程确实调用了预期测试后端，而不只是加载截图。

**创建 / 修改文件：** 新增 packages/adapter-playwright/src/{network-observer,real-chain,assertion-observer}.ts、presets/fastapi-react/playwright/stackgate.fixture.ts、tests/integration/browser/real-chain.test.ts。

**输入输出与共享接口：** verifyRealChain({required_operations,tests,browser_requests,backend_observations,environment}):ChainAssessment。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 为支持的测试模板注入 run/check/request 关联，在浏览器 request/response 与后端访问记录核对 operation、instance、状态和允许响应摘要。
- [ ] 2. 支持的 fixture 对目标 API 禁止 route.fulfill/浏览器 Mock，设置 service workers 策略；检测已知拦截手段，不能声称抵御任意恶意测试代码。
- [ ] 3. 必须有实际必检 test、业务断言记录和目标 operation；截图、page.goto、health 请求不算真实业务验收。
- [ ] 4. 第三方沙箱边界明确标注；没有独立服务端观察时不能说“排除了所有服务端 Mock”。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 前端 route.fulfill 伪造返回 | 真实链路不满足 |
| 测试只打开页面截图 | 缺业务断言/操作，INCOMPLETE |
| 请求到另一后端但相同返回 | instance 关联拒绝 |
| 真实预设链路 | 可满足范围内验证 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/browser/real-chain.test.ts
```

**原稿验收关联：** T01、T02、T10、T11。

**完成门槛：** 真实链路结论有证据链与限制，不只是 reporter 自报 real_backend=true。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-061"></a>
#### SG-061 · 实现 Compose 资源清理与专用测试数据边界

**阶段：** M3　**前置：** SG-045、SG-057、SG-058、SG-059　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F12、§15.2、§16.1

**可独立验收的目标：** 集成失败或取消后，安全清理本次容器而不伤及其他项目。

**创建 / 修改文件：** 新增 packages/adapter-compose/src/{cleanup,resource-ledger,data-policy}.ts、tests/integration/cleanup/compose.test.ts。

**输入输出与共享接口：** cleanupOwnedResources(ledger,live_inspection):CleanupResult；逐 ID 与 label/token 验证归属后处理。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 按容器、专用网络、专用卷的依赖顺序清理；不使用 global prune，不依据 project name 单独删除共享资源。
- [ ] 2. 不直接对用户原 Compose 文件运行可能扩展删除范围的 down -v；只处理台账中创建且再次核验的原生资源。
- [ ] 3. 数据 seed 版本进入 manifest；迁移只允许明确的本次专用测试目标；源稿未要求首个样例有真实数据库，不能额外搭生产级数据平台。
- [ ] 4. 缺归属或删除失败保留资源与告警；attach 服务不进入本清理器。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 另一个同名/相似名项目运行 | 保持不动 |
| 资源 ownership label 被改 | 拒绝删除并标错误 |
| 取消发生在容器启动后 | 自有资源清理，证据保留 |
| external volume | 预检阻塞且不能删除 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/cleanup/compose.test.ts
```

**原稿验收关联：** T18、T19。

**完成门槛：** 真实 Docker 取消/清理测试可运行；不以 mocked down 命令测试替代。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-062"></a>
#### SG-062 · 将环境、候选导出、Probe、浏览器接入同一 Run

**阶段：** M3　**前置：** SG-021、SG-034、SG-039、SG-053、SG-054、SG-056、SG-058、SG-059、SG-060、SG-061　**初始状态：** NOT_STARTED

**需求依据：** 原稿 M3、F05/F09—F14

**可独立验收的目标：** 把此前模块真正串成一次全栈验收，而不是独立 demo。

**创建 / 修改文件：** 新增 packages/core/src/services/integration-flow.ts、apps/cli/src/bootstrap/adapters.ts、tests/integration/fullstack/workflow.test.ts。

**输入输出与共享接口：** 同一 CheckPlan 的 env→candidate export→contract/runtime/e2e→finalization 共用 input/task/policy，所有产物属于该 run。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 把真实 adapter 注册到 CLI composition root；移除未实现环境占位行为，但保留能力不足的明确诊断。
- [ ] 2. 动态 origins 由环境 manifest 注入登记命令；生成最终来源与请求关联后才能执行完整 gate。
- [ ] 3. 契约错误可按计划阻断依赖业务检查，也可继续安全独立诊断；计划预先决定，不运行中擅改。
- [ ] 4. 任何失败/取消均进入 finalization/cleanup；成功也必须确认清理安全状态和最终输入。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 完整成功流程 | 同一 run 所有 check/evidence 指向同任务和输入 |
| 环境失败 | 下游 BLOCKED，非业务 FAIL |
| 候选导出错误 | 不读取上一份契约继续 |
| finalization 后 report | 完整四种格式可读取 |

**验证命令：**

```text
pnpm build
pnpm exec vitest run tests/integration/fullstack/workflow.test.ts
```

**完成门槛：** 发行 CLI 已调用真实服务与浏览器；没有通过单测 fake 旁路过关。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-063"></a>
#### SG-063 · 联动 inventory、跳过、断言和 flaky 防绕过

**阶段：** M3　**前置：** SG-026、SG-037、SG-053、SG-060、SG-062　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F08/F11、§17.3

**可独立验收的目标：** 将受保护验收约定与实际浏览器执行结果逐项对齐。

**创建 / 修改文件：** 新增 packages/adapter-playwright/src/completeness.ts、tests/integration/browser/completeness.test.ts。

**输入输出与共享接口：** compareRequiredInventory(task,plan,report):CompletenessAssessment；计数以真实尝试和必检稳定 ID 为准。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 核对必检 IDs 的 discovery/execution/attempts/assertions；重复 ID 不合并成成功，.only/grep/shard 缺失必须显示。
- [ ] 2. 首版不承诺跨 shard 自动合并；支持的非分片模式先做实，分片输入未适配则 incomplete。
- [ ] 3. expected-fail 的实际失败不能算必检业务 PASS；默认 flaky 即 incomplete，保留第一次失败。
- [ ] 4. 验收 test 文件修改同时触发 SG-026 的确认校验；重命名导致 ID 缺失与实际断言失败分开。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 删测试后 process 0 | 缺必检 ID/数量，非绿 |
| test.fail 使框架接受失败 | 门槛仍不通过业务必检 |
| 第一次失败第二次通过 | flaky/2 |
| 必检 test 执行但无登记断言 | INCOMPLETE |

**验证命令：**

```text
pnpm exec vitest run tests/integration/browser/completeness.test.ts
```

**原稿验收关联：** T03、T15、T16。

**完成门槛：** 框架“预期失败”与产品“验收通过”不混用。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-064"></a>
#### SG-064 · 完成单测绿而联调失败的真实负例

**阶段：** M3　**前置：** SG-051、SG-052、SG-053、SG-060、SG-062、SG-063　**初始状态：** NOT_STARTED

**需求依据：** 原稿 S01、T01/T02

**可独立验收的目标：** 做出首屏可以公开复现的产品核心价值。

**创建 / 修改文件：** 新增 tests/acceptance/T01-response-rename.test.ts、tests/acceptance/T02-mocks-pass.test.ts、examples/contract-drift-demo/scripts/run-broken.mjs。

**输入输出与共享接口：** 测试临时仓库以 baseline=confirmed target，新后端+旧消费者；实际 CLI run/gate 出口 1。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 在干净临时副本中运行前端旧 Mock 单测和后端新模型单测，保存各自真实通过记录。
- [ ] 2. 启动当前候选真实环境，执行 performance-summary 必检，保留浏览器失败断言和后端请求证据。
- [ ] 3. 校验报告说明相关 operation 与映射消费者，不能在没有证据时声称已精确找到代码根因。
- [ ] 4. 脚本只在自有 fixture 应用故障并清理，不修改开发者当前工作分支或自动修业务。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| broken 状态单测 | 两边真实退出 0 |
| 同状态 StackGate integration | FAIL/DENY/1 |
| 报告显示 failure evidence | 能找到实际断言及后端记录 |
| 移除后端观察 | 不允许完整真实链路通过 |

**验证命令：**

```text
pnpm test:acceptance -- --ids T01,T02
```

**原稿验收关联：** T01、T02。

**完成门槛：** 负例来自真实服务与浏览器；测试不以预生成 FAIL JSON 冒充产品成功。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-065"></a>
#### SG-065 · 完成修复后的新 Run 与旧证据失效演示

**阶段：** M3　**前置：** SG-014、SG-043、SG-064　**初始状态：** NOT_STARTED

**需求依据：** 原稿 S01/S03、F14、T12/T23

**可独立验收的目标：** 让用户看到定位、修复、重验闭环而不篡改旧失败记录。

**创建 / 修改文件：** 新增 tests/integration/fullstack/fix-and-rerun.test.ts、examples/contract-drift-demo/scripts/run-fixed.mjs、examples/contract-drift-demo/docs/walkthrough.md。

**输入输出与共享接口：** fixture 修复只更新允许的客户端/应用单测；原目标与 e2e 标准不变；新 plan、新 run、新环境来源。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 从负例导出 handoff，人工或测试脚本应用公开修复补丁；产品本身不提供自动修复。
- [ ] 2. 修改源码后检查旧运行当前 freshness 为 STALE，历史 FAIL 不被改写。
- [ ] 3. 重新生成计划/启动匹配当前输入的测试环境并运行；复用旧热服务会因来源不符阻塞。
- [ ] 4. 确认新 run 全部必检 PASS且 gate0；报告并列旧失败/修复变化/新范围，仍列未验证页面。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 只改源码，不重跑 | 不能直接 ALLOW |
| 正确修复+新环境/新 run | PASS/FRESH/ALLOW/0 |
| 旧 manifest | 字节不被改成 PASS |
| 删 e2e 断言替代修复 | 被 SG-063/026 拦截 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/fullstack/fix-and-rerun.test.ts
```

**原稿验收关联：** T12、T23。

**完成门槛：** 形成真实红→绿演示；修复不靠放宽验收标准。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-066"></a>
#### SG-066 · 验证改契约、改断言与批准记录的防漂移闭环

**阶段：** M3　**前置：** SG-017、SG-021、SG-026、SG-062、SG-063　**初始状态：** NOT_STARTED

**需求依据：** 原稿 S02、T03/T04

**可独立验收的目标：** 证明本地与受确认策略能识别常见“修标准而非修实现”。

**创建 / 修改文件：** 新增 tests/acceptance/T03-missing-tests.test.ts、tests/acceptance/T04-target-tamper.test.ts、tests/integration/policy/acceptance-mutation.test.ts。

**输入输出与共享接口：** 从合法确认状态复制临时仓库后分别修改 target/test/config，原 plan 必须失效或拒绝。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 注入删除测试、改 skip、把实际 backend 换 Mock、减少最小数量、更改 required checks 的独立故障。
- [ ] 2. 改目标契约使错误实现匹配时，检查原 confirmation/hash 与当前不同；拒绝覆盖旧 revision。
- [ ] 3. 合法用户批准精确 API 变更通过新的确认记录体现，不能授予未来所有变更通行证。
- [ ] 4. 记录本地同权限恶意进程可绕过的边界；不因这些协作防错测试通过而声称安全对抗完备。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 目标更改迎合错误代码 | 旧 plan 不可用/退出4 |
| 删除必检 tests | 缺口/策略 DENY |
| 已批准某条 breaking | 仅该摘要与 operation 的变更被接受 |

**验证命令：**

```text
pnpm test:acceptance -- --ids T03,T04
pnpm exec vitest run tests/integration/policy/acceptance-mutation.test.ts
```

**原稿验收关联：** T03、T04。

**完成门槛：** 任务确认、检测和运行三层联动，不能只检查 YAML status。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-067"></a>
#### SG-067 · 验证旧服务、伪来源文件和中途环境切换

**阶段：** M3　**前置：** SG-056、SG-058、SG-059、SG-060、SG-062　**初始状态：** NOT_STARTED

**需求依据：** 原稿 S04、T10/T11/T17

**可独立验收的目标：** 证明健康但错误的服务不会被标为当前候选通过。

**创建 / 修改文件：** 新增 tests/acceptance/{T10-unverified-environment,T11-old-service,T17-env-blocked}.test.ts。

**输入输出与共享接口：** 用两个真实临时实例 A/B、不同输入摘要、不同 instance 与启动记录做请求替换测试。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 服务 A 为旧分支，候选 B 为新工作区，让配置误指向 A；即使响应数据相同也必须来源不满足。
- [ ] 2. 只伪造 provenance 文件但无匹配进程/构建记录，再测健康200，仍不能 OBSERVED。
- [ ] 3. 测试执行途中重启后端/更换端口绑定，记录 provenance gap；不得把新旧实例请求拼成单份来源。
- [ ] 4. 端口冲突和服务未启动归为环境 BLOCKED，所有依赖检查未执行情况如实显示。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 旧服务内容碰巧一致 | 不能获得当前代码 ALLOW |
| 假 provenance 文件 | DECLARED/UNVERIFIED |
| 中途切实例 | INCOMPLETE/DENY |
| 端口冲突 | 不杀占用进程 |

**验证命令：**

```text
pnpm test:acceptance -- --ids T10,T11,T17
```

**原稿验收关联：** T10、T11、T17。

**完成门槛：** 真实实例误连的反例已验证，不只是手工构造 provenanceLevel 字段。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-068"></a>
#### SG-068 · 验证未知 schema 与动态消费者回归策略

**阶段：** M3　**前置：** SG-019、SG-022、SG-024、SG-025、SG-062　**初始状态：** NOT_STARTED

**需求依据：** 原稿 T05—T09

**可独立验收的目标：** 在分析器不知道时运行可用回归或明确拒绝，不以未知为无问题。

**创建 / 修改文件：** 新增 tests/acceptance/{T05-type-mismatch,T06-required-null,T07-unsupported-schema,T08-fallback-regression,T09-missing-regression}.test.ts。

**输入输出与共享接口：** 把 unsupported features、dynamic URL、missing mapping 注入真实 fixture，并观察 plan/runner/check result。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. number/string、缺必需/null 的错误走实际 probe；核心不得转换数据。
- [ ] 2. 复杂 schema 出现在变更/必检引用路径时产生 unsupported；不调用自动转换削弱表达。
- [ ] 3. 动态 URL 无静态图但有已配置回归时，确保实际命令被执行并记录回退来源；缺回归必须 incomplete。
- [ ] 4. 同时保留 unresolved_impacts 与已执行 fallback 覆盖，不能因为回归通过谎称静态分析已完整。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 实际响应类型错误 | FAIL1 |
| schema 不支持 | INCOMPLETE2 |
| 动态消费者+回归 | 回归真实执行 |
| 动态消费者无回归 | DENY2 |

**验证命令：**

```text
pnpm test:acceptance -- --ids T05,T06,T07,T08,T09
```

**原稿验收关联：** T05、T06、T07、T08、T09。

**完成门槛：** 未知影响不削弱 required_set；工具支持矩阵与实际行为一致。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-069"></a>
#### SG-069 · 验证真实浏览器产物隐私与超限处理

**阶段：** M3　**前置：** SG-030、SG-053、SG-054、SG-055、SG-062　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §16.3、§17.1、T21

**可独立验收的目标：** 对真实日志、请求和截图路径检查隐私，而不只测一个正则。

**创建 / 修改文件：** 新增 tests/acceptance/T21-secret-redaction.test.ts、tests/security/browser-artifacts.test.ts、docs/security/artifact-handling.md。

**输入输出与共享接口：** 使用测试专用 canary secret，验证终端/JSON/Markdown/JUnit/handoff/常规导出中均无 canary 原值。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 向请求头、响应头、错误日志和分块流注入虚拟令牌，检查所有常规落盘和导出位置。
- [ ] 2. 截图/trace 用合成页面且仍归 restricted，导出预览明确敏感风险；不能靠 regex 宣称图片清洁。
- [ ] 3. 制造超大 console/trace，使预算触发；关键断言或来源丢失应降低完整性，其他可选大附件缺失明确标注。
- [ ] 4. 错误信息和 stack 不泄露宿主用户名/绝对凭证路径，保留排错所需相对定位。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| canary 出现在 Authorization/Cookie | 常规区域0匹配 |
| 产物被截断 | manifest 标注，不显示完整证据 |
| 默认 export | restricted 不包含 |
| 必要来源证据丢失 | 不能 PASS |

**验证命令：**

```text
pnpm test:acceptance -- --ids T21
pnpm exec vitest run tests/security/browser-artifacts.test.ts
```

**原稿验收关联：** T21。

**完成门槛：** 真实产物链路隐私测试有记录；使用的令牌仅为虚拟测试数据。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-070"></a>
#### SG-070 · 完成 Windows 原生命令、文件锁与取消验证

**阶段：** M3　**前置：** SG-032、SG-033、SG-045、SG-062　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §15.1、T18/T22

**可独立验收的目标：** 确保 Windows 用户实际可用，而不是把 Linux 结果直接外推。

**创建 / 修改文件：** 新增 tests/compatibility/windows/{argv,encoding,process-tree,file-lock}.test.ts、docs/compatibility/windows.md。

**输入输出与共享接口：** 测试目标 Windows 11 原生 Node/终端；平台不符时记录 NOT_RUN，发布矩阵不得把 skip 当通过。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 使用中文空格目录和带特殊字符参数运行 npm/python/Node 检查；验证 .cmd 支持路径与不支持提示。
- [ ] 2. 测试 PATH/Path、CRLF、stdout UTF-8 分块、长路径/大小写冲突、atomic rename 文件占用。
- [ ] 3. 真实父子进程取消与句柄关闭；不能仅执行杀父进程后宣称全树清理；不可核验后代保留错误。
- [ ] 4. PowerShell 命令示例检查 $LASTEXITCODE，不能误用 Bash 的 $?；绝对缓存按平台隔离。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 中文目录真实 run | 报告与参数正确 |
| 文件正被占用 | 可诊断失败，不半写 |
| 取消时有派生进程 | 自有进程按支持能力清理 |
| 不在 Windows 执行 | 矩阵未测，非 PASS |

**验证命令：**

```text
pnpm exec vitest run tests/compatibility/windows
```

**原稿验收关联：** T18、T22。

**完成门槛：** 必须记录真实 Windows 环境与结果；无 Windows 执行条件则保持验证阻塞。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-071"></a>
#### SG-071 · 完成 WSL/工作树身份与 Git 边界验收

**阶段：** M3　**前置：** SG-012、SG-013、SG-014、SG-049、SG-062　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F03、§15.1、T12—T14/T25

**可独立验收的目标：** 覆盖平台/分支/未跟踪输入导致的失效，不复用错误工作区结果。

**创建 / 修改文件：** 新增 tests/compatibility/wsl-platform.test.ts、tests/acceptance/{T12-untracked-change,T13-during-run-change,T14-target-advance,T25-merged-candidate}.test.ts。

**输入输出与共享接口：** 同目录不同平台身份不共享含绝对路径的运行缓存；实际整合候选必须重新运行。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 同一个仓库的 native/WSL 使用不同 platform_id 和状态命名空间；仅复制报告不能自动 freshness=FRESH。
- [ ] 2. 真实临时 Git 仓库覆盖 untracked、index/worktree 不同、运行中变化、目标前进和两个分支整合失配。
- [ ] 3. 两个分支分别通过后构造合并候选失败，证明不能合并两份报告来代替测试。
- [ ] 4. 子模块/LFS/冲突用独立 fixture 验证明确拒绝；不要偷偷下载缺对象或修改用户 Git 设置。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 原 SHA 不变但 untracked 改 | STALE4 |
| 运行中修改后未恢复 | STALE4 |
| 目标 tip 前进 | 按严格策略要求重验 |
| 两份各自 PASS，整合坏 | 新 run FAIL |

**验证命令：**

```text
pnpm test:acceptance -- --ids T12,T13,T14,T25
pnpm exec vitest run tests/compatibility/wsl-platform.test.ts
```

**原稿验收关联：** T12、T13、T14、T25。

**完成门槛：** 身份与整合规则有真实 Git 操作证据；WSL 未实际测不能标认证。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-072"></a>
#### SG-072 · 完成网络、引用、参数和资源安全反例

**阶段：** M3　**前置：** SG-019、SG-032、SG-054、SG-057、SG-061、SG-069　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §16、T18—T21

**可独立验收的目标：** 验证 P0 保护边界，防止安全说明仅停留在文案。

**创建 / 修改文件：** 新增 tests/acceptance/{T18-cancel-owned,T19-attach-preserved,T20-external-ref}.test.ts、tests/security/{argv-injection,origin-redirect,path-traversal}.test.ts。

**输入输出与共享接口：** 安全测试只针对本机临时监听器/临时目录/专用容器；不扫描或攻击真实外部服务。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 外部 ref 指向本机计数服务器，断言请求数0；本地越界/符号链接和 XML 实体引用断言无读取。
- [ ] 2. 所有直接控制请求检查允许 origin/重定向，项目脚本自身网络边界仍由执行环境约束。
- [ ] 3. 测试命令参数包含 shell 元字符，验证只收到一个 argv；不通过字符串替换作所谓安全 shell。
- [ ] 4. 取消与 clean 保留另一个测试用户服务和非自有容器；同时保存故障证据。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 越界 ref/SSRF | 拒绝且无请求 |
| argv 含 ; 或 & | 不能创建第二条命令的哨兵文件 |
| attach 清理 | 原服务存活 |
| 另一项目资源 | 保持不动 |

**验证命令：**

```text
pnpm test:acceptance -- --ids T18,T19,T20
pnpm exec vitest run tests/security
```

**原稿验收关联：** T18、T19、T20、T21。

**完成门槛：** 默认保护有可运行反例；剩余的恶意代码沙箱边界明确。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-073"></a>
#### SG-073 · 实现 T01—T27 注册表与验收执行器

**阶段：** M3　**前置：** SG-064、SG-065、SG-066、SG-067、SG-068、SG-069、SG-070、SG-071、SG-072　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §19.2

**可独立验收的目标：** 将原稿发布标准落实为可选择、可追踪、不会因 skip 假通过的测试入口。

**创建 / 修改文件：** 新增 tests/acceptance/registry.json、scripts/run-acceptance.mjs、tests/acceptance/{T15-missing-report,T16-flaky,T23-handoff-stale,T24-report-exit,T26-existing-failure,T27-policy-relaxation}.test.ts。

**输入输出与共享接口：** registry 每条有 source_id/test_path/required_platforms/required_tools；run-acceptance 输出 executed/failed/blocked/not_run，缺必检非零。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 补齐尚未在 M3 建立的 T15/T16/T23/T24/T26/T27 包装，调用真实 CLI/存储和相应行为，不只复述纯函数结果。
- [ ] 2. 对 T01—T27 建一一映射；检查未知 ID、重复 ID、空选择、test 文件不存在和未实际执行的结果。
- [ ] 3. T28 明确 P1 excluded，不能用该项未实现阻断 P0，也不能把它算作已通过。
- [ ] 4. 环境缺失将所需测试标 BLOCKED/NOT_RUN 并令 release 验证非零；不自动加 skip 使发布绿。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 指定不存在 T99 | 非零具体错误 |
| 有27注册项但只执行26 | 发布不通过 |
| T28 未实现 | 清楚 P1，不计 P0 |
| 底层测试命令返回0但缺记录 | 验收 runner 非零 |

**验证命令：**

```text
pnpm test:acceptance -- --ids T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T11,T12,T13,T14,T15,T16,T17,T18,T19,T20,T21,T22,T23,T24,T25,T26,T27
```

**原稿验收关联：** T01、T02、T03、T04、T05、T06、T07、T08、T09、T10、T11、T12、T13、T14、T15、T16、T17、T18、T19、T20、T21、T22、T23、T24、T25、T26、T27。

**完成门槛：** 每项有真实文件/命令/结果；总表不以测试名称出现就当执行成功。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-074"></a>
#### SG-074 · 整理不少于 12 个可复现故障夹具

**阶段：** M3　**前置：** SG-009、SG-064、SG-065、SG-066、SG-067、SG-068、SG-072、SG-073　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §19.3、§20.1

**可独立验收的目标：** 为产品演示、回归与后续对照实验积累可运行案例。

**创建 / 修改文件：** 新增 tests/fixtures/scenarios/catalog.json、scripts/materialize-scenario.mjs、docs/fixtures/CATALOG.md、tests/integration/fixtures/catalog.test.ts。

**输入输出与共享接口：** catalog 用 FX-01—FX-12，固定 seed/patch/目标/预期拒绝原因；materialize 只创建自有临时 Git 仓库，不修改用户工程。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 夹具覆盖字段改名、嵌套变化、number/string、required/null、请求必填、响应枚举、删测试、Mock 假通过、旧服务、动态消费者、外部 ref 和整合失配。
- [ ] 2. 每个夹具附故障注入、目标、最小检查、预期 evidence、修复方向和限制；CLI 实际运行才产结果。
- [ ] 3. 至少核心联调与来源类夹具使用真实服务/浏览器，其余可用真实契约/进程工具；明确测试层级。
- [ ] 4. 夹具修复不修改评价标准；不能针对 FX 编号在生产引擎硬编码通过或失败。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 连续 materialize 两次同 fixture | 核心输入可复现，随机目录身份不同 |
| 应用修复后重新执行 | 预期结果改变且证据真实 |
| 脚本目标指向现有非自有目录 | 拒绝覆盖 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/fixtures/catalog.test.ts
pnpm verify:schemas
```

**完成门槛：** 至少12个实际可运行故障样例；不是12行宣传描述。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-075"></a>
#### SG-075 · 实现性能基准与框架成本分解

**阶段：** M3　**前置：** SG-015、SG-034、SG-041、SG-046、SG-074　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §17.1—17.4

**可独立验收的目标：** 实际测出扫描/计划/报告成本，不把模型或项目测试耗时混入宣传。

**创建 / 修改文件：** 新增 scripts/benchmark.mjs、tests/fixtures/benchmark/generator.mjs、schemas/0.1/benchmark.schema.json、docs/benchmarks/method.md。

**输入输出与共享接口：** 基准固定 2000 个纳入文件/总量≤20MB/OpenAPI≤2MB，记录机器/平台/存储/版本/轮次与 cold/warm。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 生成确定性输入；独立测 doctor、缓存后 plan、已完成报告读取和额外框架耗时。
- [ ] 2. 先预热再多轮记录，保存原始样本后计算 p50/p95；选择定义写在方法中，不能挑最快值。
- [ ] 3. 对照目标 doctor p95≤5s、warm plan≤2s、summary≤1s；未达目标记录实测并定位，不改小样本假达标。
- [ ] 4. 不计算无法观察的订阅账单/token 节省，用户业务测试时长和模型耗时另列。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 相同输入重复基准 | 有全样本和环境字段 |
| 记录中缺实际测量 | schema 拒绝完成结果 |
| 硬件不足/无工具 | 标未测，不能填目标值当结果 |

**验证命令：**

```text
pnpm bench
```

**完成门槛：** 产出真实基准 JSON 和限制；目标不是已测事实。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-076"></a>
#### SG-076 · 建立平台与工具组合的验证矩阵

**阶段：** M3　**前置：** SG-010、SG-020、SG-053、SG-062、SG-070、SG-071、SG-073、SG-075　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §15.1、§19.1、§21.2

**可独立验收的目标：** 把支持声明绑定到实际运行组合。

**创建 / 修改文件：** 新增 tests/compatibility/matrix.json、scripts/verify-compatibility.mjs、docs/COMPATIBILITY.md；更新 tools/compatibility-lock.json。

**输入输出与共享接口：** 每个组合 status=PASS|FAIL|BLOCKED|NOT_RUN，包含精确 Node/OS/Git/oasdiff/Playwright/Python/FastAPI/Compose 与证据引用。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 区分 native Windows CLI、WSL/Linux CLI、Linux CI、Docker Desktop/Engine 的实际测试范围。
- [ ] 2. 只运行 capability 符合的合同，但 P0 宣称支持组合缺测必须阻塞认证；macOS 不未经验证升格。
- [ ] 3. Docker/浏览器不具备时保留工具无关单测成果，同时标真实联调未验证。
- [ ] 4. 新版本兼容必须实跑，不接受“API 没变化所以应该没问题”的记录。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| Windows 项仅 Linux 日志 | 拒绝认证 |
| 工具版本与 lock 不符 | 重新验证或阻塞 |
| 矩阵有 NOT_RUN 必需组合 | release 非零 |

**验证命令：**

```text
node scripts/verify-compatibility.mjs
pnpm test:contract
```

**完成门槛：** 支持表与实际版本和证据相符，未验证状态不被统计成通过。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-077"></a>
#### SG-077 · 完成真实全栈闭环阶段出口

**阶段：** M3　**前置：** SG-062、SG-063、SG-064、SG-065、SG-066、SG-067、SG-068、SG-069、SG-070、SG-071、SG-072、SG-073、SG-074、SG-075、SG-076　**初始状态：** NOT_STARTED

**需求依据：** 原稿 M3、§19.1—19.2

**可独立验收的目标：** 证明核心产品不是演示报告器，而是能真实拦截并重验。

**创建 / 修改文件：** 新增 tests/integration/stages/m3.test.ts、tests/fixtures/stages/M3.json、docs/implementation/evidence/M3-summary.md。

**输入输出与共享接口：** M3 必须实际执行负例→证据→修复后新 run→新 gate，同时覆盖来源/取消/漂移反例。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 在与开发者当前工作区隔离的临时副本执行完整 CLI 演示，保存真实 stdout/exit/产物。
- [ ] 2. 检查后端访问、Playwright 断言、当前输入/目标/任务一致；验证故障FAIL、修复PASS、旧结果STALE。
- [ ] 3. 核对 T01—T27 各自状态和平台缺口；未具备的外部验证保持可见，不通过手工涂绿 stage。
- [ ] 4. 主 Agent 审查整合状态、运行 schema/boundaries 回归，然后更新 architecture-map 与下一项。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 默认演示故障 | 真实拒绝 |
| 合法修复且所有前提满足 | 新运行允许 |
| 任意核心证据缺失 | 不能宣称 M3 完整通过 |

**验证命令：**

```text
pnpm verify:stage -- --stage M3
```

**完成门槛：** 核心全栈闭环已在声明平台实测；进入产品化阶段而非继续扩 P1 功能。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。


### M4 阶段任务

<a id="sg-078"></a>
#### SG-078 · 构建单一发行包与可加载的 reporter 入口

**阶段：** M4　**前置：** SG-050、SG-053、SG-077　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §9.5、§20.2；E01

**可独立验收的目标：** 让安装产物包含真实 CLI、schema、预设和 reporter，而不是只能在作者仓库运行。

**创建 / 修改文件：** 新增 scripts/pack-local.mjs、tests/integration/package/contents.test.ts；更新 package.json、scripts/build.mjs、apps/cli/src/version.ts。

**输入输出与共享接口：** 发行 bin=stackgate，内部 CLI=dist/cli.mjs；reporter 使用明确 exports 子路径；未确定公开包名时 package 保持 private=true。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 先验证 tarball 的必需文件清单与禁止文件清单；所有模板按打包后路径定位，不能相对开发 cwd 查找。
- [ ] 2. 构建 CLI、reporter 和运行时 schema，固定 ESM/CJS 边界；不把 TypeScript 源路径 alias 留给最终用户解析。
- [ ] 3. 检查 production dependencies、许可证文件、schema_version、产品版本和帮助输出；保留框架运行时独立性。
- [ ] 4. 排除 tests/fake、运行 state、凭证、个人绝对路径和原始 trace；打包仅落在本地 dist/releases。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 临时目录解包执行 --help | 成功且无需源码目录 |
| 安装包 reporter exports 缺失 | 打包检查失败 |
| tarball 含本地 state/token | 拒绝候选包 |

**验证命令：**

```text
pnpm build
pnpm pack:local
pnpm exec vitest run tests/integration/package/contents.test.ts
```

**完成门槛：** 真实本地 tarball 存在且有摘要；不上传 registry，不冒用未确认包名。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-079"></a>
#### SG-079 · 完成 fastapi-react 可运行初始化预设

**阶段：** M4　**前置：** SG-027、SG-051、SG-052、SG-053、SG-054、SG-055、SG-057、SG-078　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F01、§4、§12、§20.1

**可独立验收的目标：** 把首次接入需要的脚本、配置和说明连成可验证路径。

**创建 / 修改文件：** 新增 presets/fastapi-react/{preset.json,config.template.yaml,task.template.yaml,mappings.template.yaml,README.md}、tests/integration/preset/generated-project.test.ts；更新 init。

**输入输出与共享接口：** PresetManifest 声明输入条件、拟写文件、依赖需求与模板摘要；init 只写草案，不安装包、启动环境或自动批准任务。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 所有模板字段通过实际 schema 校验，所有生成文件/命令指向真实存在的 helper、reporter、测试及产物协议。
- [ ] 2. 目标项目不存在必需测试时输出接入缺口，不凭模板造一个已验收结果；保留 DRAFT 状态和命令权限预览。
- [ ] 3. 对已有 package.json/Playwright config 输出精确补丁，不覆盖用户原设置；动态 Compose 来源按 E17 绑定。
- [ ] 4. 在干净临时工程真实执行 dry-run→apply→人工等价摘要确认→plan→run→gate；测试代码可显式模拟授权输入，但产品不代替用户授权。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| dry-run | 业务文件无变化 |
| 已有同名用户文件 | 输出冲突，不覆盖 |
| 生成配置引用不存在脚本 | 模板验证失败 |
| 目标没有 OpenAPI | 展示缺口，不宣称完整接入 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/preset/generated-project.test.ts
pnpm verify:schemas
```

**完成门槛：** 预设至少一条可重复的完整路径；文档步骤与真实命令一致。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-080"></a>
#### SG-080 · 交付 Codex 的薄 Skill 入口

**阶段：** M4　**前置：** SG-043、SG-044、SG-078、SG-079　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §14.1—14.2；官方 W02

**可独立验收的目标：** 让 Codex 用现有授权调用同一 CLI，不重新实现验收规则。

**创建 / 修改文件：** 新增 integrations/codex/stackgate-verify/{SKILL.md,references/result-contract.md,references/failure-handoff.md}、tests/contract/integrations/codex-skill.test.ts。

**输入输出与共享接口：** 安装目标 .agents/skills/stackgate-verify；frontmatter 含 name/description；引用文件全部随入口分发。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 写明适用任务、先看当前任务/计划、新鲜度校验、运行权限、JSON 解读、失败修复和重新验收步骤。
- [ ] 2. 入口只索引按需资料，不把整份架构/日志注入上下文；不可要求修改全局 AGENTS.md 或迁移宿主认证文件。
- [ ] 3. 失败时区分业务问题、环境问题、工具问题与 stale；保留不得擅改目标/删测试以及最终引用 run_id/范围的要求。
- [ ] 4. 静态验证 frontmatter、路径、示例 CLI 和禁止动作；官方可选元数据只在实际支持版本验证后启用，不引入 P1 Hooks。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 从已安装目录读取引用 | 所有文件存在 |
| gate=DENY 但 report 命令0 | Skill 不得宣称通过 |
| 宿主不在环境中 | 静态检查可完成，真实宿主测试保留未测 |

**验证命令：**

```text
pnpm exec vitest run tests/contract/integrations/codex-skill.test.ts
```

**完成门槛：** Skill 可独立分发；没有复制另一份 Gate 算法或自动启动付费会话。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-081"></a>
#### SG-081 · 交付 Claude Code 插件与手动工作流

**阶段：** M4　**前置：** SG-043、SG-044、SG-078、SG-079、SG-080　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §14.1、§14.3；官方 W03

**可独立验收的目标：** 提供结构正确、可本地加载且复用相同结果合同的 Claude 入口。

**创建 / 修改文件：** 新增 integrations/claude-code/{.claude-plugin/plugin.json,skills/verify/SKILL.md,skills/handoff/SKILL.md,references/result-contract.md,references/failure-handoff.md}、tests/contract/integrations/claude-plugin.test.ts。

**输入输出与共享接口：** .claude-plugin 仅存 manifest，skills/references 位于插件根；工作流不输出宿主 Hook 返回码。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 设置有效 manifest 与本地组件路径；Skills 明确手动触发有副作用检查，按实际宿主版本核对调用限制字段。
- [ ] 2. 共享结果/交接说明从单一模板生成到分发目录；不能通过跨插件根相对路径读取仓库其他文件。
- [ ] 3. 支持本地 --plugin-dir 验证路径，不编造 marketplace 名或安装 URL；静态检查与真实宿主加载分开记录。
- [ ] 4. 有 Claude CLI 时执行官方 plugin validate，记录版本和输出；缺少宿主标 NOT_RUN，不以自写 JSON 校验冒充官方验证。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 把 skills 放进 .claude-plugin | 结构测试拒绝 |
| references 超出分发根 | 拒绝 |
| 未配置 Hooks | P0 正常，不自行补自动 Stop 检查 |

**验证命令：**

```text
pnpm exec vitest run tests/contract/integrations/claude-plugin.test.ts
claude plugin validate ./integrations/claude-code
```

**完成门槛：** 目录与官方验证一致；宿主缺失只保留静态实现状态，不谎称真实加载通过。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-082"></a>
#### SG-082 · 实现安全安装、升级与移除 Agent 入口

**阶段：** M4　**前置：** SG-018、SG-027、SG-045、SG-078、SG-080、SG-081　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §13.1、§20.3；E13

**可独立验收的目标：** 安装和卸载不破坏用户已有规则或手工改动。

**创建 / 修改文件：** 新增 packages/core/src/services/adapter-installation.ts、apps/cli/src/commands/adapters.ts、tests/integration/integrations/ownership.test.ts。

**输入输出与共享接口：** adapters install/remove 默认 preview；--apply 应用已显示变更；InstallationManifest 保存生成文件摘要、版本及目标平台。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 默认项目级安装，不自动改用户全局目录；明确每个拟写文件、冲突及所需权限。
- [ ] 2. 已生成且摘要不变的文件可升级/移除；用户修改过的文件展示差异并保留，不靠同名判断所有权。
- [ ] 3. 路径逃逸、符号链接、只读目录和中途失败均保持可诊断；可逆写入先暂存再提交，失败不留半套入口。
- [ ] 4. 卸载入口与清理 state 分开；不删除契约、验收测试、业务源码或原始文档。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 安装后用户修改 SKILL.md 再卸载 | 保留该文件并解释 |
| 用户已有同目录不同内容 | 预览冲突，不覆盖 |
| 安装中断 | 原文件保持或有明确可恢复台账 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/integrations/ownership.test.ts
```

**完成门槛：** 两宿主均覆盖 install/update/remove；不存在全局规则无提示修改。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-083"></a>
#### SG-083 · 实现 GitLab 门槛包装器和退出码传递

**阶段：** M4　**前置：** SG-040、SG-042、SG-044、SG-061、SG-078　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §15.3；官方 W04

**可独立验收的目标：** CI 展示报告的成功不能覆盖实际验收失败。

**创建 / 修改文件：** 新增 integrations/gitlab/{stackgate.gitlab-ci.yml,run-gate.mjs,README.md}、tests/integration/ci/gitlab-exit.test.ts。

**输入输出与共享接口：** run-gate.mjs 捕获 run/gate 的真实 code，报告仅作展示；结束进程返回按合同计算的最严格失败 code。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 显式记录被测候选和基线；分离计划、执行、最新 gate、报告导出与清理，不用无条件 || true 掩盖结果。
- [ ] 2. 即使 run 非零也尝试导出已经生成的安全报告；没有 run_id 时写启动诊断，不能随意取上一轮目录。
- [ ] 3. JUnit 仅展示；job 是否成功由脚本退出决定；仅上传常规脱敏产物，restricted trace 默认不在 artifacts 路径。
- [ ] 4. 模板写明 trusted runner/policy 由维护者部署，当前文件若来自候选代码不能自行成为可信门槛；SG-084 补齐外部边界。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| run=1/report=0 | job 非零，不能绿 |
| run=0/gate=4 | job 返回4 |
| run=3 未生成完整 manifest | 保留诊断，不读取旧运行 |
| 清理出现安全状态 ERROR | 按优先级保留3 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/ci/gitlab-exit.test.ts
```

**原稿验收关联：** T24。

**完成门槛：** 真实子进程退出链有测试；模板没有通过 JUnit 文件存在来放行。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-084"></a>
#### SG-084 · 实现可信 CI 策略装载与候选代码边界

**阶段：** M4　**前置：** SG-016、SG-018、SG-058、SG-073、SG-083　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §12.1、§15.4、§16.4；E14

**可独立验收的目标：** 候选 MR 不能通过修改自身策略、工具或 CI 标志授予自己权限。

**创建 / 修改文件：** 新增 packages/core/src/services/trusted-policy.ts、integrations/gitlab/trusted-runner/README.md、tests/integration/ci/trusted-policy.test.ts、docs/security/ci-trust-boundary.md。

**输入输出与共享接口：** TrustedPolicyContext 由维护者控制入口传入固定策略/CLI/工具摘要及候选身份；仓库中的 confirmation_source 字符串不构成可信凭据。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 外部可信配置路径、执行器和工具版本必须由维护者入口选定；候选提供的扩展只能收紧，不可删除必检或扩大权限。
- [ ] 2. 将候选构建/测试置于无生产密钥的专用执行环境，禁止不可信 worker 挂 Docker socket 或写可信 CLI/策略目录。
- [ ] 3. 只有受控检出/构建/实例/请求链均成立才满足 CONTROLLED；CI=true、容器存在、应用自报 SHA 均不足。
- [ ] 4. 针对伪造策略路径、替换 runner、修改必检配置写真实拒绝测试；组织 runner/网络/合并规则无法在本地证明时标部署阻塞，保留可执行配置说明。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 候选移除 unit/e2e 必检 | 有效策略仍要求并拒绝放宽 |
| 自填 trusted-ci+CI=true | 不升格 |
| candidate 尝试覆盖外部工具路径 | 拒绝或隔离测试阻止 |
| worker 输出自报 PASS | 仍需可信采集与完整性；不宣称可抵抗所有恶意脚本 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/ci/trusted-policy.test.ts
pnpm test:acceptance -- --ids T27
```

**原稿验收关联：** T27。

**完成门槛：** 本地信任单测与真实 CI 权限验收分别记录；未配置真实 runner 不可声明组织级保护已生效。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-085"></a>
#### SG-085 · 验证合并候选、基线推进和 CI 反绕过

**阶段：** M4　**前置：** SG-012、SG-014、SG-071、SG-083、SG-084　**初始状态：** NOT_STARTED

**需求依据：** 原稿 S05、F03、§15.3；官方 W13

**可独立验收的目标：** 当前分支绿不自动成为与目标分支整合后的绿。

**创建 / 修改文件：** 新增 integrations/gitlab/resolve-candidate.mjs、tests/integration/ci/merge-candidate.test.ts、docs/ci/merge-strategy.md。

**输入输出与共享接口：** CandidateContext 记录 source_oid、target_tip_oid、tested_oid、merge_mode；gate 按已确认基线新鲜度策略复核。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 识别真实检出的是源分支还是合成合并候选，明确支持的 GitLab 模式和缺少对象时的诊断。
- [ ] 2. 使用实际临时 Git 分支构造分别通过、合并后不兼容案例；不把两份子分支报告拼成总通过。
- [ ] 3. 网络 fetch 必须属于已授权 CI 配置，本地 gate 不静默联网更新远端；不能查询时新鲜度为未验证或基于已声明本地视图。
- [ ] 4. 目标推进、浅克隆缺对象、MR 改变流水线脚本均有边界测试；维护者合并规则另行明确设置。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 目标 tip 改变而旧 plan 保留 | 拒绝或按固定策略要求重算 |
| 两个 source run 都PASS而merge失败 | 整体DENY |
| 仅有浮动 origin/main 字符串 | 不能当固定证据 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/ci/merge-candidate.test.ts
pnpm test:acceptance -- --ids T14,T25,T27
```

**原稿验收关联：** T14、T25、T27。

**完成门槛：** CI 报告能准确说出测了哪个候选；缺少仓库外治理不被掩盖。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-086"></a>
#### SG-086 · 完成数据、规则和安装升级兼容策略

**阶段：** M4　**前置：** SG-047、SG-078、SG-082、SG-084　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §11.3、§20.3

**可独立验收的目标：** 升级不会悄悄改历史证据或改变门槛语义。

**创建 / 修改文件：** 新增 docs/migrations/0.1.md、tests/contract/migrations/read-compatibility.test.ts；更新 packages/contracts/src/versioning.ts、adapters 安装记录。

**输入输出与共享接口：** 读取旧 schema 仅按声明兼容范围；不可读历史返回 VERSION_UNSUPPORTED 并保留；规则变更记录 rule_set_version。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 制作同主版本声明扩展、未知字段、未来主版本和损坏旧记录夹具，验证不同处理路径。
- [ ] 2. 迁移仅生成新副本及来源索引，不改 sealed historical Run；降级保留原始文件与对应版本说明。
- [ ] 3. 工具/规则升级改变 evidence identity，旧 plan 不能用新解析结果直接继续；给出重新计划指令。
- [ ] 4. 升级模板先比安装摘要再出补丁，用户修改的入口不自动覆盖。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 旧报告含不支持的新主版本 | 明确拒绝，不静默丢字段 |
| 升级后执行旧计划 | 版本身份不符需重新计划 |
| 用户修改入口 | 升级保留差异 |

**验证命令：**

```text
pnpm exec vitest run tests/contract/migrations/read-compatibility.test.ts
```

**完成门槛：** 历史只读原则与当前兼容规则一致；没有静默重写成功事实。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-087"></a>
#### SG-087 · 写出可独立接入的用户与贡献者文档

**阶段：** M4　**前置：** SG-076、SG-079、SG-080、SG-081、SG-082、SG-083、SG-085、SG-086　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §20.1—20.3、§21

**可独立验收的目标：** 让新用户不依赖作者现场修改脚本就能接入已支持范围。

**创建 / 修改文件：** 新增或完善 README.md、docs/{QUICKSTART,SECURITY,COMPATIBILITY,SCHEMAS,CONTRIBUTING,DIAGNOSTICS}.md、CHANGELOG.md、docs/adr/；新增 scripts/verify-docs.mjs。

**输入输出与共享接口：** 所有命令来自真实 CLI help；安装示例使用已生成本地 tarball，公开安装地址仅在真实发布后补充。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. README 先演示 Mock单测绿→联调失败→合法修复后新验收，明确不支持范围和环境来源限制。
- [ ] 2. QUICKSTART 分只读/完整验收两条路径，包含权限预览、目标确认、清理、卸载、常见 Windows/Docker 问题。
- [ ] 3. SECURITY 说明同身份本地可绕过、脚本非沙箱、网络allowlist局限、trace不能保证脱敏、可信 CI 要求。
- [ ] 4. CONTRIBUTING 定义增加适配器/规则必须添加的支持矩阵与反例；用链接/命令检查验证文档，不杜撰下载数字或用户评价。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 文档引用不存在命令/文件 | verify-docs 非零 |
| 写100%保证质量 | 文案审查拒绝 |
| 只给故障演示无清理 | 文档缺口必须补齐 |

**验证命令：**

```text
node scripts/verify-docs.mjs
pnpm verify:schemas
```

**完成门槛：** 技术文档匹配实际发行包；未测和未来功能明确标识。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-088"></a>
#### SG-088 · 核查许可、依赖来源、名称与公开发布权限

**阶段：** M4　**前置：** SG-010、SG-078、SG-087　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §20.2、§21.2

**可独立验收的目标：** 公开发布前形成真实、可审查的供应链与授权记录。

**创建 / 修改文件：** 新增 docs/release/{name-and-license-review.md,dependency-inventory.json}、scripts/verify-dependency-inventory.mjs；确认许可后再写 LICENSE。

**输入输出与共享接口：** Inventory 记录直接/随包再分发依赖的名称、精确版本、来源、license、校验摘要与再分发方式；未知项保持未决，不自行判合法。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 从 lockfile 和最终 tarball 提取实际依赖，不依据 package.json 大版本范围猜测；记录外部 oasdiff 是否由用户安装而非打入包。
- [ ] 2. 联网核查计划公开仓库/包/组织名占用并记录日期与结果；不能把不存在访问权限误判为空闲。
- [ ] 3. 提出适合的许可备选及需人工决定的差异；未经用户决定不假称其授权 MIT，也不随意复制第三方源码。
- [ ] 4. 把 npm登录/发布、远程仓库创建/push、商标使用等列为单独授权动作；本任务不实际执行外部变更。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 依赖清单与tarball不一致 | 拒绝发布准备通过 |
| 许可或包名未知 | 保留阻塞 |
| 无用户发布授权 | 本地候选可留存，禁止发布 |

**验证命令：**

```text
node scripts/verify-dependency-inventory.mjs
```

**完成门槛：** 事实核查记录可审查；需要人工决定的项保持 BLOCKED，而不是为了完成计划臆造结论。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-089"></a>
#### SG-089 · 执行干净安装、离线运行和卸载烟测

**阶段：** M4　**前置：** SG-078、SG-079、SG-080、SG-081、SG-082、SG-086　**初始状态：** NOT_STARTED

**需求依据：** 原稿 M4、§20.3

**可独立验收的目标：** 发行包脱离仓库和开发依赖后仍能执行声明功能。

**创建 / 修改文件：** 新增 scripts/test-package.mjs、tests/integration/package/{install,offline,uninstall}.test.ts。

**输入输出与共享接口：** test:package 在唯一临时目录安装本地tarball；只使用 lock 中已准备依赖，不自动下载浏览器或启动付费宿主。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 先检查当前网络/依赖安装授权；明确安装时可能需要registry，运行核心无需模型key，不能把这两个事实混淆。
- [ ] 2. 从中文/空格路径执行 help/doctor/scan，读取包内schema，加载reporter，并走一次安全预设初始化。
- [ ] 3. 确认无开发源码别名、测试fake和未打包模板依赖；已有项目Playwright不被隐式升级。
- [ ] 4. 安装两个Agent入口再移除，确保用户自有文件和测试服务保留；测试目录之外不写全局路径。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 删除原开发仓库的可见性后执行 | 功能仍可运行 |
| 缺必要外部oasdiff | 明确能力缺失，不联网偷偷安装 |
| 无模型密钥 | 确定性CLI正常运行 |

**验证命令：**

```text
pnpm pack:local
pnpm test:package
```

**完成门槛：** 烟测来自真实tarball而非直接import源码；记录平台与安装前提。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-090"></a>
#### SG-090 · 收口 CLI 体验、机器协议和大型产物预算

**阶段：** M4　**前置：** SG-041、SG-042、SG-044、SG-069、SG-075、SG-087、SG-089　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F13/F14、§13.1、§17.1

**可独立验收的目标：** 使用户和Agent读取结果时不需猜测命令语义或遍历全部日志。

**创建 / 修改文件：** 新增 tests/integration/cli/{json-contract,errors,large-artifacts}.test.ts；更新 apps/cli/src/presentation/ 与 docs/DIAGNOSTICS.md。

**输入输出与共享接口：** 每条命令的 stdout JSON 只有一个完整 envelope；stderr仅进度/诊断；exit与业务gate语义一致。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 遍历所有P0命令的正常/错误/取消/无权限输入；路径与ID具体提示，不将内部堆栈作为唯一用户解释。
- [ ] 2. 报告首屏为结论/被测范围/阻塞/未验证/下一步，耗时和完整日志后置；手动建议不成为可执行shell字符串。
- [ ] 3. 100MB/run默认预算优先结构证据，日志截断标注，trace restricted；任何关键证据丢失都影响完整性。
- [ ] 4. 对CLI新增参数同步help/schema/文档与测试，确保--json下不混入ANSI/banner。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| stderr大量输出 | stdout仍可JSON.parse |
| 缺少必需证据因预算截断 | 不得PASS |
| report退出0但历史FAIL | envelope区分命令成功与门槛 |

**验证命令：**

```text
pnpm exec vitest run tests/integration/cli
```

**原稿验收关联：** T15、T21、T24。

**完成门槛：** 人读与机读结果引用同一事实，CLI 不隐含第二套宽松判定。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-091"></a>
#### SG-091 · 执行两宿主实际加载与交接验证

**阶段：** M4　**前置：** SG-080、SG-081、SG-082、SG-089、SG-090　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §14、T23；官方 W02/W03

**可独立验收的目标：** 区分静态入口通过和真实Codex/Claude使用通过。

**创建 / 修改文件：** 新增 docs/compatibility/agent-host-smoke.md、tests/compatibility/agent-host-results.schema.json、scripts/validate-host-results.mjs。

**输入输出与共享接口：** HostSmokeResult记录宿主精确版本、安装方式、任务/run、命令和结果；缺宿主/账户/授权标NOT_RUN。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 先验证本地加载和Skill路径；需要调用模型的步骤必须获得用户当前授权，不能默认消耗订阅或导入认证。
- [ ] 2. 用同一故障run分别生成Codex/Claude交接，检查二者读取同样任务与证据、都遵守不得擅改契约。
- [ ] 3. 在接手前改变task revision，验证旧包被识别；实际模型解释偏离时记录，不修改核心结果配合解释。
- [ ] 4. 保留可复现的脱敏步骤和实际观察，不能用生成的理想对话代替宿主执行日志。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 只做了静态manifest校验 | 不能声称宿主实测 |
| 宿主看到旧任务 | 必须先重新校验 |
| 没有付费调用授权 | 停在加载检查，说明未测范围 |

**验证命令：**

```text
node scripts/validate-host-results.mjs
pnpm test:acceptance -- --ids T23
```

**原稿验收关联：** T23。

**完成门槛：** 两平台真实使用状态有证据；不足时不认证相应平台，也不阻止无关核心修复。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-092"></a>
#### SG-092 · 执行全部 P0 与发布矩阵回归

**阶段：** M4　**前置：** SG-073、SG-076、SG-083、SG-084、SG-085、SG-086、SG-089、SG-090、SG-091　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §19.1—19.2、§21.2

**可独立验收的目标：** 在最终整合与打包代码上证明必检仍成立。

**创建 / 修改文件：** 新增 scripts/verify-release.mjs、tests/integration/release/readiness.test.ts、docs/implementation/evidence/release-regression.md。

**输入输出与共享接口：** ReleaseReadiness含所有T01—T27、平台/宿主/工具矩阵、schema/安全/打包/文档状态；required NOT_RUN/BLOCKED不能算PASS。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 运行完整单测、合同、真实集成、P0验收、平台与tarball烟测；检查实际执行用例而不只工具退出码。
- [ ] 2. 使用最终候选构建，源文件/lock/schema/模板变动后重跑适用检查；不拼接无关联版本的旧结果。
- [ ] 3. 将缺少授权的宿主/真实CI验证与代码错误分开列出，发布readiness非零但保留已验证核心能力。
- [ ] 4. T28与其他P1清晰排除，不能通过把P0降级使readiness通过。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| T01—T27少一项 | 发布门槛不通过 |
| 测试全部来自旧候选 | 新鲜度不满足 |
| T28未做 | 不算P0缺失 |
| Windows必须支持但未测 | 不得全平台发布声明 |

**验证命令：**

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:acceptance
pnpm test:package
pnpm verify:release
```

**完成门槛：** 回归结果对齐同一候选；未知项可见，任何“不完整”未被改名为“通过”。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-093"></a>
#### SG-093 · 生成本地发布候选与证据清单

**阶段：** M4　**前置：** SG-075、SG-078、SG-087、SG-088、SG-089、SG-092　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §20、§16.4

**可独立验收的目标：** 把可分发产物、校验摘要、支持范围和未决事项打包交给用户审查。

**创建 / 修改文件：** 新增 scripts/create-release-candidate.mjs、schemas/0.1/release-manifest.schema.json、docs/release/CHECKLIST.md。

**输入输出与共享接口：** release manifest列tarball摘要/产品版本/tool lock/测试证据/未决项；status=LOCAL_CANDIDATE或READY_FOR_AUTHORIZED_PUBLICATION，不等于已发布。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 仅打包脱敏开发验证、依赖清单、兼容表和用户文档；源repo历史/认证/原始trace不入候选目录。
- [ ] 2. 计算实际tarball和manifest摘要；如使用SBOM工具记录真实工具与输出，不能用手写空JSON冒充完整SBOM。
- [ ] 3. 清楚区分代码质量阻塞、真实平台缺测、人工许可/名称选择和发布授权；不通过编辑checklist隐藏风险。
- [ ] 4. 生成用户可复制的本地安装命令，公开registry URL仍不得虚构；本任务不调用publish/push。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| tarball生成后改变字节 | 摘要核对失败 |
| 有restricted产物 | 候选导出拒绝 |
| 缺公开许可或授权 | 只能本地候选 |

**验证命令：**

```text
node scripts/create-release-candidate.mjs
pnpm verify:release
```

**完成门槛：** 用户拿到真实候选包和准确限制；没有未经授权的外部发布。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-094"></a>
#### SG-094 · 审查需求覆盖、协议一致性与范围漂移

**阶段：** M4　**前置：** SG-087、SG-090、SG-092、SG-093　**初始状态：** NOT_STARTED

**需求依据：** 原稿 F01—F16、§21；本文追溯矩阵

**可独立验收的目标：** 在交付前检查整个实现是否偏离原稿，而不只看测试数量。

**创建 / 修改文件：** 新增 scripts/verify-traceability.mjs、docs/implementation/TRACEABILITY.md、docs/implementation/evidence/design-review.md。

**输入输出与共享接口：** 追溯项 source_requirement→task_ids→actual_files→test_ids→evidence；F16/P1需明确范围，不假称风险接受已实现。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 逐项核对F01—F15的P0部分、T01—T27、五维状态/退出码与ADR；记录真实入口路径而非仅计划路径。
- [ ] 2. 检查schema、TS、模板、CLI、报告之间同名字段、枚举和默认值；禁止私建简化success通道。
- [ ] 3. 查找生产发行依赖tests/fake、硬编码fixture名、强制绿色、无限重试、自动模型路由、Hooks/控制台等范围漂移。
- [ ] 4. 审查所有宣传性表述与实测版本、平台、权限边界；未知问题进入BLOCKERS，不用文档修辞代替实现。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 功能有文件但没有真实验收证据 | 覆盖状态不算完成 |
| P1目录藏入默认入口 | 范围审查失败 |
| schema与TS枚举不同 | 协议检查失败 |

**验证命令：**

```text
node scripts/verify-traceability.mjs
pnpm verify:schemas
pnpm verify:boundaries
pnpm verify:tasks
```

**完成门槛：** 完整追溯矩阵可审查；评审发现已修复或明确阻塞，不空泛写“符合设计”。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-095"></a>
#### SG-095 · 完成首版交付与第三方视角首次使用验收

**阶段：** M4　**前置：** SG-079、SG-082、SG-087、SG-089、SG-091、SG-092、SG-093、SG-094　**初始状态：** NOT_STARTED

**需求依据：** 原稿 M4、§4、§20、§21.3

**可独立验收的目标：** 交付的是可以独立使用的本地产品候选，而不只是开发机器上的演示。

**创建 / 修改文件：** 新增 docs/implementation/evidence/M4-summary.md、docs/release/FIRST_RUN_CHECKLIST.md；更新PROGRESS和architecture-map。

**输入输出与共享接口：** 首次使用记录包含新目录/实际安装包/系统版本/步骤/阻塞/清理结果；不冒充已招募真实外部用户。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 在与源码开发区分离的干净环境，仅按公开QUICKSTART执行只读和完整验收路径，记录任何需作者额外解释的步骤。
- [ ] 2. 验证修改后新验收、跨工具交接、升级移除及不会清理用户服务；修复首次接入缺口后重新验证。
- [ ] 3. 报告M0—M4任务状态、真实命令、tarball路径、平台缺口、未决人工决定和下一步M5，不宣称研究阶段已完成。
- [ ] 4. 只有P0要求和必要平台/宿主/CI实测完整才称对应支持范围的MVP完成；否则交付局部候选并保持相关任务未完成。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 需要源码目录才运行 | 首发验收失败 |
| 文档缺少关键环境确认 | 接入失败记录待修 |
| CI/宿主没有实测 | 限制明确，不标全部完成 |

**验证命令：**

```text
pnpm verify:stage -- --stage M4
pnpm verify:release
```

**完成门槛：** 源码、产物、说明与证据一致；等待用户公开发布授权而不是自行上线。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。


### M5 阶段任务

<a id="sg-096"></a>
#### SG-096 · 建立 A/B/C 对照实验协议和可重复执行框架

**阶段：** M5　**前置：** SG-074、SG-075、SG-095　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §19.3

**可独立验收的目标：** 检验真实净收益，避免只证明产品比弱基线更好。

**创建 / 修改文件：** 新增 research/protocol.md、research/tasks/catalog.json、research/schemas/trial.schema.json、scripts/research/validate-trials.mjs。

**输入输出与共享接口：** 组A=原生Agent+已有测试；B=合理配置现有契约/验收工具；C=相同任务+StackGate；保留统一外部验收oracle。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 固定任务初始快照、验收目标、工具/模型实际版本、可用权限、时间与资源观察口径；基线工具先合理配置。
- [ ] 2. 覆盖不少于12个fixture并划分用于开发规则与留出验证的任务，记录随机化顺序和重复运行次数。
- [ ] 3. 实现结果schema、输入锁和导入校验；模型调用必须独立获授权，不自动启动批量付费实验。
- [ ] 4. 没有真实试验数据时只交付可执行协议与空数据schema，研究状态未完成；不能写入期望收益当测量值。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 同一任务不同组验收条件不同 | 拒绝比较 |
| 缺模型精确版本/初始快照 | 试验不可比 |
| 只导入C组成功案例 | 报告必须显示缺组与选择偏差 |

**验证命令：**

```text
node scripts/research/validate-trials.mjs
```

**完成门槛：** 协议和采集工具可用；实际实验未运行时任务维持IMPLEMENTED_UNVERIFIED。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-097"></a>
#### SG-097 · 准备设计伙伴访谈与真实任务授权材料

**阶段：** M5　**前置：** SG-087、SG-095、SG-096　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §2.1、§19.3

**可独立验收的目标：** 从用户最近的真实返工任务获取证据，而不是收集“听起来不错”。

**创建 / 修改文件：** 新增 research/partners/{interview-guide.md,consent-template.md,task-intake.schema.json,privacy-checklist.md}、scripts/research/validate-intake.mjs。

**输入输出与共享接口：** Intake记录用户授权范围、脱敏仓库/任务材料、允许本地处理与外部分享边界；不默认收集完整代码或聊天。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 访谈围绕最近一次失败、谁发现、原测试为何未发现、人工补救、配置维护成本，不诱导回答会购买。
- [ ] 2. 设计可撤销的材料处理授权和删除流程，禁止索要生产密钥、个人敏感数据或企业未授权源码。
- [ ] 3. 用户自行邀请或另行授权发送邀请；本任务不自动发邮件、爬群或生成虚构受访者。
- [ ] 4. 没有实际伙伴时保留研究材料，真实招募/访谈/案例导入状态为BLOCKED并说明需要的授权。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 材料含生产凭证 | 拒绝导入并提示先脱敏 |
| 没有源码使用授权 | 不能启动真实任务处理 |
| 虚构用户/访谈记录 | 研究校验与人工审查拒绝 |

**验证命令：**

```text
node scripts/research/validate-intake.mjs
```

**完成门槛：** 研究材料可执行；实际伙伴验证只有真实记录出现后才可完成。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-098"></a>
#### SG-098 · 实现可选择的本地指标采集与分析输入

**阶段：** M5　**前置：** SG-075、SG-096、SG-097　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §17.4、§19.3

**可独立验收的目标：** 分开模型资源、框架开销、测试耗时与人工返工，避免单一Token指标误导。

**创建 / 修改文件：** 新增 research/metrics.md、scripts/research/import-metrics.mjs、research/schemas/metrics.schema.json、tests/unit/research/metrics.test.ts。

**输入输出与共享接口：** Metrics记录实际单位/来源/缺失原因；核心产品telemetry仍默认off，不读取宿主认证或完整对话数据库。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 定义人工定位/修复分钟、误报/漏报、首次接入成本、总轮次、已验收任务资源和再使用情况；时间口径一致。
- [ ] 2. 缺少模型缓存输入/输出等观察则标null+reason，不由订阅额度推算精确账单；收集需用户明确同意。
- [ ] 3. 导入用户提供的脱敏统计文件，只处理schema列出的字段；输出本地、可预览、可删除。
- [ ] 4. 单测用明确标synthetic的夹具；这些测试数据不能进入真实产品效果结果。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 时间区间重叠 | 避免重复计入总人工时长 |
| 无法观察缓存token | 保留unknown，不能当0 |
| synthetic夹具混入真实trial | 拒绝或严格分组排除 |

**验证命令：**

```text
pnpm exec vitest run tests/unit/research/metrics.test.ts
node scripts/research/validate-trials.mjs
```

**完成门槛：** 指标工具无默认遥测；实测收益必须引用真实trial。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-099"></a>
#### SG-099 · 分析真实实验并作继续/收缩判断

**阶段：** M5　**前置：** SG-096、SG-097、SG-098　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §19.3、§21.3

**可独立验收的目标：** 根据真实使用和返工收益决定产品是否值得扩大。

**创建 / 修改文件：** 新增 scripts/research/summarize-results.mjs、research/results/report.md、research/results/limitations.md。

**输入输出与共享接口：** 分析报告以trial ID追溯样本；列样本数、缺失、失败、分组条件与不确定性；不推断未采集因果关系。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 先验证数据来源/同任务可比性/样本完整性，再汇总中位数与范围等适用指标，保留每个失败记录。
- [ ] 2. 同时看检出质量、人工时间、接入/维护成本和下一次自主复用；不以Star或一次演示替代效果。
- [ ] 3. 真实数据不足时写“尚未得到足够真实试验数据”并列缺口，不生成看起来像实测的百分比。
- [ ] 4. 若只是增加配置没有减少返工，提出收缩技术栈/适配既有工具/暂停扩平台的具体选择；决策由用户审阅。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 只有模拟数据 | 不得生成真实效果结论 |
| 报告忽略失败trial | 追溯审查拒绝 |
| 样本很小 | 披露局限，不宣称统计显著或市场匹配 |

**验证命令：**

```text
node scripts/research/validate-trials.mjs
node scripts/research/summarize-results.mjs
```

**完成门槛：** 真实结论有证据；无数据则保持阻塞，不把完成报告模板当完成市场验证。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。

<a id="sg-100"></a>
#### SG-100 · 形成有证据门槛的后续迭代清单

**阶段：** M5　**前置：** SG-094、SG-095、SG-099　**初始状态：** NOT_STARTED

**需求依据：** 原稿 §18.3、F15/F16、§14.4、T28

**可独立验收的目标：** 把扩展需求交给下一轮评审，避免首版无限膨胀。

**创建 / 修改文件：** 新增 docs/roadmap/post-mvp.md、research/decisions/next-iteration.md、docs/implementation/evidence/M5-summary.md。

**输入输出与共享接口：** 每个P1候选记录用户证据、收益假设、前置接口、安全约束、验收和“不做”条件；不在本任务实现新功能。

**执行步骤：**

- [ ] 在指定测试/检查文件中落实下表用例，先运行并确认失败原因与本任务相关；已有等价测试时复用并补缺口。
- [ ] 1. 按真实需求评估Vue/SpringBoot、GitHub Actions、离线HTML、更丰富AST、局部证据MCP、有限Hooks和资源隔离。
- [ ] 2. Hooks单列T28：显式启用、短检查、同输入有界提醒、宿主返回码映射、取消/权限错误不构成自动续行授权。
- [ ] 3. 自动修复与风险接受仍需新的授权/费用/轮次/来源设计；不能以做完MVP为由静默开放。
- [ ] 4. 更新产品决策、未决风险和下轮范围；数据不足时保持候选而非编造优先级依据。
- [ ] 执行下列验证及受影响回归，保存真实命令、退出码、实际测试数与脱敏证据；更新任务账本，不把未运行结果标通过。

**具体测试与反例：**

| 输入 / 操作 | 必须断言的结果 |
|---|---|
| 没有真实需求证据 | 候选而非承诺排期 |
| P1计划开始写自动部署代码 | 范围违规 |
| Hook设计允许无限Stop重入 | 下一轮设计不通过 |

**验证命令：**

```text
pnpm verify:tasks
node scripts/verify-traceability.mjs
```

**原稿验收关联：** T28。

**完成门槛：** M5总结区分已验证与待验证；后续实现等待用户对新范围的明确授权。

**提交与续接：** 检查本任务 diff，不加入无关文件；有本地提交授权时只提交相关改动并记录真实 SHA，否则记录待提交状态。保存下一项 READY 任务和阻塞，不执行远程 push。


---

<a id="integration-details"></a>
## 7. 跨任务实施细节：不要留给不同 Agent 各自猜测

### 7.1 命令与测试入口的确切语义

`pnpm test:unit`、`test:contract`、`test:integration` 按目录清单组织，不能依靠偶然文件名过滤。安全测试 `tests/security/` 必须加入 `test:integration` 或独立被阶段验证器强制调用；Windows/WSL/真实宿主矩阵由兼容验证器按实际环境执行。选择为空、未知 T ID、指定文件不存在均非零，不能设置 `passWithNoTests`。

根脚本收到包管理器透传的 `--` 时，脚本参数解析器最多剥离一个前导分隔符，然后严格解析选项。例如 `pnpm verify:stage -- --stage M2` 和内部直接运行 `node scripts/verify-stage.mjs --stage M2` 必须等价；不要把 `--` 当 stage 名。根脚本只做显式 argv 调用，不把收到的文本拼成 shell 命令。

M0 建立的根命令不能全部假实现为 `console.log('passed')`。尚未可用的后续阶段命令必须给出 `NOT_IMPLEMENTED` 并非零；对应任务完成后再用真实实现替换。这是开发状态，不是产品检查结果枚举。

`verify:stage` 的测试清单在该阶段启动时即可校验，检查结果由实际子进程获得。阶段总结任务本身在运行结束后才标 DONE，**不能要求其先 DONE 才允许执行自己的验收**。正常依赖仍需完成；脚本区分“开始阶段验证”和“声明阶段完成”，避免自锁。

本计划测试命令的预期：正例的开发测试通过；反例的**被测 StackGate CLI** 应返回指定非零，而包装它的 Vitest 测试在正确观察到拒绝后应通过。不得因为反例 CLI 非零就修改产品让它返回 0。

### 7.2 E17：将动态测试端口绑定到已授权服务，而不是放开全部 localhost

原稿规定 Compose 动态端口和 origin allowlist，但未定义二者连接字段。实施新增 **E17**，归属 SG-004、SG-016、SG-057—SG-060、SG-079。先在严格 schema 中声明以下扩展，再使用它；不能依靠 `additionalProperties:true` 放行任意字段。

以下是**合并入项目配置的字段片段**，不是独立可运行的完整配置：

```yaml
extensions:
  stackgate_v0_1:
    environment_bindings:
      test:
        frontend:
          service: web
          container_port: 5173
          protocol: http
          publish_host: "127.0.0.1"
        backend:
          service: api
          container_port: 8000
          protocol: http
          publish_host: "127.0.0.1"
security:
  extensions:
    stackgate_v0_1:
      allowed_environment_bindings:
        - "test.frontend"
        - "test.backend"
```

绑定以计划中的已确认服务/内部端口/protocol/宿主地址为输入；启动后从**本次自有容器的实际 inspect 记录**取得外部端口。将结果加入本次 Run 的有效目标集合与 EnvironmentManifest，而不是改写仓库 allowlist。有效目标仅限该实例与本次 Run 生命周期；外部服务、其他分支端口和重定向目标不自动获准。

对于 attach，仍使用明确 `frontend_origin/backend_origin`，不把这个机制当作自动发现任何本地服务的授权。Compose 固定 `container_name`、host network、共享 external volume、危险挂载、公开监听等按 P0 安全规则拒绝。允许的符号绑定无法解析、出现多个歧义实例或来源不符时保持环境 BLOCKED。

浏览器调用的地址、宿主探针地址和容器内部服务 DNS 分开保存。用户页面若通过同源 `/api` 代理后端，报告需保存代理路由约定及最终后端访问关联；不能仅因为 URL 没显示后端端口就判定没有真实请求。

### 7.3 E18：冻结可运行报告目录和校验边界

原稿规定产物按 Run 保存，但具体 command/check/attempt 子目录未展开。实施新增 **E18**，由 SG-006、SG-029、SG-033—SG-038、SG-053 协同实现：

```text
.stackgate/state/runs/<run_id>/
  inputs.json
  environment.json
  events.jsonl
  checks.json
  findings.json
  artifacts/
    checks/<check_id>/<attempt_id>/
      stdout.log
      stderr.log
      junit.xml
      probe.json
      candidate-openapi.json
      playwright.json
    observations/backend-requests.jsonl
  restricted/
    trace/
    screenshots/
  integrity.json
  manifest.json
```

上述各检查输出名称按适配器选择，并非每个 check 必须同时生成全部文件。`STACKGATE_OUTPUT_DIR` 指向当前检查尝试的自有新目录。后端观察使用独立 observation writer，不能与并行 check 覆写同一文件；仅可信收集器归并带身份的事件。

步骤状态分类固定如下：

| 真实情况 | Check 事实 | 总结处理 |
|---|---|---|
| 类型检查实际退出 0，正常无 testcase | PASS/exit-code | 可满足该类型检查 |
| JUnit 实际 testcase 有失败，进程退出 0 或非零 | FAIL，保留 raw exit | 必检 FAIL/1 |
| 报告缺失，且无更强的工具损坏证据 | BLOCKED/MISSING_REPORT | INCOMPLETE/2 |
| 报告语法损坏、跨 Run 伪装或已封存摘要不符 | ERROR/REPORT_INVALID | ERROR/3 |
| 没发现或实际执行 0 个必需测试 | BLOCKED/NO_TESTS | INCOMPLETE/2 |
| 工具无法启动、解析器异常或协议版本不支持 | ERROR/TOOL_FAILURE 或 TOOL_UNSUPPORTED | ERROR/3；不要求 Agent 乱改业务 |
| 可在执行前发现的必要工具缺失 | 前置 BLOCKED/DEPENDENCY_MISSING | INCOMPLETE/2；未启动步骤 |
| 上游环境未准备好 | 下游 BLOCKED/DEPENDENCY_BLOCKED | INCOMPLETE/2 |
| 必检 schema 特性不受支持 | BLOCKED/UNSUPPORTED_SCHEMA | INCOMPLETE/2 |
| 已支持的 schema 明确不符合目标 | FAIL/SCHEMA_MISMATCH | FAIL/1 |
| 过程取消 | 保留已发生事实，未做项 BLOCKED/CANCELED | 默认 INCOMPLETE/2；完整性错误可优先 3 |

已发生的业务失败和缺口都保留。明确进程失败、但预期测试报告完全缺失时，不能凭非零退出推断业务断言失败；若工具崩溃证据充分则 ERROR，否则按缺报告 INCOMPLETE。检查结果里的 `raw_exit_code` 与 StackGate 的门槛退出码是不同字段。

### 7.4 请求/响应 schema 支持矩阵：先写反例，再对外宣布支持

原稿 §6 的支持范围保持。SG-019/SG-022 将每个特性拆成可执行合同测试：对象、数组、properties、required、基本 scalar、enum、null、本地 JSON Pointer 引用，以及 FastAPI 常见的简单类型加 null 表达。深度、节点数和文件大小上限需明确配置，并在边界上测试；循环引用不能导致无限递归。

简单 nullable union 只能在明确识别并测试的等价表示中归一化。例如 `type:["string","null"]` 与仅包含 string/null 的 `anyOf` 可以作为计划中的受支持模式；一般 `anyOf/oneOf/allOf` 不顺便承诺支持。组合、条件、动态引用、未知 dialect 和尚未验证的约束进入诊断，不删除后继续校验。

若首版保留 `additionalProperties`、`readOnly/writeOnly` 或数值/字符串限制，必须在 `supported-keywords.json` 中逐个列明 **请求与响应方向、适用类型、版本、正反例**。这些是原稿概念的实施细化，不等于宣称全部 JSON Schema 2020-12 语义。未知关键词可分类为已明确无行为影响的注解或不支持的语义，禁止仅按名称猜测。

Ajv 配置禁用 `coerceTypes/useDefaults/removeAdditional`；输入校验不能修改被验收对象。对已支持 `format` 的词汇使用显式插件和测试；未启用词汇不声称已经校验相应格式。oasdiff 的兼容性覆盖与 StackGate 运行校验覆盖分别记录，不能用一个工具“支持 3.1”的宣传替另一个实现背书。

### 7.5 明确操作键、计划 hash 和任务确认内容

操作键为 `service:METHOD /path`。只把 HTTP 方法规范化成大写；不能随意删除尾斜杠、解码路径段或重命名路径参数。不同参数名是否视为同一路由由明示的契约比较规则处理。`operationId` 仅辅助，不作为永不变化的主键。

Plan hash 对已规范化的计划内容计算，排除 `plan_hash` 本身和创建时展示元数据；包含所有有效检查、任务revision、基线/input、目标、策略、工具链、配置与环境要求。Run 的实际来源和产物另行封存；新环境实例 ID 不倒灌修改原 Plan hash。

目标契约、task payload、保护输入与策略确认分开；执行授权也单独记录。重新确认操作的摘要包含即将认可的全部内容，不接受只传旧字符串 `approved=true`。产品中的 `task confirm` 仍是显式用户动作；测试可在受控 helper 中生成等价确认记录，但不得让 production init 默认这样做。

### 7.6 环境与浏览器事件的最小闭环

一次页面验收至少关联：确定的代码输入 → 实例启动/构建记录 → Playwright 稳定 test ID → 页面业务断言 → 请求 request ID → 同一实例的后端访问记录 → 与目标契约相符的响应事实。请求时间戳只辅助，不能在有多个实例时只用相近时间猜匹配。

`run_id` 在一个 Run 中共享，`check_id` 标识检查，`attempt_id` 区分重试，`request_id` 每次请求唯一，`instance_id` 标识服务启动实例。被测应用不能通过请求参数自由覆盖自身实例身份。记录这些 ID 仍不是抵抗同权限恶意进程的密码学认证；文档与报告必须保持这条边界。

Playwright 测试除 annotation 之外，应对关键业务断言建立稳定 step/attachment 协议，让 reporter 知道断言实际执行。`expect` 内部调用计数不是普遍可依赖的公共接口；不要猴子补丁 Playwright 内部。可在预设里通过显式 helper 包装关键断言并写标准附件，collector 同时校验框架状态和稳定断言记录。某个 helper 自称断言通过仍不能抵抗被测代码蓄意伪造，可信 CI 需保留受保护测试来源。

### 7.7 Windows 和进程取消的实施判据

原生 Windows 下 `.cmd/.bat` 不能假设可由 `execFile/spawn(shell:false)` 直接运行。仅支持已实际测试的 npm/pnpm wrapper→受信 Node JS 入口映射；找不到映射则具体诊断，不隐式切到通用 shell。对 `.exe` 和 Node脚本正常传 argv；测试中加入空格、中文、`&`、括号、分号，证明没有第二条命令被解释执行。

进程身份至少结合创建记录、当前可核对创建时间/祖先关系和随机所有权记录。仅凭 PID 或同名 `node.exe` 不足以清理。若某个 Windows 后代完全脱离可观察父树，报告明确留下待处理资源并阻止宣称完整清理；不能在产品中用全局 `taskkill /IM node.exe` 或同等范围命令解决。

WSL 与原生 Windows 的 state/cache identity 隔离；不能把 Linux 绝对路径直接交给 Windows runner。Git 文件路径使用字节安全的分隔机制，不用按换行拆文件列表。对无法无损表示的文件名明确不支持，而不是替换字符后继续算 hash。

### 7.8 确认、交接校验与机读字段的完整 CLI 合同

以下补齐 E13 的具体参数，归属 SG-017/018/027/043/044/080/081，不另外引入产品子系统。摘要只是明确本次同意的对象，不是授权证明或签名；执行Agent仍须得到用户对相应动作的授权。

| 操作 | 命令 | 成功输出的 data 必需字段 | 副作用 |
|---|---|---|---|
| 检查待确认任务 | `task validate --file PATH --json` | `task_id`、`revision`、`valid`、`confirmation_digest`、`confirmation_preview` | 只读；引用缺失时digest为null |
| 确认已审查任务 | `task confirm --file PATH --confirm-digest SHA256 --json` | `task_id`、`revision`、`confirmation_ref`、`confirmation_digest` | 保存新确认；摘要不符拒绝 |
| 查看执行权限 | `trust --review --json` | `execution_digest`、`execution_preview`、`already_trusted` | 机读模式只展示，不自动写信任 |
| 确认执行权限 | `trust --review --confirm-digest SHA256 --json` | `execution_digest`、`trust_ref`、`trusted` | 仅保存当前本地身份的授权提示记录 |
| 准备交接 | `handoff --run ID --target codex --json` | `handoff_id`、`handoff_json_path`、`handoff_markdown_path`、`freshness` | 写独立派生交接文件，不改Run事实 |
| 接手前校验 | `handoff --validate PATH --json` | `valid_for_current_inputs`、`freshness`、`task_revision_matches`、`reasons` | 只读当前身份，不运行测试、不扩大权限 |

TTY下不传摘要的 `task confirm` 或 `trust --review` 可先展示完整预览并等待明确确认；非TTY则返回具体的 `CONFIRMATION_REQUIRED` 前置诊断，不能自动认可。取得摘要后到真正写记录之前，再次读取/规范化所有相关输入并对比；内容变化必须重新展示，不可确认旧摘要对应的对象。

`handoff --validate` 接受SG-043生成的版本化 **JSON交接包**，不尝试从任意Markdown自然语言猜任务身份。`--run` 与 `--validate` 互斥。校验操作完成但 `valid_for_current_inputs=false` 时命令可返回0，表示成功完成诊断；Skill必须读取字段并重新计划/验收，而不能把它当门槛。损坏的输入包以结构/完整性诊断失败，不能输出伪valid。验收的最终退出仍来自run/gate。

这些派生输出置于明示的state/派生目录，schema和CLI帮助同步更新。CI候选仓库自行调用确认命令产生的本地记录不被可信CI策略认可；确认字段中写 `trusted-ci` 也不能改变这个边界。

---

<a id="code-contract-examples"></a>
## 8. 必须落地的测试代码示例

这些代码是开发合同，要求 Codex 在相应任务中写入并实际执行；不是本计划作者已经运行过的产品测试。示例引用的生产模块需先在 SG-003—SG-008 实现。SG-007 首轮可把输入工厂直接放测试内；SG-009 再提取到共同 helper，避免任务循环依赖。

### 8.1 完整 GateInput 工厂

文件：`tests/support/factories.ts`。该 helper 只属于测试，不进入发行版。原稿没有指定函数名，这里是 SG-009 的实施接口。

```typescript
import type { CheckFact, GateInput } from '../../packages/contracts/src/index.js';

export function createCheckFact(
  overrides: Partial<CheckFact> = {},
): CheckFact {
  return {
    check_id: 'unit',
    required: true,
    status: 'PASS',
    result_kind: 'junit',
    exit_code: 0,
    expected_test_ids: ['unit-001'],
    executed_test_ids: ['unit-001'],
    discovered_tests: 1,
    executed_tests: 1,
    skipped_tests: 0,
    flaky_tests: 0,
    reasons: [],
    evidence_refs: ['ev-unit-001'],
    ...structuredClone(overrides),
  };
}

export function createGateInput(
  overrides: Partial<GateInput> = {},
): GateInput {
  return {
    checks: [createCheckFact()],
    required_check_ids: ['unit'],
    configuration_valid: true,
    report_integrity: 'VALID',
    freshness: 'FRESH',
    inputs_complete: true,
    task_confirmed: true,
    policy_confirmed: true,
    environment_satisfied: true,
    acceptance_inputs_approved: true,
    canceled: false,
    fatal_error: false,
    deterministic_denials: [],
    ...structuredClone(overrides),
  };
}
```

测试工厂可以构造合法的 PASS 事实用于**纯函数**测试，这不证明真实 runner 成功。M2/M3 集成不得用该工厂替代真实工具产物。

### 8.2 十一项门槛测试：包含正常通过与类型检查正例

文件：`tests/unit/gate/acceptance-boundaries.test.ts`。函数出口还需覆盖任务卡要求的更多组合；本段是不可删除的最小集。

```typescript
import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../../../packages/core/src/domain/evaluate-gate.js';
import { createCheckFact, createGateInput } from '../../support/factories.js';

const evaluate = (input: ReturnType<typeof createGateInput>) => {
  const before = structuredClone(input);
  const result = evaluateGate(input);
  expect(input).toEqual(before); // 判定不能修改原始事实
  return result;
};

describe('StackGate mandatory acceptance boundaries', () => {
  it('允许完整、当前且受确认的必检证据', () => {
    expect(evaluate(createGateInput())).toMatchObject({
      verdict: 'PASS', freshness: 'FRESH', decision: 'ALLOW', exit_code: 0,
    });
  });

  it('JUnit进程为0但执行用例为0不能通过', () => {
    const check = createCheckFact({
      executed_test_ids: [], discovered_tests: 0, executed_tests: 0,
    });
    expect(evaluate(createGateInput({ checks: [check] }))).toMatchObject({
      verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2,
    });
  });

  it('真正的类型检查不因没有testcase被误拒', () => {
    const check = createCheckFact({
      check_id: 'typecheck', result_kind: 'exit-code',
      expected_test_ids: [], executed_test_ids: [],
      discovered_tests: 0, executed_tests: 0,
    });
    expect(evaluate(createGateInput({
      checks: [check], required_check_ids: ['typecheck'],
    }))).toMatchObject({ decision: 'ALLOW', exit_code: 0 });
  });

  it('缺失必检ID，即使其他测试通过也不允许', () => {
    expect(evaluate(createGateInput({
      required_check_ids: ['unit', 'e2e'],
    }))).toMatchObject({ verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2 });
  });

  it('空必检集合不能使用every空数组的真值获得通过', () => {
    expect(evaluate(createGateInput({
      checks: [], required_check_ids: [],
    }))).toMatchObject({ verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2 });
  });

  it('已变更的输入使历史PASS不能继续允许', () => {
    expect(evaluate(createGateInput({ freshness: 'STALE' }))).toMatchObject({
      verdict: 'PASS', freshness: 'STALE', decision: 'DENY', exit_code: 4,
    });
  });

  it('损坏报告优先于过期和业务失败', () => {
    expect(evaluate(createGateInput({
      checks: [createCheckFact({ status: 'FAIL', exit_code: 1 })],
      report_integrity: 'INVALID', freshness: 'STALE',
    }))).toMatchObject({ verdict: 'ERROR', decision: 'DENY', exit_code: 3 });
  });

  it('配置无效的出口优先于内部错误', () => {
    expect(evaluate(createGateInput({
      configuration_valid: false, fatal_error: true,
    }))).toMatchObject({ decision: 'DENY', exit_code: 64 });
  });

  it('重试后通过仍保留flaky并默认不完整', () => {
    expect(evaluate(createGateInput({
      checks: [createCheckFact({ flaky_tests: 1 })],
    }))).toMatchObject({ verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2 });
  });

  it('取消不消除已经发生的失败事实', () => {
    const input = createGateInput({
      canceled: true,
      checks: [createCheckFact({ status: 'FAIL', exit_code: 1 })],
    });
    expect(evaluate(input)).toMatchObject({
      verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2,
    });
    expect(input.checks[0]?.status).toBe('FAIL');
  });

  it('明确的可信策略拒绝不能被成功测试覆盖', () => {
    expect(evaluate(createGateInput({
      deterministic_denials: ['PROTECTED_INPUT_CHANGED'],
    }))).toMatchObject({ decision: 'DENY', exit_code: 1 });
  });
});
```

运行：

```text
pnpm exec vitest run tests/unit/gate/acceptance-boundaries.test.ts
pnpm typecheck
```

补充：输入的 `required` 和 `required_check_ids` 冲突属于完整性/配置诊断，不能让项目报告把必检伪装为 optional。`fatal_error`、`report_integrity` 和 `deterministic_denials` 只能由核心和可信策略推导，不直接接受业务脚本自填的权威判断。

### 8.3 JSON Schema 不得“帮忙修复”被测响应

文件：`tests/unit/contracts/no-coercion.test.ts`。这一基础库测试是 SG-022 的辅助，不替代对 OpenAPI 方向与子集的适配测试。

```typescript
import Ajv2020 from 'ajv/dist/2020.js';
import { expect, it } from 'vitest';

it('数字字符串不被强制转换为契约声明的number', () => {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  const validate = ajv.compile({
    type: 'object',
    required: ['total_return'],
    properties: { total_return: { type: 'number' } },
    additionalProperties: false,
  });
  const response = { total_return: '0.1234' };
  const before = structuredClone(response);
  expect(validate(response)).toBe(false);
  expect(response).toEqual(before);
  expect(validate.errors?.some(error => error.keyword === 'type')).toBe(true);
});
```

具体 import 方式按 M0 锁定的 Ajv/TypeScript ESM 配置实测，若需兼容调整记录映射；不可为解决 import 错误删掉核心断言。

### 8.4 真正读取已构建 CLI，而不是 mock main()

文件：`tests/integration/cli/process-contract.test.ts`。CLI 正常支持后执行。

```typescript
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, it } from 'vitest';

it('已构建CLI对未知命令保留64且不需要shell', () => {
  const result = spawnSync(process.execPath, [
    path.resolve('dist/cli.mjs'), 'not-a-stackgate-command', '--json',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    timeout: 15_000,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(64);
  const envelope = JSON.parse(result.stdout) as {
    ok: boolean; command: string; diagnostics: unknown[];
  };
  expect(envelope.ok).toBe(false);
  expect(envelope.diagnostics.length).toBeGreaterThan(0);
});
```

单测中的 spawn 只用于被测 CLI；产品子命令仍必须经过授权、命令解析、环境过滤、取消和证据管理。不把这个小测试的简化 runner 当生产执行器直接复用。

---

<a id="traceability"></a>
## 9. 需求、任务与验收追溯矩阵

### 9.1 F 功能映射

| 原稿功能 | 主要实现任务 | 验收/交付任务 | P0 边界 |
|---|---|---|---|
| F01 项目体检与安全初始化 | SG-011、015、027、079 | SG-028、089 | 不执行仓库代码；apply前预览 |
| F02 验收任务 | SG-005、017、026 | SG-066、094 | 不可变revision，DRAFT不自动可信 |
| F03 基线与快照 | SG-012—014 | SG-071、085 | staged/unstaged/untracked与固定基线 |
| F04 权限确认 | SG-016、018、032、084 | SG-072、092 | 本地防误操作≠可信CI |
| F05 三方契约 | SG-019—022、051 | SG-064—068 | 基线/目标/候选分离 |
| F06 规则范围 | SG-019—022 | SG-068、076 | 超出已测子集不放行 |
| F07 消费者影响 | SG-023—025 | SG-068、074 | 未知保守回退，不能据不完整AST减必检 |
| F08 验收漂移 | SG-026、034、084 | SG-066、085 | 不声称理解任意断言语义 |
| F09 计划与执行 | SG-032—039 | SG-048—050、062 | 固定DAG、真实进程、零测试拒绝 |
| F10 环境来源 | SG-055—059、084 | SG-067、071、076 | DECLARED/OBSERVED/CONTROLLED有依据 |
| F11 真接口/浏览器 | SG-051—055、060、063 | SG-064、065、068、073 | 真实请求+断言+来源，不只是截图 |
| F12 取消/清理 | SG-033、035、045、049、061 | SG-070、072 | 仅自有资源，P0不盲目恢复run |
| F13 证据报告 | SG-029—031、041、042、047 | SG-069、083、090 | JSON/终端/MD/JUnit，无HTML控制台 |
| F14 最小交接 | SG-043、044、080、081 | SG-073、091 | 不传完整聊天，不扩授权 |
| F15 最小协调 | SG-005、023—026、034、035 | SG-071、085 | 统一契约和整合重测，不调度Agent |
| F16 人工例外/受控修复 | P0仅SG-005、017、021的精确兼容批准 | SG-094；P1由SG-100规划 | 无force-pass、无自动修复循环 |

### 9.2 T01—T28 一一对应

预期出口是被测场景的产品结果；相应回归测试在观察到正确结果后为测试通过。组合错误按原稿退出优先级，不能只取表中某个数字覆盖更严重错误。

| 原稿验收 | 实施任务 | 主要实际测试路径/登记点 | 必须观察到的行为 |
|---|---|---|---|
| T01 字段改名消费者旧 | SG-052、060、064、065 | `tests/acceptance/T01.consumer-drift.test.ts` | 真实页面失败，FAIL/1；合法修复新run后才可0 |
| T02 独立Mock单测全绿 | SG-052、064 | `tests/acceptance/T02.mock-green.test.ts` | 单测真绿不能代替真实e2e |
| T03 删除必检/0测试 | SG-037、063、066 | `tests/acceptance/T03.missing-tests.test.ts` | 缺测试2或明确保护输入违规1，不允许0 |
| T04 修改目标掩盖错误 | SG-017、026、066 | `tests/acceptance/T04.target-tamper.test.ts` | 旧plan/run失效4；新目标待确认 |
| T05 number实际string | SG-022、054、068 | `tests/acceptance/T05.response-type.test.ts` | 不强制转换，真实schema失败1 |
| T06 必有字段缺失/null | SG-022、068 | `tests/acceptance/T06.required-null.test.ts` | 依目标与方向判失败1；允许null的正例单列 |
| T07 不支持schema | SG-019、020、022、068 | `tests/acceptance/T07.unsupported-schema.test.ts` | 指出位置/关键词，INCOMPLETE/2 |
| T08 未知消费者有回归集 | SG-025、068 | `tests/acceptance/T08.regression-fallback.test.ts` | 回归确实执行，未知关联仍披露；成功覆盖后可满足策略 |
| T09 未知且无回归集 | SG-025、068 | `tests/acceptance/T09.unresolved-no-fallback.test.ts` | INCOMPLETE/2，不当无影响 |
| T10 健康但来源不明 | SG-056、059、067 | `tests/acceptance/T10.unverified-origin.test.ts` | 健康不等于当前代码，DENY/2 |
| T11 命中旧分支服务 | SG-055—060、067 | `tests/acceptance/T11.wrong-instance.test.ts` | 不允许；若环境身份已变化可4，证据不足则2 |
| T12 新增未跟踪输入 | SG-013、014、071 | `tests/acceptance/T12.untracked-freshness.test.ts` | 原结果STALE/4 |
| T13 验收时工作区变动 | SG-014、039、071 | `tests/acceptance/T13.concurrent-change.test.ts` | pre/post不符使STALE/4，披露P0盲区 |
| T14 目标分支前进 | SG-012、014、071、085 | `tests/acceptance/T14.base-advanced.test.ts` | 固定策略要求重算4，不能默用旧基线 |
| T15 退出0却缺报告 | SG-037、038、048、073 | `tests/acceptance/T15.missing-report.test.ts` | 缺报告2；损坏/伪造则3 |
| T16 首失败后通过 | SG-053、063、073 | `tests/acceptance/T16.flaky.test.ts` | 保留attempt，默认INCOMPLETE/2 |
| T17 无服务/端口冲突 | SG-057—059、067 | `tests/acceptance/T17.environment-blocked.test.ts` | 环境BLOCKED，下游未执行，2 |
| T18 取消时有进程容器 | SG-033、061、072 | `tests/acceptance/T18.cancel-owned.test.ts` | 保存已有证据、清理自有，默认2；清理安全错误3 |
| T19 attach不得关闭服务 | SG-045、056、072 | `tests/acceptance/T19.attach-preserved.test.ts` | clean后原服务仍可请求 |
| T20 外部/越界引用 | SG-019、020、072 | `tests/acceptance/T20.external-refs.test.ts` | 加载拒绝，无内网请求；安全策略DENY |
| T21 日志含凭证 | SG-030、055、069 | `tests/acceptance/T21.secret-redaction.test.ts` | 常规证据/交接无canary原值；restricted不默认导出 |
| T22 Windows路径编码 | SG-011、032、033、070 | `tests/acceptance/T22.windows-paths.test.ts` | 真实原生Windows执行，不用Linux模拟替认证 |
| T23 交接后任务变化 | SG-043、073、091 | `tests/acceptance/T23.handoff-stale.test.ts` | 历史包可读但当前身份不符，不能沿用通过 |
| T24 report成功不代表gate成功 | SG-042、044、073、083 | `tests/acceptance/T24.report-vs-gate.test.ts` | report0且FAIL时run/gate非零，CI不绿 |
| T25 两分支合并失配 | SG-071、085 | `tests/acceptance/T25.merge-composition.test.ts` | 整合候选重新执行并FAIL，不拼两张报告 |
| T26 基线已有失败 | SG-048、073 | `tests/acceptance/T26.existing-failure.test.ts` | 可注释来源，不自动豁免必检失败 |
| T27 放宽CI策略 | SG-016、073、084、085 | `tests/acceptance/T27.policy-weaken.test.ts` | 必检并集/权限交集生效，策略拒绝1 |
| T28 Hook重复结束事件 | **P1；仅SG-100规划** | P0不建通过记录；后续新增实际test | 有界提醒，不无限续行，不算T01—27完成数 |

SG-073 创建这些验收入口；入口可调用已经在模块集成测试中实现的真实夹具，但必须实际运行、产生唯一测试标识和结果。不得只 `import` 一张 JSON 表便判定27项完成。

M3 中 T27 可先验证可信策略的核心合并与拒绝逻辑，M4 再执行真实 CI 来源装载和外部边界测试。M3 的域逻辑覆盖不能替代 M4 的 runner/合并保护实测；M4升级后的新验证结果写新证据，不改旧阶段记录。

### 9.3 原稿其他章节的覆盖

| 原稿章节 | 必要落点 |
|---|---|
| §1—4 定位、用户、范围、旅程 | SG-001、027、079、087、095、097 |
| §9 架构与技术选型 | SG-002—010、032、078、094 |
| §10 状态/退出码/新鲜度 | SG-003、006、007、014、039、040、090 |
| §11 数据与持久化 | SG-004—006、011、017、029—031、047、086 |
| §12 配置与接口 | SG-004—006、016—018、034、079 |
| §13 CLI与适配器 | SG-008、027、034、044、080—082、090 |
| §14 宿主接入 | SG-080—082、091；Hooks后置SG-100 |
| §15 Windows/Docker/CI | SG-032—033、055—061、070—071、083—085 |
| §16 安全和隐私 | SG-018—020、026、030—033、057、061、069、072、084、088 |
| §17 性能和可观测 | SG-030、046、053、063、075、090、098 |
| §18 开发路线 | 全部M0—M5阶段出口与任务账本 |
| §19 测试及产品验证 | SG-009、048—050、064—077、092、096—099 |
| §20 发布维护 | SG-078—095 |
| §21 决策和待验证 | SG-010、076、084、088、091、094、100 |
| §22 外部依据 | M0真实版本记录、官方参考W01—W13、发布兼容性复核 |

---

<a id="phase-runbooks"></a>
## 10. 阶段运行手册与并行分工

### 10.1 顺序执行的核心路径

SG-001—010 冻结数据与判定 → SG-011—028 实现输入与只读分析 → SG-029—050 执行/证据/CLI → SG-051—077 真实全栈闭环 → SG-078—095 可分发与平台验证 → SG-096—100 用户效果验证。

默认按任务编号选择第一项依赖满足的任务。遇到 BLOCKED，先记录原因，再找不依赖该阻塞的 READY 任务；不因为缺少 Docker 就停止编写规则单测，也不因为规则单测完成就宣称真实集成完成。必须依赖缺失信息的任务保持未完成。

### 10.2 可以并行的任务与共享文件锁

| 条件已满足 | 并行示例 | 不能同时修改 |
|---|---|---|
| M0接口冻结，SG-018完成 | SG-019契约安全、SG-023显式映射 | schema/公共types由主Agent统一合并 |
| SG-039可产真实Run | SG-041/042报告组、SG-043交接组 | RunManifest和Gate语义 |
| SG-062闭环已连接 | SG-067环境反例、SG-069隐私反例 | 环境台账结构；生产runner生命周期 |
| tarball和共享说明已固定 | SG-080 Codex入口、SG-081 Claude入口的独立内容准备 | 公共结果合同；实际依赖仍按任务索引满足后完成 |
| M4核心实现稳定 | SG-087文档、SG-088许可材料的收集部分 | 最终许可选择和公开发布授权 |

SG-081 依赖 SG-080 的共享说明，不能在其未冻结时宣布并行完成整个任务；可以提前准备互不重叠的 Claude 目录测试。每次并行最多两个工作者；接口变更先由主 Agent 合并和验证，再通知消费者。执行器、环境和证据封存优先单负责人。

### 10.3 开发阶段验证命令

项目根目录执行，命令只在相应任务完成后可用：

```text
pnpm verify:source
pnpm verify:tasks
pnpm verify:schemas
pnpm verify:boundaries
pnpm build
pnpm typecheck
pnpm test:unit
pnpm verify:stage -- --stage M0
```

M1/M2/M3/M4 对应替换最后一条 stage 参数，阶段运行器会调用自己登记的实际检查，不能让用户手工猜必检清单。失败后先定位具体命令，不反复全量重跑无关测试。修改共享schema/gate/runner时必须扩大到对应合同与集成回归。

在所有平台能力到位后才执行完整 `pnpm verify:release`；缺环境应保留有条件的通过列表和未测项，不篡改配置把它们排除。M5研究脚本不会由 `verify:release` 自动付费执行。

### 10.4 产品闭环：从真实返回中取 plan_id/run_id

前置条件：CLI已构建、当前目录是已授权的目标工程、任务已人工确认、执行信任已记录、baseline对象存在、环境可观测。下面是 Linux/WSL shell 的**显式任务流程**。Windows 使用后面的 PowerShell方式或同等 Node包装，不把 bash 语法直接贴进PowerShell。

```bash
# 在目标工程根目录运行；使用真实本地CLI安装后的命令。
# 首次安装的公开包名未知，不能直接抄一个未发布的 npx 地址。
# 本段使用默认state路径；配置了外部state_dir时，脚本须从有效配置解析同一目录。
mkdir -p .stackgate/state/client-output
stackgate plan --task performance --base origin/main --profile integration --json > .stackgate/state/client-output/plan-result.json
plan_status=$?
if [ "$plan_status" -ne 0 ]; then exit "$plan_status"; fi

plan_id=$(node -e '
const fs=require("node:fs");
const x=JSON.parse(fs.readFileSync(".stackgate/state/client-output/plan-result.json","utf8"));
const id=x.data?.plan_id;
if(!x.ok||typeof id!=="string"||!/^plan_[A-Za-z0-9_-]+$/.test(id)) process.exit(64);
process.stdout.write(id);')
parse_status=$?
if [ "$parse_status" -ne 0 ]; then exit "$parse_status"; fi

stackgate run --plan "$plan_id" --json > .stackgate/state/client-output/run-result.json
run_status=$?

run_id=$(node -e '
const fs=require("node:fs");
const x=JSON.parse(fs.readFileSync(".stackgate/state/client-output/run-result.json","utf8"));
const id=x.data?.run_id;
if(typeof id!=="string"||!/^run_[A-Za-z0-9_-]+$/.test(id)) process.exit(64);
process.stdout.write(id);')
parse_status=$?
if [ "$parse_status" -ne 0 ]; then
  # 启动失败时可能没有run，不能改读旧目录或继续伪造报告。
  if [ "$run_status" -ne 0 ]; then exit "$run_status"; fi
  exit "$parse_status"
fi

stackgate report --run "$run_id" --format markdown --output .stackgate/state/client-output/acceptance.md
report_status=$?
stackgate gate --run "$run_id" --strict --json > .stackgate/state/client-output/gate-result.json
gate_status=$?

# 此示例保留最初运行失败，报告失败也不吞掉；实际CI按全局优先级聚合。
if [ "$gate_status" -ne 0 ]; then exit "$gate_status"; fi
if [ "$run_status" -ne 0 ]; then exit "$run_status"; fi
if [ "$report_status" -ne 0 ]; then exit "$report_status"; fi
exit 0
```

这个示例的 ID 格式约定属于 CLI 实施接口：SG-003 固定 `plan_`、`run_` 前缀与安全字符，SG-044 的 `plan` envelope 返回 `data.plan_id`，`run` 返回 `data.run_id` 与 `data.gate`。读取命令已经在 §4.8 有统一 envelope，但具体 data 字段由这里补齐。格式若在实施中调整必须同步CLI/schema/脚本/文档，不让不同执行Agent分别决定。

以上脚本可用于人工演示，但**不直接替代** SG-083 的可信 CI 包装器；CI 必须使用下述完整退出优先级、真实可信策略以及受控候选。脚本创建的本地输出文件应写到已排除的临时报告目录，避免作为业务输入纳入下一次hash。本例将输出写入默认的 `.stackgate/state/client-output/`；采用外部state_dir时按已解析配置定位。无论使用哪种目录，都先验证其在明确排除的状态区内。

### 10.5 Windows 退出码保留要点

PowerShell 执行原生命令后立即读取 `$LASTEXITCODE`；不要用随后成功的 `Write-Output`、文件读取或报告命令覆盖验收状态。下面仅展示已知 run_id 时最后两个动作，不绕过计划/确认步骤：

```powershell
param([Parameter(Mandatory = $true)][string]$RunId)

& stackgate gate --run $RunId --strict --json
$gateCode = $LASTEXITCODE
New-Item -ItemType Directory -Force -Path .stackgate/state/client-output | Out-Null
& stackgate report --run $RunId --format markdown --output .stackgate/state/client-output/acceptance.md
$reportCode = $LASTEXITCODE

if ($gateCode -ne 0) { exit $gateCode }
if ($reportCode -ne 0) { exit $reportCode }
exit 0
```

该样例是用户shell指令，不是产品内部命令启动器。产品执行器仍使用已确认程序和argv；不要把 PowerShell 自动当任意仓库脚本的隐式fallback。完整 CI 包装优先用跨平台 Node 子进程包装并纳入测试。

### 10.6 完整退出优先级的具体实现合同

SG-007/SG-083 使用相同优先级定义。以下纯函数可放入 `packages/core/src/domain/exit-code.ts`；若文件已有等价实现则复用。外部工具原始退出码必须先按结果协议映射到 StackGate ExitCode，不能把 Python的7直接传入：

```typescript
import type { ExitCode } from '../../../contracts/src/index.js';

const priority: readonly ExitCode[] = [64, 3, 4, 1, 2, 0];

export function strongestExitCode(codes: readonly ExitCode[]): ExitCode {
  if (codes.length === 0) return 2; // 没有结果不能假装通过
  // 运行时仍可能传入不符合TypeScript类型的值：先归一为工具错误。
  const normalized = codes.map(code => priority.includes(code) ? code : 3);
  for (const code of priority) {
    if (normalized.includes(code)) return code;
  }
  return 3;
}
```

注意跨包 import 的相对路径以实际文件布局检查；从 `packages/core/src/domain/exit-code.ts` 到 `packages/contracts/src/index.ts` 为 `../../../contracts/src/index.js`。公共库可统一 package alias，但构建后的发布包必须能解析。

SG-083 的finally流程：停止新工作 → 保存已得证据 → 自有资源清理 → 已有run的报告导出 → 新Gate评估（必要时） → 使用 `strongestExitCode` 聚合已形成的有效结果。报告渲染失败不能更改原业务事实，安全清理失败也不能被“报告成功”遮盖。

### 10.7 续接记录的最小格式

每项任务结束的PROGRESS摘要不必复制整张任务卡，使用真实内容填写：

```text
当前阶段：M2
正在处理：SG-039
状态：IMPLEMENTED_UNVERIFIED
已改文件：列真实相对路径
已运行验证：列真实命令、退出码、证据路径
未完成验证：列未运行项目及原因
协议变化：无；或指向DECISIONS/ADR
保留用户改动：列需要避免覆盖的文件
下一步：当前任务的下一条可执行动作
```

这段仅是格式示例，不表示SG-039真实已编码。Codex必须先核对实际仓库再写状态；不要把计划示例原样当进度。

---

<a id="quality-security"></a>
## 11. 不可降级的质量与安全验收

### 11.1 发布阻断问题

| 类型 | 例子 | 处置 |
|---|---|---|
| 错误放行 | 测试被删、Mock代替真实后端、旧服务、证据过期仍ALLOW | P0阻断；补反例，修复后全链路重验 |
| 执行边界破坏 | 未确认就启动代码、读取Agent密钥、危险shell降级 | P0阻断；先修权限与调用路径 |
| 资源/数据风险 | 误杀用户进程、清共享卷、误连接生产、泄露凭证 | 停相关能力；保留证据，禁止继续自动修复 |
| 协议不可用 | 打包缺schema、JSON夹杂日志、结果损坏被忽略 | P0阻断；真实包与CLI回归 |
| 支持声明无证据 | 未测Windows却称全平台，未测宿主却称可用 | 收缩声明并保留未测任务；不能改成PASS |
| 可用性缺口 | 预设引用不存在脚本、init覆盖用户配置 | 修复首次接入/更新路径后重验 |
| 非核心呈现改进 | 颜色、可选摘要排版、未来HTML | 不越过安全/正确性优先级，不趁机扩平台 |

不要把这里的“阻断问题”与原稿 P0/P1 **功能优先级**混用。P0核心功能只要存在已知会错误放行的缺陷就不能视为完成；P1功能未实现本身不阻断P0。

### 11.2 不可使用的实现捷径

不依赖模型一句“成功”；不通过删除、skip、降低最低测试数修绿；不把任何未知设成false影响从而减少测试；不把 exit-code适配器用于绕过已指定JUnit/Playwright必检；不按目录mtime宣称fresh；不只hash Git SHA；不允许旧产物复用为当前尝试；不把 `.env` 原文保存为证据；不在日志中执行提示注入文本；不使用全局 Docker prune；不在Stop Hook里跑长链路；不自动升级现有项目框架以让适配容易；不靠fixture ID硬编码生产结果。

有误报时应减少不确定的确定性断言，标注候选影响或来源不明；不能为减少误报而放松必需证据。业务需要变更目标则创建受审查revision，重新计划和运行，而不是改掉旧记录。

### 11.3 完成定义分层

**任务DONE：** 实际文件存在且无关键stub，接口一致，指定正反例真实执行，相关回归通过，证据和进度更新。需要外部授权/平台的验证缺失时，保持 IMPLEMENTED_UNVERIFIED/BLOCKED。

**阶段完成：** 阶段所有必需能力和检查在声明环境通过；主Agent整合审查；不存在未披露的环境/权限缺口。阶段总结文件不替代真实日志。

**P0产品完成：** M0—M4满足原稿P0；T01—T27都有可追溯真实结果；核心真全栈闭环、两宿主和声明平台经过相应验证；本地安装/升级/卸载/CI边界可说明。

**公开发布准备完成：** 在P0基础上，名称、许可、供应链、账户权限、发布说明和未决风险经过用户确认。执行publish/push仍需明确授权，不是DONE状态的隐含动作。

**效果验证完成：** 有真实A/B/C任务或真实设计伙伴记录，数据有效并披露局限。代码完成不能替代M5。

### 11.4 诊断码目录的起始集合

SG-003先冻结原因码，SG-087补充用户说明；rule_id的文案可以变化，但机器语义变更应写CHANGELOG。下列为本计划新增实施字典，非声称原稿已定义这些完整名称。

| code | 含义 | 首要下一步 |
|---|---|---|
| `CONFIG_INVALID` | 重复键、未知字段或引用非法 | 修具体配置，不执行项目代码 |
| `TASK_UNCONFIRMED` | 无匹配确认revision | 展示目标/约束后请求合法确认 |
| `EXECUTION_UNTRUSTED` | 命令/环境摘要未授权 | 展示待执行权限清单 |
| `BASELINE_UNAVAILABLE` | 固定基线对象缺失 | 在授权条件下准备Git对象 |
| `PLAN_STALE` / `INPUT_STALE` | 当前身份不符 | 重新计划或新run |
| `UNSUPPORTED_SCHEMA` | 超出已测方言/特性 | 明确范围，补适配合同或换受支持输入 |
| `CONTRACT_MISMATCH` | 目标与实现已支持语义冲突 | 修候选实现或按真实需求新确认 |
| `UNRESOLVED_IMPACT` | 消费者关联不明 | 跑已配回归集或补显式映射 |
| `PROTECTED_INPUT_CHANGED` | 目标/必检标准被修改 | 人工审查，新revision |
| `NO_TESTS` / `REQUIRED_TEST_MISSING` | 无实际必检记录 | 修选择器/测试配置，不降低标准 |
| `MISSING_REPORT` / `REPORT_INVALID` | 缺失与损坏分别处理 | 诊断对应适配器和本次输出路径 |
| `ENV_PROVENANCE_INSUFFICIENT` | 来源等级不足 | 使用可观察launcher或受控环境 |
| `ENV_INSTANCE_MISMATCH` | 请求与候选实例不匹配 | 停止验收，连接正确实例 |
| `FLAKY_REQUIRED_TEST` | 必检重试才通过 | 复现并修不稳定性，不无限重试 |
| `ARTIFACT_BUDGET_EXCEEDED` | 证据预算超限 | 检查关键证据是否缺失再调预算 |
| `RESOURCE_OWNERSHIP_UNVERIFIED` | 清理归属不明 | 保留资源，人工核对 |
| `POLICY_WEAKEN_ATTEMPT` | 试图放宽可信策略 | 拒绝，联系可信维护流程 |

诊断code不是退出码直接映射：相同code在扫描和严格门槛中的命令出口不同；聚合仍由核心策略计算。举例 `scan`成功输出某契约问题仍可命令0，但不产生验收ALLOW。

---

<a id="fixtures-research"></a>
## 12. 可复现故障与产品效果验证细化

### 12.1 FX-01—FX-12 最小故障库

| 场景ID | 输入/注入 | 真实执行层 | 目标结果 |
|---|---|---|---|
| FX-01 | 页面读取旧字段 totalReturn | FastAPI+React+Playwright | unit可绿，页面断言FAIL |
| FX-02 | data内响应嵌套层变化 | 契约+实际probe+页面 | 定位目标/候选或消费者不符 |
| FX-03 | number返回string | 实际probe+core校验 | 不自动转换，FAIL |
| FX-04 | required缺失或不允许的null | 契约+probe | 支持范围中明确FAIL |
| FX-05 | 增加必填请求参数 | 真实oasdiff+请求验证 | 兼容性发现，未经批准拒绝 |
| FX-06 | 响应枚举增加未处理值 | 契约+业务用例 | 按响应方向/消费者用例报告 |
| FX-07 | 删除必检用例，进程仍0 | 真实JUnit/Playwright | 缺test_id或计数，不允许 |
| FX-08 | 前端route Mock掩盖API错误 | 真实浏览器+后端观察 | 不满足真实链路 |
| FX-09 | 端口指向另分支旧服务 | 两个真实服务实例 | 来源不匹配，不允许 |
| FX-10 | 运行期动态客户端无法解析 | TS分析+实际回归集 | 回退执行；无回归则不完整 |
| FX-11 | 规范含外部/越界引用 | 真实loader/oasdiff+网络哨兵 | 拒绝且无外部请求 |
| FX-12 | 前/后端分别绿，合并失配 | 真实Git候选+联调 | 合并后重新检测并FAIL |

各fixture有独立的目标/确认、故障与修复补丁、期望错误类别和层级；不要把同一个失配换12个名字。字段/请求参数例子按测试契约精确设计，不从任意真实API收集敏感响应。生产核心不得读取 FX编号来决定结果。

### 12.2 研究数据最小字段

每个真实trial记录 `trial_id/group/task_fixture_or_authorized_project/input_digest/oracle_revision/model_version/tool_versions/started_at/finished_at/outcome/verification_evidence/human_time_observation/missing_data/consent_ref`。模型或用户数据没有授权就不采集；软件验收fixture可以不含模型版本，但必须明确是工具正确性验证而不是Agent效率实验。

对照实验共享独立验收oracle，禁止C组使用更宽松目标。组B必须合理配置既有工具并记录版本和配置，不能故意不用其关键能力。留出任务在规则开发后才运行，避免把针对fixture的拟合说成泛化效果。

主要结果以“完成相同验收意图的人工纠错时间、漏检/误报、总工作量”衡量。Token只在来源清楚时作为辅助，缓存与非缓存输入分别记录；未观察到的数据为null，不是0。净收益还需减去初始化与维护成本；作者手工协助的时间也计入。

---

<a id="codex-prompts"></a>
## 13. 可直接交给 Codex 的启动与续接提示词

### 13.1 第一次启动

```text
请开始实现 StackGate 产品，不要重新输出一份功能介绍或再次泛化规划。

依据两个文件：
1. docs/specs/stackgate-v0.1.md：原始功能与架构设计。
2. docs/plans/2026-09-18-stackgate-v0.1-execution.md：详细执行计划。
若尚未放入这两个位置，请从我提供的同名附件原样保存，不覆盖已有文件。

先确认当前仓库、当前分支、git status、仓库规则和已有实现。按需读取计划第0—5节，
再读取本轮任务卡和原稿对应章节，不要每次扫描整仓或全文加载全部资料。
本轮先执行 SG-001—SG-010，交付真实可构建工程、schema、Gate纯函数、合同测试、
工具基线和任务账本；不是只创建目录和文档。已有实现则增量复用。

遵守任务依赖。每项先建立反例/测试，观察相关失败，再写最小实现，运行指定检查及回归。
记录真实命令、退出码、文件和证据；没有运行的检查标未验证，不能称已通过。
禁止固定返回PASS、伪造测试报告、删除/跳过必检、放宽目标契约或把测试fake接入发行版。

已授权的本地编码和测试继续推进，不反复询问计划已经说明的常规选择。
缺少环境或权限时，记录BLOCKERS，继续无依赖的工作；不得越过需要授权的边界。
不执行npm公开发布、远程push/PR、部署、生产数据库操作或未经许可的付费模型调用。
不要覆盖用户已有改动，不要修改全局Agent规则，不要搭建管理后台、MCP或Hooks。

每项结束更新 docs/implementation/PROGRESS.md 和 tasks.json。
会话结束时列出：完成任务、真实验证、未验证项、阻塞和下一项。
若M0已真正完成，给出 pnpm verify:stage -- --stage M0 的实际结果，并说明M1从哪里继续。
```

这是建议的首轮执行范围，而不是要求同一会话必须完成95项产品任务。用户明确授权更大阶段后，Codex按相同约束连续推进；不能拿需要后续上下文为理由提前把未实现功能标DONE。

### 13.2 配额/上下文中断后继续

```text
继续当前 StackGate 实现，不重新搭脚手架、不重写已完成模块。
先读取 docs/implementation/PROGRESS.md、tasks.json、BLOCKERS.md，
检查当前 git status 和相关diff；核对最近验证是否对应当前代码。
只读取下一项READY任务及其直接接口依赖、原稿对应章节。
按执行计划继续未完成工作，保留用户改动与历史证据。
已有有效的单项开发验证不要无理由重复，但共享接口变化和阶段验收必须重跑适用回归。
有环境缺口标BLOCKED/IMPLEMENTED_UNVERIFIED，不造通过结果。
本轮结束更新实际进度、验证证据、阻塞和明确下一项。
```

### 13.3 从一个已完成阶段推进下一阶段

```text
当前阶段是否完成，以代码、任务账本和真实阶段验证为准，不只读上轮文字总结。
先核对上一阶段出口与当前代码；已完成则按任务索引进入下一阶段。
优先打通一个真实垂直闭环，再增加该阶段反例覆盖，不把未来P1功能提前加入。
需要改公共schema/状态/接口时，记录ADR和兼容影响，先改合同测试，再更新全部消费者。
保留每个run的原始事实，不允许报告层、Skill或测试脚本自行决定ALLOW。
```

---

<a id="references"></a>
## 14. 外部接口依据、核对口径与实施时复查

原稿第22章R01—R21仍保留。本节W编号是本次实施规划用于核对外部接口的官方/项目一手资料，**不是产品实测结果**，也不代表机构认可StackGate。网页会变化；SG-010和SG-076必须记录实际安装版本、命令帮助、兼容性测试及日期，不能仅凭本节链接宣布支持。

| 编号 | 用途与保留边界 | 官方/一手来源 |
|---|---|---|
| W01 | Node运行时生命周期；具体补丁须实测后锁 | `https://nodejs.org/en/about/previous-releases` |
| W02 | Codex Skills目录、SKILL.md与按需资料 | `https://developers.openai.com/codex/skills`；检索跳转至 `https://learn.chatgpt.com/docs/build-skills` |
| W03 | Claude插件目录、manifest、本地加载和验证 | `https://code.claude.com/docs/en/plugins-reference` |
| W04 | GitLab JUnit用于展示，不自行改变job成功状态 | `https://docs.gitlab.com/ci/testing/unit_test_reports/` |
| W05 | Node子进程、Windows cmd/bat、管道与环境行为 | `https://github.com/nodejs/node/blob/main/doc/api/child_process.md` |
| W06 | oasdiff外部引用与SSRF；核对禁用加载参数 | `https://github.com/oasdiff/oasdiff/blob/main/docs/SECURITY.md` |
| W07 | oasdiff支持范围；StackGate仍只承诺已测3.1子集 | `https://github.com/oasdiff/oasdiff/blob/main/docs/OPENAPI-31.md` |
| W08 | Playwright Reporter生命周期、错误处理与结果采集 | `https://playwright.dev/docs/api/class-reporter` |
| W09 | Playwright annotations与重试/flaky事实 | `https://playwright.dev/docs/test-annotations`；`https://playwright.dev/docs/test-retries` |
| W10 | Ajv JSON Schema方言与2020-12校验器 | `https://ajv.js.org/json-schema.html` |
| W11 | Compose项目命名与readiness/依赖启动 | `https://docs.docker.com/compose/how-tos/project-name/`；`https://docs.docker.com/compose/how-tos/startup-order/` |
| W12 | FastAPI真实OpenAPI导出机制 | `https://fastapi.tiangolo.com/how-to/extending-openapi/` |
| W13 | Git共同祖先与diff行为；未跟踪输入需另纳入 | `https://git-scm.com/docs/git-merge-base`；`https://git-scm.com/docs/git-diff` |

本次核对为2026-09-18。原稿2026-09-15基线没有被覆盖；这份计划对配置、helper、任务文件和测试接口的补充均属于实施方案。对于官方示例和本计划发生差异的情况，执行Agent核对实际版本后记录ADR与修改范围，不能为保持一段过期命令而绕过权限或关闭检查。

---

<a id="document-validation"></a>
## 15. 本计划交付前检查与执行者最终自检

本计划的结构检查覆盖：100个SG任务的唯一性与连续性、依赖存在性与无环、阶段范围、F01—F16映射、T01—T27的P0归属、T28后置、任务卡必需字段、Markdown围栏和内部链接、原稿摘要及未替换模板标记。**这些只是规划文档检查，不代表软件已构建、产品测试已通过或插件已安装。**

执行者每完成阶段还要核对真实代码：有没有生产假适配器；有没有两个不一致的Gate；有没有将未验证当通过；有没有删除必须覆盖的验收标准；有没有在用户未知情况下执行代码/联网/上传/清资源；有没有把未经实测的版本/平台写成已支持；有没有把没有做过的研究写成用户反馈。

最终交付报告至少给出：实际完成的SG范围、源码与本地包路径、真实测试和兼容表、未验证范围、已知限制、用户需执行的授权/配置动作以及下一阶段入口。没有完成的部分如实保留，优先交付可以独立运行且验证过的部分，不用目录数量或长文档充当可用产品。

**文档结束。实现从SG-001开始；公开发布与新增P1范围不包含在默认授权中。**
