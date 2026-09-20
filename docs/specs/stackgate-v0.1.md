# StackGate 插件功能与架构设计文档

**文档版本：0.1 · 评审稿**  
**设计基准日期：2026 年 9 月 15 日**  
**产品工作名：StackGate（名称及包名尚未核查占用）**  
**文档类型：产品需求设计 + 技术架构 + MVP 验收规范**

> 产品主张：让 Agent 的改动，不只是分别通过测试，而是在同一份代码、同一套契约和可确认的测试环境中完成验收。

本文提出待开发的产品方案，不代表插件、命令、包名或性能指标已经实现。外部平台能力以文末官方资料为依据；功能编号、数据结构、CLI、配置和路线图均为 StackGate 的设计决定。示例中的路径、接口、测试结果和项目名称均为说明性样例。

## 阅读导航

产品与立项：第 1—4 章。功能拆解：第 5—8 章。技术实现：第 9—16 章。测试、发布与决策：第 17—21 章。外部依据：第 22 章。

---

# 1. 产品定义与插件用途

## 1.1 一句话定义

StackGate 是面向 AI 辅助全栈开发的**变更感知验收工具**。它识别当前改动涉及的 API 契约和已知消费者，组织现有检查工具验证前后端是否对齐，将结果绑定到被测代码与环境，再输出开发者和 Agent 都能使用的失败证据包。

产品主要回答四个问题：这次改动影响什么？应该验证什么？实际验证了什么？失败后下一位执行者如何继续？

## 1.2 它在工作流中的位置

需求与验收约定 → Codex / Claude Code 实现 → **StackGate 组织验收并生成证据** → 原 Agent 或接手 Agent 定向修复 → StackGate 重新验收 → 人工审查与 CI 合并门槛。

StackGate 不需要替代用户的 IDE、Git、测试框架或 Agent。它是这些工具之间的验收协调层，而不是新的全栈开发平台。

## 1.3 三类直接用途

| 用途 | 输入 | 输出与用户收益 |
|---|---|---|
| 改动完成后的联调验收 | Git 变更、已确认契约、检查配置、测试环境 | 明确区分兼容性、当前对齐情况、真实链路结果，减少人工重复联调 |
| Codex 与 Claude 之间的失败交接 | 失败运行、代码指纹、验收约束、复现命令 | 接手者从具体问题开始，不必重新整理完整聊天记录 |
| PR / MR 合并前检查 | 待合并代码、可信策略、CI 环境 | 由程序退出码及仓库规则执行门槛，不依赖 Agent 的完成声明 |

## 1.4 明确不做什么

首版不做自动需求理解、通用代码生成、多 Agent 调度平台、向量记忆库、Token 消费看板、生产部署或自动合并。不承诺发现所有动态依赖、所有业务漏洞、视觉设计问题或安全漏洞。不把一份绿色报告解释为“整个系统没有问题”。

**核心承诺是范围清楚、证据可追踪和结论不过度，而不是全知全能。**

# 2. 目标用户、角色与典型场景

## 2.1 首批目标用户

优先服务已有前后端代码与基本测试、持续让 Agent 修改真实项目的独立开发者和 2—6 人小团队。第一批设计伙伴应能提供脱敏的联调失败样例，并愿意维护少量验收配置。

完全没有测试、没有明确业务预期的原型项目可以使用静态扫描，但不能因此获得完整验收结论。大型微服务平台、多仓库事务链、移动原生应用暂不作为首发对象。

## 2.2 角色与职责

| 角色 | 应做的事 | 不应被默认授权的事 |
|---|---|---|
| 开发者 / 需求负责人 | 确认目标契约、验收条件和允许变更范围 | 不需要手工阅读每一行运行日志 |
| 实现 Agent | 按任务修改代码，调用已授权检查，依据证据修复 | 自行放宽必检项、改权威契约、删除失败证据 |
| 验收引擎 | 执行规则、采集证据、计算范围内结论 | 根据语言模型判断直接批准合并 |
| 接手 Agent | 校验交接包新鲜度，再定位和修复 | 把旧报告当成当前工作区已通过的依据 |
| CI / 仓库维护者 | 使用受保护策略与隔离环境执行合并门槛 | 给外部贡献代码暴露生产凭证 |

## 2.3 核心场景

**S01：响应字段变化。** 后端返回结构变化，前端仍读取旧字段；双方单测因独立 Mock 都通过。插件在契约、消费者映射和真实页面流程之间建立检查链。

**S02：实现偏离约定。** 用户要求保持接口兼容，Agent 却修改了 OpenAPI 来匹配错误代码。插件检测受保护输入变化，不允许用新的标准覆盖旧的失败结论。

**S03：跨工具接手。** Codex 已完成部分实现但联调失败；用户换 Claude Code 继续。插件输出当前失败、已验证范围、允许修复范围与复现入口，而不是转储全部对话。

**S04：测试连接了旧服务。** 页面或接口测试实际命中另一个分支启动的后端。无法确认来源时，报告为环境未确认，不能显示“当前代码已验收”。

**S05：两个分支分别通过。** 前端分支和后端分支各自通过，整合后出现问题。首版不调度分支合并，但要求在实际整合后的候选代码上重新运行；不能拼接两张绿色报告作为整体通过。

# 3. 产品原则与范围控制

## 3.1 六项设计原则

| 原则 | 对设计的约束 |
|---|---|
| 确定性判定优先 | 模型建议与机器证据分开；模型不直接决定门槛 |
| 契约先于修复 | 先知道应当保留什么，再指导 Agent 修改哪一端 |
| 未验证不是通过 | 缺少测试、未知依赖、环境不明均显式呈现 |
| 复用现有工程资产 | 调用现有类型检查、测试、契约差异工具，不重写测试引擎 |
| 渐进接入 | 可以先扫描，再配置集成验收，最后启用 CI 门槛 |
| 本地优先、权限最小 | 核心无需模型密钥；不默认上传代码、日志或聊天记录 |

## 3.2 版本与优先级口径

P0 表示 0.1 MVP 的必需能力；P1 表示 0.2 / 0.3 候选增强，不属于首版承诺；P2 表示有真实需求再投入的方向。这里的版本号是产品路线设计，不是发布日期承诺。

| 维度 | P0：0.1 MVP | P1：后续增强 | P2：暂不承诺 |
|---|---|---|---|
| 项目结构 | 单 Git 仓库；一个前端、一个 API 服务 | 多服务单仓、增量依赖图 | 跨仓分布式验收 |
| 首个官方预设 | FastAPI + React / TypeScript + Vite | Vue / TypeScript、Spring Boot 预设 | 任意技术栈自动适配 |
| API 范围 | REST + JSON；OpenAPI 3.1 已声明支持的子集 | 扩展方言与复杂 schema | GraphQL、gRPC、流式协议全覆盖 |
| 影响分析 | 显式映射优先；有限 TS 导入与调用识别 | 更丰富 AST、运行时辅助映射 | 任意动态调用的完整恢复 |
| 执行环境 | 只读扫描；受信配置的本地执行；已有测试 Compose 文件适配 | 自动生成更多环境模板、资源池 | 自建云执行平台 |
| 结果 | 终端、JSON、Markdown、JUnit | 本地静态 HTML、CI 注释 | 多租户在线控制台 |
| Agent 接入 | Codex Skill、Claude Code Skill / 插件入口 | 可选 Hooks、可选 MCP | 通用 Agent 调度器 |
| 修复 | 证据包指导用户已有 Agent | 有次数与授权边界的辅助循环 | 无监督无限自我修复 |
| CI | GitLab CI 示例与退出码门槛 | GitHub Actions 适配与注释 | 全部 CI 平台原生集成 |

首版“支持 FastAPI”指提供可运行的预设、样例和验收测试，不意味着必须将 StackGate 嵌入业务后端。核心执行器始终独立于业务进程。前端采用其他框架时，可尝试通用命令适配，但不能标注为已认证支持。

## 3.3 三种接入成熟度

**扫描接入：** 只读取文件和契约，输出变更与检查缺口；不执行仓库脚本。

**本地验收接入：** 用户确认命令、环境和权威输入后执行；产出本地证据，明确其信任级别。

**合并门槛接入：** 在可信 CI 策略与隔离环境中重跑必检项；本地报告只作参考，不代替 CI 结果。

# 4. 用户旅程与首次体验

## 4.1 接入步骤

首次接入先运行只读体检，识别目录、包管理器、OpenAPI 文件、已有测试命令和 Docker 可用性。随后展示配置草案及权限清单，由用户确认后写入文件。没有用户确认，不修改已有项目配置、不启动服务、不安装依赖。

接着，用户选择一个关键业务流程，配置预期契约、相关调用方、已有测试与允许的测试环境。插件生成计划，用户检查后运行。失败时输出复现与交接包；修复后重新运行相同验收意图下的新计划或新运行。

## 4.2 示例工作流

以下为计划设计的命令，不表示当前已有可安装的 StackGate 包：

```text
stackgate init --preset fastapi-react --dry-run
stackgate init --preset fastapi-react --apply
stackgate doctor --json
stackgate trust --review
stackgate task validate --file .stackgate/tasks/performance.yaml
stackgate task confirm --file .stackgate/tasks/performance.yaml
stackgate plan --task performance --base origin/main --profile integration
stackgate run --plan PLAN_ID
stackgate report --run RUN_ID --format markdown
stackgate handoff --run RUN_ID --target codex
stackgate gate --run RUN_ID --strict
```

`init --apply` 仅写经展示的配置和模板；`trust --review` 是本地权限提示机制，不是防篡改安全系统。所有命令需要确认工作目录和仓库身份，不以当前目录名推断项目。

## 4.3 第一份报告应当先回答什么

报告第一屏依次显示：本次结论、被测范围与代码指纹、阻塞问题、未验证范围、下一条可复现操作。耗时分布、完整日志和依赖图放在后面，避免用户从大量信息中自行判断是否完成。

首次价值不应依赖配置几十条规则。示例仓库应预装一个真实可复现的“Mock 通过但联调失败”案例。真实项目尚未满足完整验收条件时，清楚展示接入缺口，不使用演示仓库的成功替代真实项目结果。

# 5. 功能设计：项目识别、任务与基线

## F01 项目体检与安全初始化 · P0

**输入：** 仓库路径、可选预设、显式配置文件。扫描限定在 Git 管理文件、指定清单和已配置目录，不递归读取整个磁盘，不读取用户聊天记录。

**处理：** 检查 Git 状态、冲突文件、依赖清单、测试脚本、OpenAPI、Docker、必需可执行程序及运行权限。命令是否存在与命令能否成功分开判断；在未信任项目时不执行 `npm` 生命周期脚本、Python import 或其他仓库代码。

**输出：** `capabilities.json`、缺失依赖、拟写入文件与冲突清单。初始化不覆盖现有文件；更新采用显式补丁。

**验收：** 无 Git、缺少 OpenAPI、已有同名配置、路径含中文及空格均能给出具体提示；只读模式不产生业务文件修改。

## F02 验收任务定义 · P0

任务不是自由文本待办，而是结构化的验收约定：目标、权威契约、必须验证的操作、关键流程、允许变更范围、禁止更改项、必检命令和确认来源。

允许附带自然语言需求，但首版不自动把任意文本转换为可信验收标准。自然语言可以辅助 Agent 起草任务，只有经用户或可信维护流程确认的结构化任务才能成为门槛输入。

任务状态为 `DRAFT → CONFIRMED → SUPERSEDED`。每次确认生成新 revision 和内容摘要。修改必检项、预期断言、策略、目标契约或例外规则必须产生新 revision；旧运行继续保留，不改写为通过。

**验收：** 未确认任务可以扫描，不能获得严格门槛的 ALLOW；目标契约和测试预期变化必须使原计划失效。

## F03 基线与代码快照 · P0

默认 PR / MR 变更分析基线使用目标分支与候选提交的 merge-base，并记录解析后的提交标识；不把浮动的 `origin/main` 字符串当作固定基线。Git 官方将 merge-base 定义为用于合并的共同祖先选择机制。[R11]

本地模式允许脏工作区，但需明确包含：已提交差异、暂存修改、未暂存修改，以及验收输入范围内的未跟踪文件。`git diff` 本身不足以代表所有这些内容。

构建输入清单记录仓库相对路径、文件类型、内容摘要及必要的执行权限。忽略 `.git`、证据目录、依赖缓存、构建输出和凭证文件；被忽略但确实影响构建的文件必须显式声明，否则完整性为未确认。子模块、Git LFS 缺失对象、工作区冲突及越界符号链接在首版直接阻塞相关验收，不假装透明支持。

本地默认在工作区执行，在运行前后复核输入；这是协作场景下的变化检测，不能排除中间被修改又恢复的情况。严格 CI 在独立、受控的候选代码检出中运行，不共享开发者正在编辑的目录。更强的本地快照执行放到 P1。

**验收：** 改动未跟踪的前端文件后旧报告失效；缺少基线对象时返回明确错误，不偷偷退化为只比较最近一次提交。

## F04 权限与配置确认 · P0

展示即将运行的可执行文件、参数、工作目录、环境变量名称、网络目标、Docker 操作、可写位置和最长执行时间。用户的本地确认保存在仓库之外的本地状态中，并绑定配置摘要；执行命令或允许目标改变时再次确认。

相同操作系统身份下的 Agent 仍可能绕过或修改本地配置，因此此机制定位为防误操作提示。受保护的 CI 策略、执行镜像和必要检查定义才承担合并门槛的信任边界。

# 6. 功能设计：契约与影响分析

## F05 三方契约检查 · P0

分别比较三份对象：**基线契约**描述兼容性起点；**已确认目标契约**描述这次应实现什么；**候选实现导出的契约 / 实际响应**描述当前代码做了什么。三者不能混为一份。

| 检查维度 | 比较对象 | 回答的问题 |
|---|---|---|
| 兼容性 | 基线 → 目标 | 这次设计是否可能破坏既有消费者？ |
| 实现一致性 | 目标 → 候选导出 | 当前实现是否偏离已经确认的规范？ |
| 运行一致性 | 目标 → 实际请求 / 响应样本 | 测试执行时看到的数据是否符合约定？ |
| 消费者对齐 | 目标 → 类型检查、映射测试、页面验收 | 已纳入范围的前端是否适配目标接口？ |

FastAPI 的 OpenAPI 导出机制可作为候选实现契约来源，但“实现自己导出的规范”不能独自证明符合用户目标。导出过程可能执行仓库代码，必须在已授权环境中运行。[R07]

首版适配 oasdiff 进行规范差异与破坏性变更识别；StackGate 保存其版本、原始发现和规则映射，而不自行宣称完整实现 OpenAPI 兼容性判断。oasdiff 对较新 OpenAPI 特性的支持有明确范围，发布时必须固定版本并运行支持矩阵测试。[R08][R09]

## F06 首版规则范围 · P0

| 规则族 | 典型变化 | 结论处理 |
|---|---|---|
| 路径与方法 | 操作删除、路径变化、方法改变 | 输出兼容性发现，关联受影响任务 |
| 请求输入 | 必填参数增加、可接受输入缩小 | 按请求方向评估，不套用响应规则 |
| 响应结构 | 字段移除、原保证字段变可选、结构层级变化 | 结合 schema 规则与实际消费者检查 |
| 类型与空值 | number / string、null 许可变化 | 区分请求和响应；不静默强制转换 |
| 状态码与媒体类型 | 成功码变化、JSON 类型变化 | 输出具体操作与旧值 / 新值 |
| 枚举与限制 | 请求允许值减少、响应可能值增加 | 区分输入接收集合与输出承诺集合 |
| 复杂 schema | 组合、条件、动态引用等超出已测能力 | `UNSUPPORTED_SCHEMA`，禁止静默通过 |

字段增加并非在所有系统里都安全；封闭 schema、严格解析器或业务枚举逻辑可能受到影响。规范兼容性检查与用户流程验收保留为不同检查，不让其中一个替代另一个。

MVP 明确支持 OpenAPI 3.1 中经测试的基本对象、数组、属性、required、基本类型、枚举、null、本地片段引用，以及 FastAPI 常见的简单类型加 null 联合表示。一般性的 oneOf / allOf、条件 schema 等只有通过适配器能力测试后才加入支持清单。其他 OpenAPI 版本返回不支持或要求用户提供经验证的输入，不自动降级转换。[R06]

## F07 消费者影响分析 · P0

优先级为：人工显式映射 → 生成客户端元数据 → 支持范围内的 TS 静态导入与字面量调用 → 未知。每条关联保存来源与可信程度，不使用没有依据的“影响概率 98%”。

图中节点包括 API operation、客户端函数、模块、验收用例与工作区。边表示调用、导入、覆盖或显式关联。API 操作键默认使用服务标识 + HTTP 方法 + 规范化路径；`operationId` 用于辅助，不假设永远存在或不会改变。

分析结果同时输出 `known_impacts`、`candidate_impacts` 和 `unresolved_impacts`。动态 URL、运行期注入客户端、跨语言消费者和未配置服务不能被推断为“不受影响”。

**测试选择规则：** 显式必检项永远运行；可靠映射用于增加检查；无法确定影响范围时，运行已配置的工作区回归集。没有可用回归集则为 INCOMPLETE。首版不依赖不完整 AST 图来跳过本应运行的测试。

## F08 测试与验收标准漂移检查 · P0

比较任务 revision、必检用例标识、受保护测试与配置的摘要。以下变化产生独立发现：删除必检测试、将测试改为 skip、减少必须断言、改变测试目标到 Mock、关闭规则、扩大允许例外范围。

首版不声称能完整理解断言语义。确定性规则负责发现已知模式；无法判定的测试修改显示为需要审查的验收输入变化。在严格 CI 中，未被可信审查流程认可的变化不能自动通过。

**验收：** 把失败测试删掉、重命名导致选择器匹配不到、降低最低执行数量，都不能得到绿色结果。

# 7. 功能设计：执行与真实链路验证

## F09 检查计划与执行器 · P0

计划是固定输入下的有向无环图，而不是临时提示词。步骤包含契约解析、差异检查、生成类型检查、项目测试、测试环境准备、候选契约导出、接口样本验证与浏览器流程。

每个步骤声明输入摘要、依赖步骤、命令标识、超时、必要性、证据类型、资源锁与预期测试数量。仅独立且不争用环境的步骤可并行；默认低并发。环境准备失败时，下游步骤显示 BLOCKED，不显示测试失败或通过。

执行命令使用预登记的可执行程序与参数数组，不从模型文本、错误日志或 HTTP 响应中拼接 shell。仓库脚本自身仍可能执行任意代码，因此“不使用 shell 拼接”不是沙箱替代品。

超时、取消、工具崩溃、非零退出、结果解析失败分别记录。测试工具返回 0 但发现测试数为 0、报告缺失或必检用例未执行时，结果为 INCOMPLETE。

## F10 测试环境来源与健康检查 · P0

环境适配支持两种模式。`attach` 连接用户已启动的专用测试环境；`compose` 仅管理用户提供并确认的测试 Compose 文件，不自动推断生产部署拓扑。

| 模式 | 能做什么 | 不能默认承诺什么 |
|---|---|---|
| attach | 检查 URL、健康状态、显式实例标识和可获取的运行来源 | 仅凭 localhost、进程存在或健康接口，就证明服务来自当前代码 |
| compose | 为 run 创建独立 project 名称，记录镜像、容器、构建输入、健康状态与自有资源 | 仅改 project 名就自动隔离固定端口、external volume 或外部数据库 |

Docker Compose 的 project 名用于隔离一组资源；启动顺序与 readiness 仍需健康检查配合。StackGate 必须检查固定 `container_name`、固定宿主端口、共享外部卷和生产连接配置，不能只改名称就宣布环境隔离。[R12][R13]

运行来源分为 `DECLARED`、`OBSERVED`、`CONTROLLED`。attach 默认 DECLARED；获得独立可核对来源后可为 OBSERVED；在可信 CI 中按固定输入构建并启动专用环境才可满足 CONTROLLED 策略。应用自己返回的 revision 是一项线索，不是密码学证明。OBSERVED 至少要同时核对实例身份、启动 / 构建记录与当前输入摘要，并证明测试请求到达该实例；单独存在 provenance 文件不足以满足。无法获取这些信息的 attach 环境只能做诊断，需改用可观测预设或受控 Compose 环境完成验收。

## F11 实际接口与浏览器验收 · P0

接口探针只执行已配置的测试操作，不自动枚举并请求全部 OpenAPI 操作。请求需声明测试身份、合成数据、预期状态、schema 校验和业务断言。读操作也不假设天然无副作用。

浏览器验收复用项目的 Playwright 测试。插件适配器收集实际执行用例、重试、断言、控制台错误、请求失败和相关产物。必检 test_id 使用模板约定的显式 annotation / 映射标识，不依赖可能随路径或标题改变的内部自动 ID；重复或缺失 ID 直接产生检查缺口。Playwright 官方提供机器可读报告和追踪能力，StackGate 在这些结果上增加代码、契约与任务关联。[R04][R05]

“真实链路”最少要求：确认的测试环境、预期操作确实发生、响应来自声明的后端链路、相关 UI / 业务断言执行。仅截图、页面加载成功或前端 Mock 响应都不足以满足要求。支持的测试模板禁用目标 API 的浏览器拦截 Mock，并关联 run 标识与后端访问证据；无法可靠关联的项目显示未确认，不作完整真实链路声明。

第三方支付、邮件、短信等可以使用沙箱或替身，但报告必须区分“真实业务后端”与“第三方模拟边界”。没有后端访问证据时，不能声称已经排除服务端 Mock。

## F12 资源清理、取消与恢复 · P0

每次 run 保存独立资源台账：创建的进程、容器、network、volume、临时文件与所有权标识。只清理本次创建且仍可验证归属的资源；attach 模式不得关闭用户原有服务。

用户取消后停止启动新步骤，终止自有子进程，保存已经形成的证据并执行有界清理。崩溃后 `doctor` 列出遗留资源；清理默认 dry-run。禁止全局 Docker prune、按进程名批量杀服务或自动清空共享数据库。

P0 不从中间状态盲目继续集成测试。重新运行生成新 run，并引用前次运行。跨进程恢复和可证明安全的步骤复用在 P1 再做。

# 8. 功能设计：报告、交接与协作

## F13 证据报告与分层阅读 · P0

默认提供四种结果：终端摘要、结构化 JSON、Markdown 报告、JUnit 汇总。P1 增加离线静态 HTML；首版不启动网络控制台。

报告显示任务 revision、解析后的基线、候选代码摘要、输入覆盖状态、环境来源、必检执行情况、发现、例外、未验证范围和复现入口。每条结论引用 check_id 与 evidence_id；建议与观测事实分栏。

原始日志按文件保存，摘要只选择必要片段。日志超限时保留开头、错误附近与结尾，并标注截断；不能为了节省上下文丢弃退出码、失败断言或尚未验证的范围。

## F14 最小失败交接包 · P0

交接包包含：任务与约束、目标契约摘要、当前代码身份、失败事实、最小相关文件、复现命令、证据索引、允许修复范围、不得改变的验收标准以及下次验证步骤。

**交接包不包含：** 完整聊天记录、所有源代码、模型隐藏推理、数据库凭证、Cookie 或原始身份令牌。代码与日志片段按需加载；证据正文当作不可信数据，不执行其中的指令。

接手时重新校验仓库、工作区、任务 revision 和相关输入摘要。旧包可以作为历史线索，但不能作为当前通过证据。交接从 A 分支到 B 分支后必须重新映射文件并运行检查，不直接沿用行号。

示例交接标题应为“修复 performance 任务中的响应字段不一致”，而不是“请全面检查整个项目并优化”。这种收敛用于减少重复探索，但不保证固定比例的 Token 节省。

## F15 多 Agent 的最小协调 · P0 / P1

P0 通过共同任务契约、统一检查与整合后重跑来协调，不分配 Agent、不调度聊天、不合并分支。各 Agent 的结果是候选工作，不是全栈验收结论。

P1 可增加区域归属、任务依赖和资源预约提示，例如前端等待接口契约确认后再生成客户端。但文件区域约定只是协作提示，不能代替 Git 分支、权限或合并审查。

## F16 人工例外与受控修复 · P1

首版不提供通用 `--force-pass`。对于业务允许的破坏性变更，在已确认任务中明确操作、变更规则、原因与确认来源；不等同于忽略运行失败。

后续如加入风险接受，应记录审批身份、理由、具体范围、到期条件与策略摘要，生成 `risk_acceptance` 而非把 FAIL 改成 PASS。自动修复循环必须由用户主动开启，有次数、费用或时长边界；无改善、验收标准变化、权限升级或环境不明时停止并交给人处理。

# 9. 总体架构与技术选型

## 9.1 架构风格

采用**模块化单体 + 外部检查进程 + 薄 Agent 适配层**。首版不拆微服务，不要求独立数据库，不常驻 daemon。用户运行 CLI 后创建一次有边界的验收执行；结束后保留产物并清理自有临时资源。

| 层 | 组成 | 边界 |
|---|---|---|
| 入口层 | CLI、Codex Skill、Claude 插件、CI 命令 | 只负责调用与呈现，不自行计算验收结论 |
| 应用层 | ProjectService、PlanService、RunService、GateService、HandoffService | 组织用例、控制生命周期、保证输入一致 |
| 领域层 | TaskContract、ChangeSet、ImpactGraph、CheckPlan、Policy、EvidenceManifest | 保存独立于平台的业务规则与模型 |
| 端口层 | GitPort、ContractPort、RunnerPort、EnvironmentPort、EvidenceStore | 定义可替换边界，避免核心依赖具体工具 |
| 适配层 | Git、oasdiff、TS Compiler、Playwright、命令报告解析、Docker Compose | 屏蔽第三方差异，声明能力与限制 |
| 本地存储层 | JSON、JSONL、Markdown、日志与二进制产物 | 一次 run 一个目录；不依赖外部数据库 |

## 9.2 数据流

```text
User / Codex / Claude / CI
          |
          v
      CLI Gateway
          |
          v
Project + Task + Baseline -> Snapshot / Input Manifest
          |
          v
Contract Diff + Consumer Mapping -> Check Plan
          |
          v
Environment + Runner Adapters -> Check Results
          |
          v
Evidence Store -> Policy Evaluation -> Gate Decision
          |                            |
          v                            v
Report / Handoff                  CI exit status
```

证据生成与判定采用单向依赖：检查器提交事实，策略计算结果，报告引用结果。报告渲染器和 Agent 输出不能反向修改检查事实。

## 9.3 核心模块职责

| 模块 | 输入与输出 | 主要实现边界 |
|---|---|---|
| project-discovery | 路径 → 项目与能力清单 | 只读检测，未知即未知 |
| task-policy | 配置、任务 revision → 有效约束 | 合并优先级、保护输入、例外范围 |
| git-snapshot | 基线与工作区 → ChangeSet、input_manifest | 脏工作区、未跟踪文件、变化复核 |
| contract-engine | 三份契约 → 兼容性与一致性发现 | 支持子集、引用安全、稳定发现 ID |
| impact-engine | 变更、映射、TS 信息 → 影响与缺口 | 明确关联来源，不保证完整静态分析 |
| plan-engine | 影响、任务、能力 → DAG | 必检集合、保守回退、资源依赖 |
| executor | DAG → 步骤事件与检查结果 | 并发、超时、取消、原始退出码 |
| environment-manager | 已授权环境配置 → 来源与资源台账 | 健康检查、实例绑定、自有资源清理 |
| evidence-store | 事件与产物 → manifest、摘要与索引 | 原子写入、大小上限、脱敏、校验 |
| gate-engine | 事实、完整性、新鲜度、策略 → ALLOW / DENY | 纯规则判断，可独立单元测试 |
| report-handoff | 已保存运行 → 报告与最小交接包 | 不执行新检查、不伪造通过信息 |

## 9.4 技术选型建议

核心使用 TypeScript / Node.js，以方便 CLI、JSON 结构、现有前端项目与 Agent 适配。首个运行时候选为 Node.js 24，具体最低版本必须在发布前通过跨平台 CI 固定，不使用“任意最新版”作为兼容承诺。[R18]

JSON Schema 校验可采用 Ajv 的 2020-12 能力，但 OpenAPI schema 的请求 / 响应方向、注解和方言差异仍由适配层处理，不能把整个 OpenAPI 文档直接等同于一份普通 JSON Schema。[R06][R19]

规范差异采用锁定版本的 oasdiff 子进程；TS 关联优先使用 TypeScript Compiler API，并限制为已测试的静态模式。[R08][R20] Playwright 由目标项目安装和锁定，StackGate 通过 reporter / 结果适配接入，不强制用户升级测试框架。

Python 与 FastAPI 属于受测项目，核心 CLI 不依赖常驻 Python 服务。复杂环境通过用户提供的 Compose 文件运行。前端不另建 React 管理台；后续 HTML 报告从已保存数据静态生成。

## 9.5 插件自身仓库建议

```text
stackgate/
  apps/cli/
  packages/core/
  packages/contracts/
  packages/adapter-git/
  packages/adapter-oasdiff/
  packages/adapter-typescript/
  packages/adapter-playwright/
  packages/adapter-compose/
  packages/reporters/
  integrations/codex/
  integrations/claude-code/
  integrations/gitlab/
  schemas/
  presets/fastapi-react/
  examples/contract-drift-demo/
  tests/fixtures/
  tests/compatibility/
  docs/adr/
```

这是代码组织建议，不要求每个 packages 目录都成为独立 npm 包。MVP 可发布一个 CLI 分发包加两个 Agent 入口，减少版本管理成本。

# 10. 核心判定逻辑与状态模型

## 10.1 不把所有情况压成一个 success 字段

运行状态至少分成执行阶段、检查结果、运行结论、新鲜度、策略决定五个维度。这样才能区分“执行完了”“测试失败了”“证据过期了”和“允许合并”。

| 维度 | 枚举 | 含义 |
|---|---|---|
| phase | CREATED、PLANNED、RUNNING、FINALIZING、COMPLETED、CANCELED、ABORTED | 执行生命周期 |
| check.status | PASS、FAIL、BLOCKED、SKIPPED、ERROR | 单项检查事实；另存 missing / unsupported 原因 |
| verdict | PASS、FAIL、INCOMPLETE、ERROR | 本次已执行验收的汇总结论 |
| freshness | FRESH、STALE、UNVERIFIED | 与当前代码、任务和策略是否仍匹配 |
| decision | ALLOW、DENY | 在指定 profile 和信任要求下是否满足门槛 |

## 10.2 汇总规则

存在无法形成可信报告的内部错误时 verdict 为 ERROR。否则，存在有效的必检失败时为 FAIL，并保留其他未完成项；没有必检失败但有必检 BLOCKED、SKIPPED、零用例、未知必需能力或来源不明时为 INCOMPLETE。只有必检集合全部满足才为 PASS。

可选检查失败保留为发现，是否阻塞由已确认策略规定，不临时改为可选。用户取消默认 INCOMPLETE；已发生的失败仍保留在检查事实中。清理失败若造成必需的资源归属或安全状态无法确认，则最终为 ERROR，不影响已保存失败事实的可读性。

**严格 ALLOW 条件：** verdict 为 PASS；freshness 为 FRESH；输入范围完整；任务与策略确认有效；环境来源满足 profile；必检项数量与标识匹配；无未批准的验收输入变化。任何条件未知即 DENY。

## 10.3 退出码合同

| 退出码 | `run` / `gate` 的语义 | 处理建议 |
|---|---|---|
| 0 | 在所选 profile 下满足门槛 | 展示已验证范围，不扩展为全系统正确 |
| 1 | 必检失败或确定性策略拒绝 | 按发现修复或走明确的业务审查 |
| 2 | 验证不完整、被取消或必要前提缺失 | 补齐环境、测试或输入信息 |
| 3 | 执行器 / 适配器错误、结果无法可信形成 | 先诊断工具问题，不要求 Agent 乱改业务代码 |
| 4 | 结果或计划相对当前输入已失效 | 重新计划 / 运行 |
| 64 | CLI 参数或配置结构无效 | 按具体字段错误修正 |

优先级为配置无效 → 报告完整性错误 → 新鲜度失效 → 必检失败 → 验证不完整 → 通过；JSON 始终列出全部原因。`scan`、`report`、`handoff` 等数据检索命令的 0 只表示操作成功，不代表门槛通过，不能被 CI 用作验收退出码。

## 10.4 新鲜度与证据身份

证据身份至少绑定：仓库标识、工作区、基线提交、输入 manifest 摘要、任务 revision、目标契约摘要、有效策略摘要、计划摘要、执行器与适配器版本、环境来源和测试数据版本。

不以提交 SHA 或文件 mtime 单独判断新鲜度；本地未提交变更和未跟踪文件也会改变身份。时间戳用于追踪与必要的时间有效期，但“刚运行过”不证明“对应当前代码”。

P0 采用保守失效：验收输入、配置、依赖锁或环境声明变化后重新运行。只对纯静态解析结果提供缓存；跨 run 的集成测试结果不缓存为通过。文档和不相关产物只有在明确排除于输入范围之外时才不会触发失效。

# 11. 领域数据模型与持久化

## 11.1 对象关系

一个 Project 拥有多个 TaskContract revision；一个确认 revision 可生成多个 CheckPlan；每个 Plan 有独立输入身份；每次执行创建新的 Run。Run 包含 CheckResult、Finding、EnvironmentManifest、Artifact 和 GateEvaluation。Handoff 引用 Run，不复制或重写其事实。

## 11.2 关键数据对象

| 对象 | 关键字段 | 不变量 |
|---|---|---|
| ProjectConfig | schema_version、project_id、workspaces、commands、contracts、profiles、security | 未知字段报错；不支持任意脚本求值 |
| TaskContract | task_id、revision、status、goal、target_contract、required_operations、required_checks、constraints | revision 确认后不可原地变更 |
| InputManifest | base_sha、head_sha、files、input_hash、completeness | 路径在仓库边界内；摘要覆盖实际输入 |
| CheckPlan | plan_id、task_ref、profile、policy_hash、input_hash、steps、required_set | 运行前复核输入；DAG 无环 |
| RunManifest | run_id、plan_id、phase、verdict、timestamps、tool_versions | run_id 唯一；完成后不就地改事实 |
| CheckResult | check_id、status、exit_code、test_counts、attempts、evidence_refs | 记录实际执行数量，不能用配置预期冒充 |
| Finding | finding_id、rule_id、category、severity、facts、locations、evidence_refs | 观测与建议分开，位置注明来源版本 |
| EnvironmentManifest | mode、origins、provenance、image_ids、resources、data_revision | 声明来源不自动升格为受控来源 |
| Artifact | artifact_id、relative_path、media_type、size、digest、redaction_state | 不允许路径逃逸；默认本地保留 |
| GateEvaluation | policy_hash、freshness、decision、reasons、evaluated_at | 根据事实重算，不信任外部 success 字段 |

## 11.3 ID、事件与版本

所有对象采用不包含用户名、仓库绝对路径或凭证的唯一 ID。JSON 时间使用 UTC ISO 8601；面向用户的报告可显示本地时区。路径在机器可读记录中使用仓库相对 POSIX 表示，执行时由平台适配转换。

每条事件包含 `event_id`、`run_id`、单调递增 `seq`、UTC 时间、类型与负载版本。事件例如 `run.started`、`check.started`、`check.finished`、`artifact.saved`、`run.finalized`。重复事件不能使检查重复计数。

所有 JSON 对象都包含 schema_version。读取器允许同一主版本中已声明的兼容扩展；重大结构变化需要迁移或明确拒绝。原始历史证据不被静默迁移覆盖。

## 11.4 存储布局

```text
project/
  .stackgate/
    config.yaml              # reviewed project settings
    tasks/performance.yaml   # reviewed task contract
    mappings.yaml            # explicit consumer mappings
    state/                   # gitignored local runtime data
      plans/PLAN_ID.json
      runs/RUN_ID/
        manifest.json
        inputs.json
        environment.json
        events.jsonl
        checks.json
        findings.json
        artifacts/
        report.md
        report.junit.xml
        handoff.md
```

`state/` 默认加入忽略清单；计划和证据不可当作业务代码自动提交。`state_dir` 可配置到其他磁盘，适合将缓存与产物放在 D 盘等位置；路径必须显式指定并验证写入边界。CI 上传前只选择脱敏导出产物，不直接上传整个 state 目录。

持久化使用临时文件写入后原子替换。运行中有仓库与环境锁；锁包含进程身份、随机所有权 token 和创建时间。过期锁不能只因 PID 不存在就盲目删除，需要核对进程重用与资源台账。P0 不依赖 SQLite 或后台服务。

# 12. 配置结构与接口示例

## 12.1 配置合并与信任优先级

顺序为：内置默认值 → 仓库配置 → 被允许的本地运行参数 → 可信 CI 策略约束。CLI 不能放宽 CI 必检项、网络边界或保护文件；本地配置也不能覆盖受保护策略。仓库配置本身来自候选代码时应视为待审查输入。

首版不使用任意字符串变量插值或 `eval`。环境名称引用从明确 allowlist 读取；命令参数按数组传递。参数引用不存在、循环依赖、未知检查 ID 或 YAML 重复键均报配置错误。

## 12.2 项目配置样例

以下为 proposed schema 的可解析示意，不是已发布 SDK。模板脚本与文件需由示例仓库提供并测试；真实项目应替换为自己的检查命令。

```yaml
schema_version: "0.1"
project_id: "demo-stack"
state_dir: ".stackgate/state"
workspaces:
  web: {path: "apps/web", kind: "typescript"}
  api: {path: "apps/api", kind: "fastapi"}
contracts:
  api:
    baseline_file: "contracts/openapi.json"
    target_file: "contracts/openapi.json"
    candidate_artifact: "candidate-openapi.json"
    version: "3.1"
    external_refs: "deny"
commands:
  web_typecheck:
    workspace: "web"
    exec: "npm"
    args: ["run", "typecheck"]
    timeout_seconds: 120
  web_unit:
    workspace: "web"
    exec: "npm"
    args: ["run", "test:stackgate"]
    timeout_seconds: 180
  export_api:
    workspace: "api"
    exec: "python"
    args: ["scripts/export_openapi.py"]
    timeout_seconds: 60
  api_probe:
    workspace: "api"
    exec: "python"
    args: ["scripts/probe_performance.py"]
    timeout_seconds: 60
  web_e2e:
    workspace: "web"
    exec: "npm"
    args: ["run", "test:e2e:stackgate"]
    timeout_seconds: 180
checks:
  contract:
    adapter: "openapi"
    service: "api"
    candidate_command: "export_api"
  typecheck:
    adapter: "command"
    command: "web_typecheck"
    result_kind: "exit-code"
  unit:
    adapter: "junit"
    command: "web_unit"
    min_tests: 1
  runtime:
    adapter: "stackgate-probe"
    command: "api_probe"
    required_operations: ["GET /api/performance"]
  e2e:
    adapter: "playwright"
    command: "web_e2e"
    required_test_ids: ["performance-summary"]
    require_real_backend: true
profiles:
  integration:
    required_checks: ["contract", "typecheck", "unit", "runtime", "e2e"]
    environment: "test"
    minimum_provenance: "OBSERVED"
    unknown_impact: "workspace-regression"
    flaky_policy: "incomplete"
environments:
  test:
    mode: "attach"
    frontend_origin: "http://127.0.0.1:5173"
    backend_origin: "http://127.0.0.1:8000"
    health_path: "/health"
    provenance_file: ".stackgate-runtime.json"
security:
  env_allowlist: ["STACKGATE_TEST_TOKEN"]
  allow_origins:
    - "http://127.0.0.1:5173"
    - "http://127.0.0.1:8000"
  protected_inputs:
    - ".stackgate/tasks/**"
    - "contracts/**"
    - "tests/acceptance/**"
  telemetry: "off"
```

`baseline_file` 从固定的基线提交读取，`target_file` 从经确认的目标 revision 读取；即使路径相同也不是同一对象。`candidate_artifact` 从本次受控输出目录获取，不能读取工作区里残留的旧产物。

运行器向已登记命令注入 `STACKGATE_RUN_ID`、`STACKGATE_OUTPUT_DIR`、`STACKGATE_API_ORIGIN` 和 `STACKGATE_WEB_ORIGIN`。命令报告写入当前输出目录；框架适配器检验文件属于本次执行。`provenance_file` 需要按发布模板生成并与当前进程 / 构建核对；随意写入该文件不会自动获得 OBSERVED。

命令的结果格式必须满足对应适配器：JUnit 需实际用例；probe 需操作、状态、断言与运行身份；Playwright 需 reporter 输出和稳定用例 ID。结果文件路径由适配器合同确定，不从日志文本猜测。

## 12.3 任务配置样例

```yaml
schema_version: "0.1"
task_id: "performance"
revision: 1
status: "DRAFT"
goal: "页面正确展示目标接口中的累计收益率"
target_contract: "contracts/openapi.json"
required_operations: ["GET /api/performance"]
required_checks: ["contract", "typecheck", "unit", "runtime", "e2e"]
required_test_ids: ["performance-summary"]
allowed_change_paths:
  - "apps/web/src/**"
  - "apps/api/app/**"
constraints:
  preserve_target_contract: true
  allow_test_deletion: false
  require_backend_observation: true
  allow_production_targets: false
expected_behavior:
  - "页面读取 data.performance.total_return"
  - "缺失数据时展示明确空状态，不显示 NaN"
compatibility:
  mode: "preserve"
  approved_breaking_rules: []
```

样例刻意保持 DRAFT，避免让复制模板等同于用户批准。确认流程会生成独立确认记录并绑定 revision 摘要；CI 使用可信维护流程认可的记录，而不是相信 YAML 中自行填写的身份。

## 12.4 报告 JSON 摘要样例

```json
{
  "schema_version": "0.1",
  "run_id": "run_demo_001",
  "phase": "COMPLETED",
  "verdict": "FAIL",
  "freshness": "FRESH",
  "decision": "DENY",
  "scope": {
    "task_id": "performance",
    "task_revision": 1,
    "required_checks": 5,
    "completed_checks": 5
  },
  "coverage_gaps": [],
  "findings": [
    {
      "rule_id": "SG-CONSUMER-001",
      "category": "consumer-mismatch",
      "evidence_refs": ["ev_assertion_001"],
      "message": "必检页面断言失败，前端仍使用旧响应字段"
    }
  ],
  "not_verified": ["其他业务页面", "生产数据与生产部署"]
}
```

此处是摘要视图，完整 manifest 还必须包含第 11 章的输入、工具与环境身份。不能将这个删减示例作为完整报告 schema。

# 13. CLI 与适配器接口设计

## 13.1 CLI 命令范围

| 命令 | 用途 | 副作用与限制 |
|---|---|---|
| `init` | 生成配置与入口草案 | 默认预览；`--apply` 才写文件，不覆盖已有内容 |
| `doctor` | 能力、依赖、配置与遗留资源检查 | 默认只读，不自动安装依赖 |
| `trust --review` | 展示并记录本地执行授权 | 绑定配置摘要，不能替代操作系统安全边界 |
| `task validate` | 验证任务结构及引用 | 不自动确认业务意图 |
| `task confirm` | 本地人工确认任务 revision | 记录摘要；CI 仍需可信的审查来源 |
| `scan` | 读取变更、契约、映射与未知影响 | 不执行项目脚本；退出 0 不代表验收通过 |
| `plan` | 固定基线、输入、策略并生成 DAG | 写计划，不运行测试 |
| `run` | 执行指定计划 | 运行前复核身份；无效计划拒绝执行 |
| `report` | 输出 JSON / Markdown / JUnit 视图 | 不执行新检查；不能修改原始事实 |
| `handoff` | 输出指定 Agent 可读的失败交接包 | 默认本地文件；不自动发送或启动模型 |
| `gate` | 重新核对新鲜度与策略门槛 | 用于 CI 和最后完成判断 |
| `clean` | 清理自有运行资源与产物 | 默认预览，执行需显式 `--apply` |
| `adapters install` | 生成 Agent 入口安装草案 | 默认预览；不覆盖全局规则 |

公共参数包括 `--config`、`--project`、`--json`、`--no-color`。读取 JSON 的调用方不得依赖终端排版；JSON 放 stdout，进度与诊断放 stderr。路径型参数按原始参数处理，不拼接 shell。

profile 在生成计划时固定；运行时不允许换用另一套 profile 而复用原计划。`--strict` 表示执行已确认的完整性与信任要求，不是自动发现更多业务知识。用户不能通过命令行 `--strict=false` 放宽可信 CI 策略。

## 13.2 适配器协议

适配器提供能力声明、计划构建、执行、结果解析与诊断接口。跨进程协议以版本化 JSON 为主，避免要求每个第三方工具成为同一种语言的库。

```text
describe() -> AdapterCapabilities
validate(config, project) -> Diagnostics
plan(inputs, policy) -> CheckStep[]
execute(step, executionContext) -> EventStream
collect(step, outputDirectory) -> CheckResult
```

`AdapterCapabilities` 声明支持的输入方言、版本范围、证据格式、操作系统、来源验证能力和已知限制。适配器无法处理的字段必须进入 diagnostics，不能忽略后照常返回 PASS。

`ExecutionContext` 只包含当前 run 的必要路径、允许环境变量、允许目标和取消信号；不给每个适配器完整用户环境、全部密钥或任意仓库外写权限。

## 13.3 统一发现分类

建议稳定使用 `SG-CONTRACT-*`、`SG-CONSUMER-*`、`SG-RUNTIME-*`、`SG-EVIDENCE-*`、`SG-POLICY-*`、`SG-ENV-*` 和 `SG-TOOL-*` 规则族。规则 ID 不随中文文案变化。

发现中至少分开 `observed_facts`、`suggested_cause`、`recommended_action`。某个页面断言失败是事实；“可能是字段映射遗漏”是解释。只有获得对应代码 / 运行证据后，才把解释升级为确定结论。

P1 可增加 MCP 工具 `scan_change`、`create_plan`、`run_checks`、`get_report`、`get_evidence` 和 `prepare_handoff`。它们必须复用 CLI 的授权与策略，不成为绕过 CLI 门槛的第二条执行通道。

# 14. Codex 与 Claude Code 接入设计

## 14.1 共同原则

两个平台共用核心 CLI、任务 schema、报告 schema 和主要流程说明，只把入口路径、命令名称和 Hooks 协议放在适配层。禁止维护两套会产生不同验收结论的逻辑。

Skill 是工作流入口，不是可信执行证明。StackGate 的核心不需要额外模型账户；开发者继续使用已授权的 Codex 或 Claude Code。插件不能承诺宿主不会消耗额度，也不承诺所有平台自动调用行为一致。

## 14.2 Codex 入口 · P0

按当前官方文档，Codex 可从仓库 `.agents/skills` 加载 Skill；Skill 使用 `SKILL.md`，将附加资料按需放在 references / scripts 等目录。[R01]

计划安装结构：

```text
.agents/skills/stackgate-verify/
  SKILL.md
  references/result-contract.md
  references/failure-handoff.md
```

流程要求：先读取当前任务与配置；已有有效计划则复用，否则生成计划；按已授予权限执行；读取结构化结果；失败时先验证具体事实；修复后重新运行；最终回答注明运行 ID、范围与未验证项。

Codex 的 `codex exec`、JSONL 与结构化输出能力可以作为后续脚本接入方式，但首版不主动启动新的 Codex 会话，也不读取或迁移认证文件。[R17] 这既降低耦合，也避免把“验收插件”扩大成模型路由器。

## 14.3 Claude Code 入口 · P0

计划发布结构：

```text
integrations/claude-code/
  .claude-plugin/plugin.json
  skills/verify/SKILL.md
  skills/handoff/SKILL.md
  references/
  scripts/
```

`.claude-plugin` 只存 manifest，skills 与脚本位于插件根目录；按当前官方插件结构实现，发布时使用官方验证命令检查。[R02] 初期使用明确手动入口，避免每次编辑都自动执行完整测试。会启动服务或运行检查的工作流可使用手动调用限制；宿主权限仍需要单独遵循。[R03]

## 14.4 Hooks 增强 · P1

截至本次核对，Codex 和 Claude Code 均有官方 Hooks 文档，不能继续以“Codex 没有 Hooks”为架构前提。但事件覆盖和返回字段不同，必须按平台及实测版本分别适配。[R15][R16]

Hooks 只做短检查：当前任务是否需要验收、是否存在新鲜结果、是否已经给过提示。完整测试由正常 CLI 调用执行，不在 Stop 回调内启动长链路，也不在每次工具输出后重新测试。

默认仅提示，不阻止用户结束。用户主动开启完成门槛后，同一任务 revision 和输入身份最多触发一次自动续行提醒；检查 `stop_hook_active`、运行锁与去重 token，禁止无限“再检查一遍”。用户取消、额度错误或权限问题不能被插件当作继续执行的授权。

平台 Hook 返回码由专用包装器生成，不能直接透传 StackGate 的 CLI 退出码。例如 StackGate 的 2 表示验收不完整，而宿主的 Hook 退出 2 可能表示阻塞 / 续行；两者语义不同。[R15][R16]

## 14.5 交接提示的最小结构

```text
任务：performance，revision 1。
先校验交接包对应的仓库与当前输入。
失败：必检页面断言未通过，证据为 ev_assertion_001。
目标：保持已确认的目标契约，不恢复旧 Mock 掩盖问题。
允许修改：任务中声明的应用源码范围。
先读取：具体客户端与页面文件，再读取所需证据片段。
修复后：重新计划或运行有效计划，并执行 gate。
禁止声称未运行的检查已通过。
```

用户实际权限和当前明确指令始终优先。交接包不是授权凭据，不能增加接手 Agent 的写入、网络或部署权限。

# 15. Windows、Docker 与 CI 集成

## 15.1 本地运行设计

P0 目标验证环境为 Windows 11 的原生 CLI、WSL2 / Linux CLI，以及 Linux CI。macOS 先提供能力检测，完成发布矩阵后再列为正式支持。避免把“Node 可以运行”误写为全部环境适配已通过。

执行器需专门处理 PowerShell / Windows 路径、`.cmd` 程序、UTF-8 输出、CRLF、大小写差异、子进程终止和文件锁。WSL 与 Windows 不共享一套含绝对路径的运行缓存；状态目录以平台身份隔离。

Docker Desktop 中，容器内 localhost 指容器本身；访问宿主服务可使用其提供的特殊主机名。Compose 服务间则通常应使用服务 DNS 名和容器端口。配置必须区分“宿主调用地址”“浏览器地址”和“容器内部地址”，不根据单个 URL 自动猜测。[R14]

## 15.2 Compose 管理边界

首版接收已存在的测试 Compose 文件；不凭空生成用户的完整后端、数据库和初始化脚本。`docker compose config` 的有效配置摘要可用于检查项目命名、挂载、环境目标和网络，但其输出可能包含敏感值，落盘前必须脱敏。

每次运行使用独立名称并保存归属。动态端口应从实际创建资源中读取，不能假定固定 8000 或 5173 永远空闲。若测试配置含固定宿主端口，首版检测冲突并阻塞，不自动杀掉占用服务。

测试数据库使用专用实例或明确隔离的数据命名空间、最小权限测试账户和版本化种子。仅数据库名带 `test` 不足以证明安全；连接目标、凭证权限和资源来源都需要确认。迁移只允许在本次专用测试环境中执行已授权命令。

## 15.3 GitLab CI 合并门槛 · P0

建议流程为：检出待审查代码 → 获取固定基线与可信策略 → 准备隔离测试环境 → 运行 StackGate → 保存报告 → 原样返回门槛退出码 → 按仓库规则决定是否允许合并。

JUnit 用于展示，不是门槛本身。GitLab 官方明确说明，JUnit 报告不会改变 job 状态；script 必须非零退出才能使 job 失败。[R10] 因而禁止在验收命令后无条件 `|| true`，也不能只检查报告文件存在。

CI 必须记录被测提交及合并策略。源分支测试通过不意味着与更新后的目标分支兼容；需要在合成合并结果或最新可接受的候选状态上重跑，具体由 CI 能力与仓库规则决定。

## 15.4 可信策略与不可信代码分离

执行器版本、必检入口和最小策略从维护者控制的固定版本获取，不能全部从候选 PR / MR 中加载。验收输入变更单独显示并要求审查。项目测试脚本本身仍是不可信代码，必须在无生产密钥的隔离执行环境中运行。

外部贡献不能获得维护者写权限凭证，不能通过高权限工作流执行未审查代码。GitHub Actions 的后续适配应遵循其官方关于不可信输入、动作固定版本和最小权限的安全指导。[R21]

首版不自动发布 PR 评论或上传外部服务。GitLab 报告产物的上传、保留与可见性由用户 CI 配置决定；提供模板时必须同时提示敏感截图和追踪文件的处理边界。

# 16. 安全、隐私与可信边界

## 16.1 主要威胁与措施

| 风险 | 默认措施 | 剩余边界 |
|---|---|---|
| 模型修改测试或策略“修绿” | revision、受保护输入差异、可信 CI 策略 | 同权限本地进程仍可绕过本地规则 |
| 仓库命令执行危险操作 | 首次预览、配置摘要确认、隔离 CI、最小环境变量 | allowlist 不等于脚本内容安全 |
| OpenAPI 引用触发内网请求 | 默认拒绝外部引用、固定解析边界 | 本地引用仍需检查目录逃逸 |
| 测试误打生产接口 | 明确允许目标、专用测试身份、受控网络 | 域名与命名检查不足以单独证明非生产 |
| 日志 / 截图泄露凭证 | 合成账户、文本脱敏、产物分级、默认不上传 | 截图和 trace 不能保证自动彻底脱敏 |
| 错用旧报告 | 代码、任务、策略与环境身份绑定 | 缺失输入声明会降低结论强度 |
| 清理误删用户资源 | 资源台账、所有权标识、清理预览 | 无法确认归属时保留并告警 |
| 证据内容提示注入 | 事实区与指令区分离，不执行证据文本 | 外部 Agent 仍需遵守自身安全约束 |

## 16.2 外部引用与网络

oasdiff 官方指出外部 `$ref` 可能造成 SSRF，并提供关闭外部加载的选项。首版使用自包含契约，明确拒绝外部 URL 与文件引用；不能采用工具默认允许行为处理不可信规范。[R09]

即使使用不含外部引用的规范，浏览器与项目脚本仍可能发起网络请求。CLI 的 origin allowlist 只能约束其直接控制的请求；严格网络边界需要执行环境的网络策略。Docker 默认容器并不等于完整的恶意代码沙箱，挂载 Docker socket 尤其不能作为隔离方案。

## 16.3 日志与证据隐私

文本产物在写入常规 evidence 区前应用结构化字段过滤和令牌遮盖；不记录 Authorization、Cookie、Set-Cookie、数据库密码等原值。无法可靠识别的敏感原始产物放在 restricted 区或不保留，不自动进入交接包。

浏览器 trace、视频和截图可能保留个人数据、请求与页面内容。默认使用合成数据；对外导出采用明确选择与预览。CLI 不宣称正则匹配能完成所有脱敏。

模型密钥不是核心运行前提。遥测默认关闭；后续若加入，需单独选择启用，并与代码、日志、仓库路径完全分离。不读取宿主 Agent 的认证文件或完整对话数据库。

## 16.4 证据不可篡改的表述边界

摘要与哈希可以检测内容变化，不能证明测试充分、配置正确或记录者诚实。本地 report 不是防恶意 Agent 的可信凭证。未来可引入 CI 签名与产物来源声明，但签名也只证明由指定流程生成，不证明业务正确。

产品文案使用“绑定被测状态的验收记录”，不使用“百分之百可信证明”“防所有 Agent 绕过”或“自动保证质量”。

# 17. 性能、成本与可观测性

## 17.1 性能设计目标

下表是待通过基准验证的目标，不是当前测量结果。参考基准应固定为 2,000 个纳入输入的源码 / 配置文件、总计不超过 20 MB、单个 OpenAPI 不超过 2 MB、普通 SSD 环境，并记录机器配置。

| 指标 | 建议验收目标 | 统计范围 |
|---|---|---|
| 只读体检 | p95 不超过 5 秒 | 不含首次安装、联网下载、构建 |
| 已缓存输入下重新计划 | p95 不超过 2 秒 | 不含执行项目代码与外部测试 |
| 报告摘要读取 | p95 不超过 1 秒 | 本地已完成运行，无重新测试 |
| 框架额外开销 | 集成流程中单独报告 | 与项目构建、测试、模型耗时分开 |
| 产物上限 | 默认每 run 100 MB，可配置 | 达上限给出截断 / 缺失提示，不伪造完整证据 |

集成验收总时长取决于项目，不能统一承诺“几秒完成全栈验收”。100 MB 是产品默认建议；关键证据缺失时即使为了控磁盘，也必须使相关检查不完整。

## 17.2 降低成本的方法

首先采用确定性解析与现有测试，不为普通 diff 启动模型；其次用显式映射选择检查，但保留必检集合与未知影响的回退；再使用内容摘要缓存纯解析结果，而非盲目缓存业务验收通过；最后让 Agent 按需读取失败证据，不在每轮注入完整架构文档与日志。

不要以“读文件更少”或“Token 更少”单独判断优化。必须同时比较任务成功率、遗漏问题、人工复核时间和重试次数。

## 17.3 重试与 flaky 策略

读取底层测试框架的真实重试信息。第一次失败、重试后通过不能只展示最终绿色。Playwright 会区分 flaky 等结果，适配器应保留这些事实。[R05]

默认必检 flaky 视为 INCOMPLETE，等待复现或已确认的特定处理策略；不无限重试直到成功。重复失败按稳定 rule_id 与证据位置聚合，但不删除独立失败实例。

## 17.4 可观测指标

每次运行记录计划时间、各步骤等待 / 执行时间、命中缓存类型、测试数、失败数、未知影响、人工例外、产物大小、环境准备和清理结果。

插件自身不需要收集模型用量才能工作。若后续导入模型统计，必须区分输入、缓存输入、输出以及观察范围；无法获取的数据标为未知，不根据订阅额度推算准确账单。

# 18. 开发任务拆解与发布路线

## 18.1 推荐实现顺序

| 阶段 | 交付物 | 进入下一阶段的条件 |
|---|---|---|
| M0：规范与故障样例 | schema、退出码、任务样例、故障仓库 | 基线 / 目标 / 候选三方概念无歧义，故障可人工复现 |
| M1：只读扫描 | CLI、Git 输入清单、规范差异、显式消费者映射 | 能稳定定位范围并显示未知，不执行仓库脚本 |
| M2：执行与证据 | DAG、命令 runner、状态存储、JSON / Markdown 报告 | 零测试、工具报错、取消、过期均不会绿灯 |
| M3：真实全栈闭环 | 测试环境适配、接口探针、Playwright 证据 | 示例中的 Mock 假通过能被真实链路验收拦下 |
| M4：产品化 MVP | 两平台入口、GitLab 示例、安装 / 卸载、文档 | 用户能独立接入；不依赖作者现场修改代码 |
| M5：外部验证 | 设计伙伴案例、基准对照、失败与限制披露 | 有重复使用和净节省人工返工的证据 |

这些阶段是依赖顺序，不是未来工作的时间估算。首版完成标准由验收用例决定，而不是目录数量或功能演示数量。

## 18.2 适合多 Agent 分工的边界

可并行任务是 schema / 核心规则测试、Git / 契约适配、报告渲染和示例仓库。共同接口必须先固定。执行器、环境生命周期与证据模型有强依赖，应由一位负责人统筹，避免同时修改状态协议。

两个 Agent 修改同一协议时先合并 schema 变更，再推进适配；每个 PR 附带接口变化与固定故障用例结果。整合后的测试必须运行，不能以子 Agent 的“本模块已完成”替代。

## 18.3 后续迭代优先级

0.2 候选增强为 Vue / Spring Boot 预设、GitHub Actions、离线 HTML、更多 AST 映射。0.3 候选为有界 Hooks、局部证据读取 MCP、资源更强隔离与选择性重测。多仓平台、云服务、自动模型调度只有在明确用户需求和维护能力支撑后再评审。

# 19. 测试方案与 MVP 验收标准

## 19.1 测试层级

领域层使用表驱动单元测试验证状态、门槛、输入失效与策略优先级。适配器使用固定版本工具和金样例做合同测试。集成层在真正的前端 + 后端 + 测试数据环境中执行。跨平台层验证路径、进程、编码和清理。安全层验证不可信配置、引用、日志与资源归属。

测试 StackGate 本身时，也不能仅用伪造成功 JSON 覆盖全部场景；至少一个端到端夹具必须启动真实样例服务并产生真实浏览器失败与修复结果。

## 19.2 必须通过的验收用例

| ID | 场景 | 预期结果 |
|---|---|---|
| T01 | 后端字段重命名，前端仍读旧字段 | 定位相关操作与消费者；真实断言 FAIL |
| T02 | 前后端单测依赖各自 Mock 都通过 | 不直接 ALLOW；必检真实链路仍运行 |
| T03 | 删除必检测试使 runner 返回 0 | INCOMPLETE 或策略 DENY，显示缺失用例 |
| T04 | Agent 修改目标契约以迎合错误实现 | 原 revision / plan 失效，要求审查 |
| T05 | 接口 number 实际返回 string | 在支持的 schema 规则中 FAIL，不强制转换后通过 |
| T06 | 本应必有字段变成缺失或 null | 根据方向与目标 schema 产生具体发现 |
| T07 | 不支持的 schema 特性参与变更 | INCOMPLETE，指出特性与位置 |
| T08 | 动态消费者无法解析但有回归集 | 运行回归集，同时保留影响分析缺口 |
| T09 | 动态消费者无法解析且无回归集 | INCOMPLETE，不能默认无影响 |
| T10 | 服务健康但运行来源无法确认 | 不声明当前代码已验收，严格 DENY |
| T11 | 实际请求命中另一分支旧服务 | 来源检查失败或无法确认，不 ALLOW |
| T12 | 运行后修改未跟踪业务文件 | 旧运行 freshness 为 STALE |
| T13 | 验收期间工作区变动 | 当前运行失效或明确降级，不能静默绑定最后状态 |
| T14 | 目标分支推进、原计划仍用旧基线 | 明确指出基线策略不满足，要求重算 |
| T15 | 测试工具退出 0 但未生成报告 | INCOMPLETE / ERROR，不能判定通过 |
| T16 | 第一次失败，重试后成功 | 保留 flaky；默认不视为可靠 PASS |
| T17 | 测试环境未启动或端口冲突 | 环境 BLOCKED，下游未执行，不伪装业务 FAIL |
| T18 | 用户取消时已有子进程和容器 | 保留证据，只清理自有资源 |
| T19 | attach 模式运行后执行清理 | 用户原服务不被关闭 |
| T20 | OpenAPI 包含外部 URL / 越界文件引用 | 拒绝加载，不产生内网访问 |
| T21 | 日志含 Authorization / Cookie | 常规报告与交接中不出现原值 |
| T22 | Windows 中文路径、空格和 CRLF | 命令参数、输出解析与状态保存正确 |
| T23 | Codex 交接到 Claude 后修改了任务 | 交接包被识别为旧任务，不自动沿用通过结果 |
| T24 | CLI `report` 返回 0，但 verdict 为 FAIL | CI 必须依赖 gate / run 退出码，不误绿 |
| T25 | 两分支分别通过，整合后契约失配 | 整合候选重新验收并 FAIL |
| T26 | 基线已有失败，本次也失败 | 标注可能为既有问题，但不自动豁免必检失败 |
| T27 | 项目试图放宽可信 CI 必检规则 | 策略合并拒绝，显示冲突 |
| T28 | Hook 多次收到同一任务结束事件 | P1：有界提醒，无无限续行 |

T01—T27 是 P0 发布门槛；T28 仅在 Hooks 功能发布时启用。不同技术栈预设必须各自运行适用测试，不能用 React 的结果替 Vue 或 Java 背书。

## 19.3 产品效果验证

对照组 A 为原生 Agent 加项目已有测试；B 为合理配置的现有契约 / 验收工具；C 为同样任务加 StackGate。固定任务、模型版本、验收要求和可用时间条件，重复运行受随机性影响的任务，并保留失败案例。

首要指标是人工定位与修复耗时、实际漏检与误报、从失败到验收通过的总工作量。辅助指标为首次接入耗时、维护配置的频率、下一次同类任务的自主复用。Star、下载量与演示播放量不能替代这些指标。

建议先用不少于 12 个可复现故障夹具，再用设计伙伴的真实任务验证迁移效果。样本量是启动研究的建议，不构成统计显著性或市场匹配证明。若工具仅增加配置而未减少返工，应缩减功能或转为现有项目的适配层。

# 20. 开源发布、维护与产品包装

## 20.1 第一屏要表达的价值

建议 README 以“前后端各自通过，联调仍然失败”的可运行案例开场，展示同一任务的发现、证据、修复和重验。不要用泛化的“下一代 AI 全栈平台”作为首要卖点。

示例仓库必须公开故障注入方式、目标契约、预期输出和未覆盖范围。安装命令只在包名确认、发布完成并实测后公布；本文不提供虚构的 npm 安装地址。

## 20.2 首发仓库材料

| 材料 | 必须包含 |
|---|---|
| README | 一句话用途、支持范围、演示、接入成本、已知限制 |
| QUICKSTART | 只读模式与完整验收两条路径、清理与卸载 |
| SECURITY | 信任模型、外部贡献边界、漏洞报告方式、日志隐私 |
| COMPATIBILITY | CLI、OS、工具版本与已测 OpenAPI 子集 |
| SCHEMAS | 版本化 JSON Schema、样例、迁移约定 |
| CONTRIBUTING | 增加规则 / 适配器的测试要求，禁止跳过未知情况 |
| CHANGELOG / ADR | 行为变更、门槛变化、兼容决策与弃用策略 |

开源许可应在确认自身与依赖许可兼容性后选定，作为单独发布决策，不把 GitHub 可见代码一律当作可任意复制。名称、商标、包名和组织名需核查；本文不声称已经完成。

## 20.3 卸载与更新

卸载只移除 StackGate 生成且未被用户修改的入口；已修改文件提供差异并保留。检查产物和运行数据单独选择清理，不删除项目契约、测试或业务文件。

更新前检查 schema 和适配器兼容性；无法读取旧报告时保留原文件并提示使用对应版本，不静默丢失历史。规则行为变化可能改变门槛，需写入变更说明和迁移建议。

# 21. 关键架构决策与待验证问题

## 21.1 建议冻结的决策

| ADR | 决策 | 原因与代价 |
|---|---|---|
| ADR-001 | 本地 CLI 核心，不建常驻平台 | 降低接入与运维成本；实时协作能力有限 |
| ADR-002 | 确定性引擎决定门槛，Agent 负责实现与解释 | 降低结论漂移；需要明确规则与用例 |
| ADR-003 | 基线、目标、候选实现三方分离 | 避免改规范掩盖错误；需要任务确认流程 |
| ADR-004 | 显式映射优先，未知影响保守回退 | 避免过度相信静态图；部分任务会多跑测试 |
| ADR-005 | P0 不缓存跨 run 集成通过结果 | 降低陈旧证据风险；执行时间更长 |
| ADR-006 | 复用契约差异与测试工具 | 减少重复建设；必须维护版本适配 |
| ADR-007 | 本地记录不是安全凭证，严格门槛依赖可信 CI | 表述与安全边界清楚；本地体验无法替代组织治理 |
| ADR-008 | Hooks 后置且默认提示 | 避免打断与无限循环；首版自动触发较少 |
| ADR-009 | 不自动修改业务代码、合并和部署 | 控制范围与权限；修复由现有 Agent 执行 |

这里的“冻结”是立项建议，不代表用户已经批准全部技术细节。用户后续明确调整优先于本稿；变更时记录影响的功能、schema、测试与文档章节。

## 21.2 发布前必须验证，不靠猜测的事项

首个试点项目能否提供稳定目标契约与至少一条真实验收流程；支持的 oasdiff / Ajv / Playwright 版本对声明子集是否一致；两平台当前安装路径与返回格式是否与实测一致；Windows 子进程清理是否可靠；环境来源证据能否避免常见旧服务误判；设计伙伴是否愿意维护必要的显式映射。

默认处理已经明确：无法证明的能力标为未知；不支持的环境不宣称认证；缺少真实链路证据不给完整验收通过。这些问题应通过 M0—M4 的测试消除，不用“未来 AI 足够聪明”替代工程方案。

## 21.3 最终产品边界

StackGate 的壁垒不在启动更多 Agent，而在三项可持续积累：**真实全栈失败样例、可靠适配器、与被测状态对应的证据和判定规范。**

首版的成功形态是：用户能在自己的一个真实任务中，用少量配置获得具体、有用、不过度的失败解释，并在修复后对相同验收要求重新验证。先把这一闭环做扎实，再扩技术栈、协作能力和呈现界面。

# 22. 官方依据与参考资料

核对日期统一为 2026 年 9 月 15 日。资料用于确认外部工具接口与限制，不代表这些机构认可 StackGate 设计，也不构成任何效果背书。实施与发布前应再次核对，并把实际测试版本写入 COMPATIBILITY。

**[R01] OpenAI — Build skills**  
用于 Codex Skill 目录、按需加载、元数据与分发方式。  
`https://learn.chatgpt.com/docs/build-skills`

**[R02] Anthropic — Plugins reference**  
用于 Claude Code 插件 manifest、组件目录与验证方式。  
`https://code.claude.com/docs/en/plugins-reference`

**[R03] Anthropic — Extend Claude with skills**  
用于 Skill 调用方式、手动调用限制与权限边界。  
`https://code.claude.com/docs/en/skills`

**[R04] Microsoft — Playwright Reporters**  
用于 JSON / JUnit 等结果适配与报告设计。  
`https://playwright.dev/docs/test-reporters`

**[R05] Microsoft — Playwright Trace viewer / Retries / Web server**  
用于调试产物、重试事实与服务启动配置；这些能力不自动证明业务正确。  
`https://playwright.dev/docs/trace-viewer`  
`https://playwright.dev/docs/test-retries`  
`https://playwright.dev/docs/test-webserver`

**[R06] OpenAPI Initiative — OpenAPI Specification v3.1.1**  
用于本稿明确支持的规范版本参考；不声称它是最新规范。  
`https://spec.openapis.org/oas/v3.1.1.html`

**[R07] FastAPI — Extending OpenAPI**  
用于候选实现的 OpenAPI 导出与应用方法。  
`https://fastapi.tiangolo.com/how-to/extending-openapi/`

**[R08] oasdiff — 项目文档与 OpenAPI 支持范围**  
用于规范差异适配与能力矩阵。  
`https://github.com/oasdiff/oasdiff`  
`https://github.com/oasdiff/oasdiff/blob/main/docs/OPENAPI-31.md`

**[R09] oasdiff — Security / External references**  
用于外部引用加载风险与限制。  
`https://github.com/oasdiff/oasdiff/blob/main/docs/SECURITY.md`

**[R10] GitLab — Unit test reports**  
用于 JUnit 展示与 job 退出状态必须分离的规则。  
`https://docs.gitlab.com/ci/testing/unit_test_reports/`

**[R11] Git — git-merge-base**  
用于基线提交选择的语义参考。  
`https://git-scm.com/docs/git-merge-base`

**[R12] Docker — Specify a project name**  
用于 Compose 项目资源分组与命名。  
`https://docs.docker.com/compose/how-tos/project-name/`

**[R13] Docker — Control startup and shutdown order**  
用于依赖与健康检查；启动不等于 readiness。  
`https://docs.docker.com/compose/how-tos/startup-order/`

**[R14] Docker — Networking on Docker Desktop**  
用于容器、宿主与特殊主机名的网络边界。  
`https://docs.docker.com/desktop/features/networking/`

**[R15] OpenAI — Hooks**  
用于 Codex 事件、返回格式与 Stop 续行语义。  
`https://learn.chatgpt.com/docs/hooks`

**[R16] Anthropic — Hooks reference**  
用于 Claude Code 事件、Stop 和循环保护。  
`https://code.claude.com/docs/en/hooks`

**[R17] OpenAI — Non-interactive mode**  
用于可选的脚本接入，不作为首版强制依赖。  
`https://learn.chatgpt.com/docs/non-interactive-mode`

**[R18] Node.js — Releases**  
用于运行时生命周期核对；实际最低版本由发布矩阵确定。  
`https://nodejs.org/en/about/previous-releases`

**[R19] Ajv — JSON Schema**  
用于 JSON Schema 方言与校验能力边界。  
`https://ajv.js.org/json-schema.html`

**[R20] Microsoft TypeScript — Using the Compiler API**  
用于有限静态依赖分析的实现参考。  
`https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API`

**[R21] GitHub — Secure use reference**  
用于后续 CI 适配中的不可信输入与权限设计。  
`https://docs.github.com/en/actions/reference/security/secure-use`

---

**文档结束 · StackGate v0.1 设计评审稿**
