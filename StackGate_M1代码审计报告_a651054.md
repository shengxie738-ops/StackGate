# StackGate M1 代码审计报告

**审计对象：** `https://github.com/shengxie738-ops/StackGate.git`  
**固定审计提交：** `a651054b987a160f54bf43e7e1e9bc8dec84b625`  
**审计范围：** M0 + M1（SG-001—SG-028）实现、架构边界、测试记录、M2 前置接口  
**审计性质：** 代码与仓库结构审计；不等同于完整跨平台重跑  
**基准设计：** `StackGate_功能与架构设计_v0.1.md`  
**基准计划：** `StackGate_Codex可执行开发任务规划_v0.1.md`

---

## 1. 审计结论

当前仓库已经形成了真正可继续开发的 StackGate M1 基础，并非只有目录和占位代码。

现有 M1 已经覆盖：

- CLI 基础入口
- 项目配置解析
- Git 基线与输入清单
- Task revision 与本地确认
- 本地 trust 预览与确认
- OpenAPI 加载与 oasdiff 接入
- 三方契约比较
- TypeScript 有限静态影响分析
- 显式消费者映射
- 必检选择与未知影响保守处理
- 受保护输入漂移检测
- Gate 核心纯函数
- JSON Schema / 类型生成 / 边界检查
- M0/M1 阶段验证脚本
- 实施任务账本与证据记录

仓库记录显示，M1 在作者的 Windows x64 环境中执行过完整阶段验证，并记录：

- Vitest 单测：434 / 434
- Node 开发工具反例：25 / 25
- 真实工具合同测试：36 / 36
- 集成测试：64 / 64
- 总计：559 项通过，0 失败，0 跳过

但该结果是仓库已有证据，不代表本次审计在当前环境重新执行了全部 559 项测试。

当前建议不是重构 M1，而是：

1. 修复 4 个 M1 收口问题；
2. 重新执行 M1 完整阶段验证；
3. 冻结 M2 使用的接口；
4. 进入 SG-029—SG-050。

---

# 2. 已确认的 4 个 M1 收口问题

## A-01：默认 oasdiff 工具身份绑定开发机绝对路径

### 位置

`tools/oasdiff/installation.json`

当前记录类似：

```json
{
  "name": "oasdiff",
  "version": "1.32.1",
  "platform": "win32-x64",
  "executable": "G:\\StackGate\\tools\\bin\\oasdiff-1.32.1\\oasdiff.exe"
}
```

`ScanService` 默认直接读取该 installation 信息创建 `OasdiffAdapter`。

### 问题

当前工具身份把：

- 工具版本
- 工具哈希
- 平台
- 本地绝对路径

绑定为一份仓库内记录。

这意味着仓库被复制到：

- 其他磁盘
- 其他 Windows 用户目录
- WSL
- Linux CI
- 其他开发者机器

时，即使存在完全相同版本和哈希的 oasdiff，默认扫描仍可能因为路径失效而 BLOCKED。

### 风险级别

**P1 / 高优先级可用性问题。**

目前没有证据表明它会把失败错误判定为 PASS；主要风险是：

- 正常能力不可用
- 测试/开发结果只能在单机复现
- M2/M4 无法形成可靠安装体验

### 正确修复方向

仓库只保存：

```text
tool name
tested version
supported platform identity
expected binary digest
capabilities
```

实际 executable 路径应由：

- 本地工具注册
- 安装器
- 用户本地状态
- CI 固定路径

在运行时解析。

禁止从候选仓库任意 PATH 自动信任一个同名程序。

---

## A-02：workspace regression 能力已经存在于领域层，但没有完整接入 ScanService

### 已有实现

`selectChecks()` 支持：

```ts
workspace_regression?: Readonly<Record<string, readonly string[]>>
```

当影响分析存在 unresolved gap 时，可按 workspace 加载保守回归检查。

### 当前调用

ScanService 当前构造 SelectionPolicy 时主要传入：

```ts
{
  required_set: profile.required_checks,
  optional_failure_policy: 'incomplete'
}
```

没有把真正经过确认的 workspace regression 配置接入。

### 结果

设计文档要求：

> 无法确定影响范围时，运行已配置的工作区回归集；没有回归集则 INCOMPLETE。

当前底层具备这个算法，但默认实际扫描流程没有形成完整入口。

### 风险

不是错误放行漏洞，因为当前 unresolved 会保留 coverage gap。

但会导致：

- 用户配置了回归集却没有被调度
- 扫描长期停留 INCOMPLETE
- M2 计划无法得到真正保守但可执行的检查集合

### 修复方向

必须明确 workspace regression 的权威来源，例如：

```yaml
profiles:
  integration:
    workspace_regression:
      web: ["typecheck", "unit"]
      api: ["api_unit"]
```

或放在对应 workspace/check policy 下。

它必须：

- 通过 schema 校验
- 被 task confirmation / policy hash 覆盖
- 只能增加检查，不能删除 required checks
- ScanService 和 PlanService 复用相同选择逻辑

---

## A-03：TrustService 将完整 workspace 放入 include_ignored，授权输入可能过宽

### 当前行为

TrustService 在建立执行授权快照时把：

```ts
Object.values(config.workspaces).map(w => w.path)
```

放入 `captureInputs(... include_ignored ...)`。

### 问题

如果 workspace 是：

```text
apps/web
```

则被 Git 忽略的：

```text
apps/web/node_modules
apps/web/dist
apps/web/.cache
```

可能进入枚举范围。

如果 Python workspace：

```text
apps/api
```

则：

```text
.venv
__pycache__
.pytest_cache
```

也可能成为快照候选。

这会造成：

- 输入快照非常大
- 授权摘要不稳定
- 安装依赖后授权失效
- 扫描时间恶化
- 可能读取没有必要的第三方缓存内容

### 安全判断

这里不能直接粗暴地“忽略所有 gitignored 内容”。

某些被忽略但确实影响执行的文件必须被显式纳入，比如：

- 自定义生成配置
- 测试 fixture
- 未提交但明确使用的脚本
- 用户声明的 build input

### 修复策略

授权快照只纳入：

1. Git tracked 输入；
2. 未跟踪、但属于声明输入范围的源码；
3. 当前命令明确引用的脚本；
4. package lock / requirements / pyproject 等依赖身份；
5. 受保护配置；
6. 用户显式声明的 ignored required input。

以下默认排除：

```text
node_modules
.venv
venv
dist
build
coverage
.pytest_cache
__pycache__
.next
.vite
.cache
```

被排除的目录如果被命令直接引用，则必须出现：

```text
REQUIRED_INPUT_UNVERIFIED
```

而不是静默忽略。

---

## A-04：CLI `--json` 错误合同没有完全统一

### 当前情况

正常命令输出：

```json
{
  "schema_version": "0.1",
  "data": {},
  "runtime": "NOT_EXECUTED"
}
```

ServiceError 分支在 `--json` 时也会向 stdout 输出 JSON。

但：

- unknown command
- unexpected exception
- 部分 CLI argument 分支

仍主要写 stderr 文本并返回退出码。

### 为什么 M2 前必须修

StackGate 以后会被：

- Codex Skill
- Claude Code Skill
- CI
- 自动脚本

调用。

Agent 不应该通过匹配：

```text
Unable to inspect project safely.
```

来推断错误。

### 要求

只要指定 `--json`，CLI 的 stdout 必须始终为一个完整 JSON document。

推荐统一结构：

```json
{
  "schema_version": "0.1",
  "ok": false,
  "operation": "scan",
  "runtime": "NOT_EXECUTED",
  "exit_code": 64,
  "diagnostics": [
    {
      "code": "CONFIG_INVALID",
      "message": "..."
    }
  ]
}
```

stderr 可以保留人类可读诊断，但不能成为机器调用唯一数据源。

---

# 3. 架构审计

## 3.1 当前分层方向正确

现有结构与原设计一致：

```text
apps/cli
packages/contracts
packages/core
packages/adapter-git
packages/adapter-oasdiff
packages/adapter-typescript
tests
schemas
presets
```

建议继续保持：

```text
CLI
  ↓
Application Services
  ↓
Domain
  ↓
Ports
  ↓
Adapters / Storage
```

M2 不应直接让 CLI 调用 `child_process` 实现业务 Run。

---

## 3.2 Gate 核心应继续保持纯函数

当前 `evaluateGate()` 接受事实并做确定性判定。

这个边界是正确的。

M2 必须保证：

```text
Runner
  产生事实
EvidenceStore
  保存事实
Collector
  解析事实
RunService
  组织事实
GateService
  验证事实身份
evaluateGate
  只根据可信事实计算
```

禁止：

```text
CLI -> "看日志像成功" -> PASS
```

禁止：

```text
Adapter -> decision = ALLOW
```

---

## 3.3 EvidencePort 与 RunnerPort 已经为 M2 做好接口准备

现有 RunnerPort 具备：

```ts
run(
  command: ResolvedCommand,
  context: {
    run_id
    check_id
    attempt_id
    signal
    stdout()
    stderr()
  }
): Promise<RunnerResult>
```

EvidenceStore 已有：

```ts
append()
store()
seal()
read()
```

因此 M2 不应另外创建：

```text
NewRunner
RunExecutorV2
EvidenceManager2
```

应该实现现有 port。

---

# 4. M2 前接口冻结建议

建议 M1 修复后冻结以下接口：

```text
RunnerPort
EvidenceStore
Adapter.execute
Adapter.collect
CheckPlan
CheckStep
CheckResult
RunEvent
RunManifest
GateInput
GateEvaluation
```

如果必须修改 schema：

1. 先改 JSON Schema；
2. 重新 generate types；
3. 更新 contract test；
4. 更新 fixtures；
5. 更新 adapters；
6. 最后更新 service。

禁止直接编辑 generated TypeScript。

---

# 5. M1 当前已实现能力与后续边界

| 能力 | M1 状态 | 下一阶段 |
|---|---|---|
| Git 输入身份 | 已实现 | M2 Run 前后复核 |
| Task revision | 已实现 | M2 绑定 plan/run |
| Local trust | 已实现 | M2 绑定 ResolvedCommand |
| OpenAPI 静态比较 | 已实现 | M2 candidate export |
| Consumer impact | 已实现有限版 | M2 连接 check selection |
| Acceptance drift | 已实现 | M2 GateService 使用 |
| Gate pure logic | 已实现 | M2 输入真实 evidence |
| Runner Port | 已定义 | M2 实现 |
| Evidence Port | 已定义 | M2 实现 |
| PlanService | 未完整形成 | M2 SG-034 |
| RunService | 未实现 | M2 SG-039 |
| GateService | 未实现 | M2 SG-040 |
| Report/Handoff | 未实现 | M2 SG-041—043 |
| Environment manager | 未实现 | M3 |
| Playwright real chain | 未实现 | M3 |

---

# 6. 当前不能声称已经完成的能力

以下在 M1 后必须仍然明确为未验证：

- FastAPI 真实启动
- React/Vite 真实启动
- candidate OpenAPI runtime export
- HTTP runtime probe
- Playwright browser acceptance
- Compose environment provenance
- current-code backend provenance
- full T01—T27 acceptance
- Linux / WSL2 完整矩阵
- npm 包安装体验
- Codex Skill 产品化入口
- Claude Code 插件
- GitLab merge gate

不得因为 M1 测试很多而把以上写成“已经完成”。

---

# 7. M1 修复后的重新验收要求

修复完成后至少执行：

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm verify:schemas
pnpm verify:boundaries
pnpm verify:tasks
pnpm verify:stage -- --stage M1
node dist/cli.mjs --help
```

必须记录：

```text
command
started_at
finished_at
exit_code
stdout/stderr evidence
task id
commit/worktree identity
```

如果其中任何一个没有实际运行：

```text
UNVERIFIED
```

而不是：

```text
PASS
```

---

# 8. 审计最终结论

StackGate 当前 M1 方向正确，已有足够基础进入 M2。

下一步不建议：

- 重构全部 core
- 更换语言
- 拆微服务
- 加数据库
- 加 React 管理后台
- 提前做 Hooks/MCP
- 开始多 Agent 自动修复
- 为追求“完整”重新实现 Git / OpenAPI / 测试框架

下一步正确路径：

```text
M1 audit fixes
        ↓
M1 full verification
        ↓
Freeze execution contracts
        ↓
SG-029 Evidence Store
        ↓
SG-032/033 Runner
        ↓
SG-034/035 DAG
        ↓
SG-036—038 collectors
        ↓
SG-039 RunService
        ↓
SG-040 GateService
        ↓
SG-041—044 reports + CLI
        ↓
SG-045—050 reliability + M2 exit
```

**审计结束。**
