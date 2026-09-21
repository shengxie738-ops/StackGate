# StackGate M1 收口修复与 M2 可执行开发任务规划 v0.2

> **执行对象：Codex**
>
> 本计划基于固定审计提交 `a651054b987a160f54bf43e7e1e9bc8dec84b625`。
> 如果开始执行时 HEAD 已变化，先比较当前代码与本计划涉及路径，复用已经完成的修复，不得为了符合旧审计而回滚新实现。

**目标：** 修复 M1 审计发现，重新建立可靠 M1 基线，然后完成 StackGate M2“执行 + 证据 + Gate + 报告”闭环。

**架构：** 保持现有模块化单体。执行器实现现有 `RunnerPort`，持久化实现现有 `EvidenceStore`；PlanService、RunService、GateService 只组织领域事实，不在 CLI/Reporter 中重新计算结论。

**技术栈：** TypeScript、Node.js 24、pnpm、Vitest、Ajv、esbuild、JSON Schema、现有 Git/oasdiff adapters。

**Spec：**

- `StackGate_功能与架构设计_v0.1.md`
- `StackGate_Codex可执行开发任务规划_v0.1.md`
- 本计划

---

# 0. 执行总规则

## 0.1 开始前必须读取

```text
AGENTS.md
docs/implementation/PROGRESS.md
docs/implementation/tasks.json 或仓库当前 task ledger
StackGate_功能与架构设计_v0.1.md
StackGate_Codex可执行开发任务规划_v0.1.md
本文件
```

然后执行：

```bash
git status --short
git rev-parse HEAD
git diff --stat
git diff
```

不要覆盖用户未提交修改。

---

## 0.2 测试纪律

每个任务：

```text
1. 写失败测试 / 反例
2. 实际运行，确认失败原因正确
3. 实现最小代码
4. 运行目标测试
5. 运行受影响回归测试
6. 保存命令证据
7. 更新进度账本
```

禁止：

- 固定返回 PASS
- 删除失败测试
- 降低 min_tests
- 把 required check 改 optional
- 修改目标契约来迎合实现
- 伪造 command exit code
- 将未执行写为 PASS
- 用 mock 代替本任务要求的真实子进程测试

---

# 1. 阶段结构

| 阶段 | 任务 | 目标 |
|---|---|---|
| M1-R | M1-R00—R07 | 审计修复与重新验收 |
| M2-A | SG-029—033 | Evidence + Runner |
| M2-B | SG-034—038 | Plan DAG + collectors |
| M2-C | SG-039—044 | Run + Gate + report + CLI |
| M2-D | SG-045—050 | 清理、可靠性、阶段出口 |

---

# 2. M1-R00：重新建立当前基线

## 目标

证明 Codex 开始修改前，当前仓库真实处于什么状态。

## 步骤

- [ ] 读取当前 Git 状态与 HEAD。
- [ ] 如果 HEAD != 审计 SHA，记录差异。
- [ ] 运行：

```bash
pnpm install --frozen-lockfile
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
```

- [ ] 每个未能运行的命令记录 `UNVERIFIED`，不得猜测。
- [ ] 创建：

```text
docs/implementation/audit-m1-r00.md
```

至少记录：

```text
HEAD
platform
node version
pnpm version
all command exits
test totals
known environment blockers
```

## 完成门槛

M1 原有失败与审计新增失败必须被区分。

---

# 3. M1-R01：去除 oasdiff 开发机绝对路径绑定

## 功能目标

StackGate 可以在新的仓库路径中找到经过验证的 oasdiff，而不是依赖：

```text
G:\StackGate\...
```

## 建议文件

```text
packages/core/src/services/tool-registry-service.ts
packages/adapter-oasdiff/src/resolve-tool.ts
tools/oasdiff/capabilities.json
tests/unit/tool-registry.test.ts
tests/integration/oasdiff-relocation.test.ts
```

修改：

```text
packages/core/src/services/scan-service.ts
packages/core/src/services/trust-service.ts
```

## 设计

仓库可以保留：

```ts
interface TestedToolCapability {
  name: 'oasdiff'
  version: string
  platform: string
  expected_sha256: string
}
```

但 runtime 路径必须单独解析：

```ts
interface ResolvedTrustedTool {
  executable: string
  version: string
  digest: string
  platform: string
}
```

## 反例测试

- [ ] repo 在 `G:\StackGate` 时通过，复制到临时目录后旧实现失败。
- [ ] 正确版本 + 正确 digest 在新目录可用。
- [ ] 同版本但 digest 不一致 BLOCKED。
- [ ] PATH 中存在同名恶意程序不能自动信任。
- [ ] Windows 空格路径可运行。
- [ ] 中文目录可运行。
- [ ] Linux 未安装时返回能力缺失，不崩溃。
- [ ] Windows lock 不应被 Linux 误认为 VERIFIED。

## 验证

```bash
pnpm exec vitest run tests/unit/tool-registry.test.ts
pnpm exec vitest run tests/integration/oasdiff-relocation.test.ts
pnpm test:contract
pnpm build
```

---

# 4. M1-R02：接通 workspace regression 配置

## 功能目标

unknown impact 时真正按照已确认策略增加 workspace 回归检查。

## Schema 设计建议

在 profile 中加入：

```yaml
workspace_regression:
  web:
    - typecheck
    - unit
  api:
    - api_unit
```

如果当前 schema 采用其他 policy extension 方式，则遵循既有 extension pattern，但必须：

- 严格校验 workspace ID
- 严格校验 check ID
- 禁止重复 ID
- policy hash 覆盖该字段
- task confirmation 漂移能够识别

## 修改链

```text
schemas
→ generated contracts
→ config validation
→ task confirmation
→ ScanService
→ selectChecks
→ PlanService later
```

## 必测场景

- [ ] unresolved web impact + web regression → 检查被选中。
- [ ] unresolved api impact + api regression → api 回归被选中。
- [ ] unresolved impact + 无 regression → INCOMPLETE。
- [ ] regression 配置引用不存在 check → CONFIG_INVALID。
- [ ] regression 不能删除 profile.required_checks。
- [ ] 多 workspace unknown 不得只选择其中一个。
- [ ] task explicitly required test/check 始终保留。

## 验证

```bash
pnpm generate:types
pnpm verify:schemas
pnpm exec vitest run tests/unit/select-checks.test.ts
pnpm exec vitest run tests/integration/scan-workspace-regression.test.ts
pnpm build
```

---

# 5. M1-R03：收紧 TrustService ignored 输入

## 功能目标

执行授权摘要覆盖真正影响命令的输入，但不递归吸收 node_modules / .venv / dist 等可重建缓存。

## 新增建议

```ts
interface ExecutionInputScope {
  workspace_sources: string[]
  command_inputs: string[]
  dependency_identity_files: string[]
  explicitly_required_ignored_inputs: string[]
  excluded_generated_paths: string[]
}
```

默认排除建议：

```text
node_modules
.venv
venv
dist
build
coverage
.next
.vite
.cache
.pytest_cache
__pycache__
```

## 必须避免

不要仅用目录名字判定全部情况。

如果命令：

```yaml
args: ["dist/custom-runner.js"]
```

那么 dist 中该文件是命令输入，不能直接忽略。

## 测试

- [ ] node_modules 变化不改变 trust digest。
- [ ] tracked source 变化改变 digest。
- [ ] untracked source 变化改变 digest。
- [ ] package-lock / pnpm-lock 变化改变 digest。
- [ ] command directly referenced ignored script 必须进入输入或返回 UNKNOWN。
- [ ] `.env` 不进入普通证据。
- [ ] `.venv` 大目录不被递归。
- [ ] symlink escape 仍被拒绝。

---

# 6. M1-R04：统一 CLI JSON Error Contract

## 目标

`--json` 模式无论成功或失败，stdout 都只输出一个 JSON document。

## 新增

```text
apps/cli/src/output.ts
```

建议：

```ts
export interface CliEnvelope<T = unknown> {
  schema_version: '0.1'
  ok: boolean
  operation: string
  runtime: string
  exit_code: number
  data?: T
  diagnostics: Diagnostic[]
}
```

## 规则

JSON 模式：

```text
stdout = JSON only
stderr = optional human progress
```

Text 模式：

```text
stdout/stderr = human readable
```

## 测试

- [ ] unknown command + --json
- [ ] malformed args + --json
- [ ] config invalid + --json
- [ ] ServiceError + --json
- [ ] unexpected exception + --json
- [ ] success + --json
- [ ] exactly one JSON document
- [ ] stdout 无 ANSI
- [ ] exit code 与 envelope.exit_code 一致

---

# 7. M1-R05：M1 新工作流集成测试

创建：

```text
tests/integration/stages/m1-audit-regressions.test.ts
```

必须覆盖四项修复串联：

```text
new temp repo location
→ tool resolve
→ task confirm
→ trust review
→ scan
→ unknown consumer
→ workspace regression selected
→ --json output parseable
```

并证明：

```text
runtime = NOT_EXECUTED
```

即 M1 修复不能意外执行项目脚本。

---

# 8. M1-R06：接口冻结

新增 ADR：

```text
docs/adr/ADR-011-m2-execution-contracts.md
```

冻结：

```text
RunnerPort
EvidenceStore
CheckPlan
CheckStep
CheckResult
RunEvent
RunManifest
Adapter
```

ADR 写清：

- schema first
- generated type 不手改
- reporter read-only
- Gate pure core
- runner does not calculate verdict
- evidence seal immutable
- run re-evaluation does not mutate historical facts

---

# 9. M1-R07：重新完成 M1 阶段验收

必须重新执行完整 M1。

不要只运行新增测试。

```bash
pnpm verify:stage -- --stage M1
```

并：

```bash
node dist/cli.mjs --help
node dist/cli.mjs unknown --json
```

更新：

```text
docs/implementation/PROGRESS.md
docs/implementation/tasks.json
docs/implementation/evidence/
```

M1-R 不修改原 SG-011—028 历史 DONE。

单独增加审计修复 ledger，例如：

```text
docs/implementation/audit-fixes.json
```

---

# 10. SG-029：Run 目录、原子存储与幂等事件日志

## 目标

实现现有 `EvidenceStore`。

## 目录

```text
<state_dir>/runs/<run_id>/
  manifest.json
  events.jsonl
  documents/
  artifacts/
  seal.json
```

## 实现文件

```text
packages/core/src/storage/file-evidence-store.ts
packages/core/src/storage/event-log.ts
packages/core/src/storage/run-layout.ts
```

## append(event)

要求：

- event schema 有效
- run_id 与 scope 一致
- seq 单调
- event_id 幂等
- 同 event_id 不同 payload → ERROR
- append 前后不允许半行 JSON
- crash 后已完成记录仍可读取

## store()

要求：

- 禁止 path traversal
- 每个 artifact 有 digest
- artifact_id 稳定唯一
- 文件写入后重新 hash
- document 也走 schema validation

## 测试

- duplicate same event
- duplicate conflicting event
- sequence gap
- sequence rollback
- parallel append
- truncated jsonl
- artifact traversal
- symlink
- overwrite existing evidence

---

# 11. SG-030：日志脱敏与证据预算

创建：

```text
packages/core/src/evidence/redaction.ts
packages/core/src/evidence/budget.ts
```

至少脱敏：

```text
Authorization:
Cookie:
Set-Cookie:
Bearer tokens
basic auth URLs
known secret env values supplied to runner
```

不要声称能完整识别所有秘密。

预算必须分别记录：

```text
original_bytes
retained_bytes
truncated
reason
```

如果关键报告因为预算丢失：

```text
INCOMPLETE / ERROR
```

不能 PASS。

---

# 12. SG-031：Evidence Seal

## 目标

完成后的 run 证据不可原地改写。

seal 输入：

```ts
{
  run_id
  input_hash
  required_artifact_ids
}
```

seal 输出：

```text
manifest_hash
artifact digests
event log digest
sealed_at
```

完成后：

```text
append -> rejected
store -> rejected
```

除非是明确的新 evaluation/export 目录，不修改 run facts。

---

# 13. SG-032：跨平台命令解析

实现：

```text
packages/runner-local/src/command-resolver.ts
```

或者遵循当前包布局放到 adapter/process。

ResolvedCommand 必须来自：

```text
confirmed config
+
confirmed trust record
+
current tool identity
```

禁止：

```ts
spawn(userText)
```

禁止：

```ts
shell: true
```

除非未来某个明确 adapter 被单独授权，本阶段不要加入。

### Windows

专门测试：

```text
C:\Program Files\...
中文目录
.cmd
.exe
CRLF
```

`.cmd` 如需要 cmd.exe，应作为显式受信命令类型处理，不偷偷启用 shell。

---

# 14. SG-033：真实子进程 Runner

实现现有 `RunnerPort`。

## 功能

- spawn
- stdout/stderr streaming
- timeout
- AbortSignal cancel
- output budget
- process identity
- owned process cleanup
- raw exit code
- signal

## 环境变量

默认不是：

```ts
env: process.env
```

而是最小环境。

只传：

- OS 必须变量
- confirmed allowlist
- StackGate run variables

例如：

```text
STACKGATE_RUN_ID
STACKGATE_OUTPUT_DIR
```

## 必测

- exit 0
- exit 1
- spawn error
- timeout
- cancellation
- huge stdout
- huge stderr
- process writes after cancel
- child process inheritance scenario
- executable changed after trust

---

# 15. SG-034：固定输入 CheckPlan DAG

实现：

```text
packages/core/src/services/plan-service.ts
packages/core/src/domain/plan-dag.ts
```

Plan 必须绑定：

```text
task_id/revision
profile
input_hash
policy_hash
target_contract_hashes
toolchain_hash
environment_requirements_hash
required_check_ids
steps
plan_hash
```

## DAG 验证

- no cycles
- all dependencies exist
- unique step_id
- unique check identity semantics
- required checks represented
- resource locks normalized
- deterministic canonical ordering

---

# 16. SG-035：DAG Scheduler

实现：

```text
packages/core/src/execution/scheduler.ts
```

要求：

- 默认低并发
- dependency blocked propagation
- resource lock
- cancellation stops new steps
- independent steps may run concurrently
- deterministic event ordering rules
- required step failure 不自动取消所有 independent evidence，除非策略明确 fail-fast

测试：

```text
A -> B
A -> C
B/C -> D
```

以及 shared resource lock。

---

# 17. SG-036：exit-code adapter

实现真正 adapter：

```text
packages/adapter-command/
```

逻辑：

```text
exit 0 => PASS
nonzero => FAIL
runner error => ERROR
timeout/cancel => BLOCKED/ERROR 按合同
```

但必须生成 evidence ref。

没有 evidence：

```text
不能完整 PASS
```

---

# 18. SG-037：JUnit Collector

解析真实 JUnit XML。

需要防御：

- XXE
- oversized report
- missing file
- malformed XML
- duplicate testcase ID
- zero tests
- all skipped
- failure
- error
- configured min_tests
- required test ID missing

不要从命令退出 0 推断测试数量。

最终 `CheckResult`：

```text
discovered_tests
executed_tests
skipped_tests
flaky_tests
executed_test_ids
```

---

# 19. SG-038：Probe Collector

M2 只完成协议和 collector，不实现 M3 网络环境管理。

Probe report 必须绑定：

```text
run_id
check_id
attempt_id
operation
request observation
response observation
assertions
```

如果 provenance 不足：

```text
BLOCKED / INCOMPLETE
```

不能通过。

---

# 20. SG-039：RunService

这是 M2 核心。

实现：

```text
packages/core/src/services/run-service.ts
```

生命周期：

```text
CREATED
→ PLANNED
→ RUNNING
→ FINALIZING
→ COMPLETED
```

异常：

```text
CANCELED
ABORTED
```

### 开始前

重新验证：

```text
plan hash
input hash
task confirmation
trust
tool identity
```

### 执行中

记录：

```text
run.started
check.started
artifact.saved
check.finished
```

### Finalize

- collect
- seal evidence
- calculate run verdict facts
- post-run input snapshot/freshness
- final event

禁止在历史事件失败后删除它。

---

# 21. SG-040：GateService

实现：

```text
packages/core/src/services/gate-service.ts
```

它的职责不是重写 evaluateGate。

它负责把真实数据认证为 GateInput：

```text
configuration_valid
checks
required_check_ids
report_integrity
freshness
inputs_complete
task_confirmed
policy_confirmed
environment_satisfied
acceptance_inputs_approved
deterministic_denials
fatal_error
canceled
```

然后调用：

```ts
evaluateGate()
```

## Gate 必须检测

- sealed evidence corrupted
- current input != run input
- task revision changed
- policy changed
- required test missing
- stale tool identity
- acceptance drift
- environment provenance insufficient

---

# 22. SG-041：JSON + Terminal Report

新增：

```text
packages/reporters/src/json.ts
packages/reporters/src/terminal.ts
```

Reporter 只能读取。

第一屏：

```text
Decision
Verdict
Freshness
Task
Run
Required checks
Failures
Incomplete items
Next reproducible action
```

禁止 reporter 运行新测试。

---

# 23. SG-042：Markdown Report

生成：

```text
report.md
```

结构：

```text
Summary
Scope
Code identity
Task identity
Gate decision
Required checks
Failures
Incomplete coverage
Artifacts
Reproduction
Not verified
```

必须明确：

```text
Not verified != Passed
```

---

# 24. SG-043：Failure Handoff

实现：

```text
packages/core/src/services/handoff-service.ts
```

只根据 sealed run 生成。

包含：

```text
task
constraints
target contract identity
current code identity
failed facts
minimal related paths
reproduction
evidence refs
allowed change scope
do-not-change acceptance inputs
next verification
```

不包含：

```text
entire chat
tokens
credentials
hidden reasoning
all repository source
```

---

# 25. SG-044：公开 M2 CLI

增加：

```text
stackgate plan
stackgate run
stackgate report
stackgate handoff
stackgate gate
```

示例：

```bash
stackgate plan --task .stackgate/tasks/performance.json --profile integration --json
stackgate run --plan PLAN_ID --json
stackgate gate --run RUN_ID --json
stackgate report --run RUN_ID --format markdown
stackgate handoff --run RUN_ID --target codex
```

## 关键退出码

```text
0 ALLOW
1 FAIL / deterministic deny
2 INCOMPLETE
3 internal/tool/evidence error
4 STALE
64 CLI/config
```

`report` 返回 0 只代表报告读取成功。

必须测试：

```text
report exit 0 + run verdict FAIL
```

CI 不能因此误绿。

---

# 26. SG-045：安全清理

M2 只清理自身：

```text
temp files
owned process artifacts
unfinished run temp writes
```

M3 才加入 Docker resources。

规则：

```text
unable to prove ownership => do not delete
```

提供：

```bash
stackgate clean --dry-run
stackgate clean --apply
```

如果本阶段 CLI clean 仍不是原任务范围，则仅实现内部 service 并保持 CLI 后置；遵循原 SG-045 卡片。

---

# 27. SG-046：静态缓存

只缓存纯解析：

```text
OpenAPI parse
TS static graph
canonical config parse
```

缓存 key：

```text
input digest
adapter version
schema version
```

禁止缓存：

```text
integration PASS
run gate ALLOW
environment provenance
```

---

# 28. SG-047：工具版本 / provenance 汇总

每个 run manifest 记录：

```json
{
  "node": "...",
  "stackgate": "...",
  "oasdiff": "...",
  "typescript": "..."
}
```

不能写：

```text
latest
unknown-but-assumed
```

UNKNOWN 必须显式存在并影响严格 Gate。

---

# 29. SG-048：异常矩阵

创建集成测试矩阵。

至少包含：

1. command 0
2. command nonzero
3. spawn failure
4. timeout
5. cancel
6. output overflow
7. missing junit
8. malformed junit
9. zero junit
10. skipped required
11. evidence corrupt
12. seal missing
13. duplicate event
14. stale input
15. task revision changed
16. policy changed
17. tool binary changed
18. missing environment provenance
19. user canceled
20. report reads failed run

每种都断言：

```text
check status
verdict
freshness
decision
exit code
reason
```

---

# 30. SG-049：崩溃和并发

必须实际测试：

- concurrent event append
- concurrent artifact store
- two run IDs same repository
- same resource lock
- interrupted temp write
- kill runner
- finalize called twice
- seal called twice
- corrupt manifest after seal

期望：

```text
no silent PASS
no evidence overwrite
no unrelated delete
```

---

# 31. SG-050：M2 阶段出口

## 新增 stage

更新：

```text
scripts/verify-stage.mjs
tests/fixtures/stages/M2.json
```

M2 stage 至少包含：

```text
source
tasks
schemas
boundaries
build
typecheck
unit
lint
contract
integration
m2-runner
m2-evidence
m2-gate
```

具体注册名称遵循现有 registry 设计。

## 最终真实验收

建立最小本地 fixture，不要求 FastAPI/React。

Fixture 要能：

```text
plan
→ execute real local commands
→ produce real junit
→ save evidence
→ gate
```

### PASS fixture

```text
command PASS
JUnit >= 1
all required IDs executed
evidence sealed
inputs fresh
```

→ 可以产生 M2 范围内 PASS/ALLOW（若 M3 环境不是该 profile 的必需前提）。

### ZERO TEST fixture

command exit 0，JUnit 0 tests。

→ INCOMPLETE / DENY。

### Missing report

command exit 0，无 JUnit。

→ INCOMPLETE / ERROR，不能 ALLOW。

### Stale

Run 完成后修改受保护输入。

→ freshness STALE，gate exit 4。

### Cancel

运行期间 Abort。

→ INCOMPLETE，证据保留。

---

# 32. M2 完成后仍然不能宣称

M2 完成不等于 StackGate MVP 完成。

以下仍属于 M3+：

```text
FastAPI live service
React/Vite live frontend
Compose environment
backend provenance
HTTP probe real network
Playwright reporter
browser real-backend correlation
T01/T02/T10/T11/T17 等完整全栈案例
```

README 必须继续标注。

---

# 33. Codex 每轮续接模板

每次新会话：

```text
继续实现 StackGate。

先读取：
AGENTS.md
docs/implementation/PROGRESS.md
任务 ledger
本计划

然后检查：
git status
git diff
当前 HEAD

只继续当前第一个未完成且依赖满足的任务。
不要重新扫描全仓，不重做已经有真实验证的任务。

每个任务：
先复现 RED；
再最小实现；
运行指定测试；
运行受影响回归；
保存真实 exit/log；
更新进度。

未实际运行的内容必须写 UNVERIFIED。
不得修改测试/契约/策略来获得假 PASS。
```

---

# 34. 第一次交给 Codex 的完整提示词

```text
请严格执行：
docs/plans/2026-09-20-stackgate-m1-fixes-m2.md

设计依据：
StackGate_功能与架构设计_v0.1.md
StackGate_Codex可执行开发任务规划_v0.1.md

审计基准 SHA：
a651054b987a160f54bf43e7e1e9bc8dec84b625

首先执行 M1-R00。
如果当前 HEAD 已改变，先对比审计相关代码，复用已经完成的正确修复，不回滚用户或其他 Agent 的有效修改。

然后完成 M1-R01—M1-R07。
M1 修复通过完整 stage 后，再按依赖实现 SG-029—SG-050。

严格复用现有：
RunnerPort
EvidenceStore
Adapter
CheckPlan
RunManifest
Gate evaluate functions

不要创建第二套不兼容执行协议。

每项任务必须先建立失败用例/反例，再实现并实际运行验证。
不要把未运行、零测试、缺报告、损坏报告、过期输入、缺环境来源写成 PASS。

保存实际命令、退出码、证据文件和未验证项。
更新 PROGRESS 和 task ledger。

不得远程 push、公开发布、生产部署、读取用户 Agent 凭证、调用未经许可的付费模型。
```

---

# 35. 最终 M2 Definition of Done

只有以下全部满足，才允许将 M2 标记完成：

- [ ] M1 四个审计问题已修复。
- [ ] M1 stage 重新真实通过。
- [ ] Runner 使用真实子进程。
- [ ] Runner 不使用任意 shell 拼接。
- [ ] EvidenceStore 已实际持久化。
- [ ] event_id 幂等。
- [ ] 证据可以 seal。
- [ ] seal 后不能修改事实。
- [ ] DAG cycle 被拒绝。
- [ ] dependency BLOCKED 传播正确。
- [ ] resource lock 实际工作。
- [ ] command adapter 工作。
- [ ] JUnit 真实解析。
- [ ] 0 test 不 PASS。
- [ ] missing report 不 PASS。
- [ ] skipped required 不 PASS。
- [ ] flaky 不被压成普通 PASS。
- [ ] RunService 做运行前身份验证。
- [ ] RunService 做运行后 freshness 复核。
- [ ] GateService 重新验证 current state。
- [ ] evidence corrupted 被发现。
- [ ] stale 返回 exit 4。
- [ ] FAIL 返回 exit 1。
- [ ] INCOMPLETE 返回 exit 2。
- [ ] internal/evidence ERROR 返回 exit 3。
- [ ] config invalid 返回 64。
- [ ] JSON error contract 稳定。
- [ ] report 不会改变 run facts。
- [ ] handoff 不包含凭证。
- [ ] cancel 保留已有证据。
- [ ] 并发 append 不损坏 JSONL。
- [ ] temp write crash 不覆盖最后好文件。
- [ ] M2 integration fixture 使用真实 subprocess。
- [ ] 完整 `pnpm verify:stage -- --stage M2` 实际退出 0。
- [ ] M3 能力仍明确标记 NOT_EXECUTED / UNVERIFIED。

---

# 36. M2 完成后的下一阶段

M2 完成后才进入 M3：

```text
SG-051+
```

重点：

```text
FastAPI fixture
React fixture
environment provenance
runtime probe
Playwright
真实 API 调用
Mock 假绿场景
真实全栈 failure -> fix -> new run PASS
```

不要在本阶段提前做：

```text
Codex hooks
Claude hooks
MCP
Web dashboard
multi-agent orchestrator
cloud service
automatic code repair
GitHub marketplace
```

**文档结束。**
