# StackGate M3 补全与审计修复：Codex 可执行任务规划 v0.3

> **给执行 Agent：** 按任务依赖逐项实现；有 `superpowers:executing-plans` 时可用，未安装时按本文的测试、记录与续接规则直接执行，不以安装额外框架为开工前提。这里交付的是开发计划，不是已实现功能或测试通过证明。

**Goal：** 在保留当前 M1/M2 的基础上，完成同一份候选代码下的“真实 FastAPI + React + HTTP Probe + Playwright + 环境来源 + 失败修复重验”，并真实通过 M3 阶段出口。  
**Architecture：** 沿用现有模块化单体、RunnerPort、EvidenceStore、Adapter 与 EnvironmentPort；应用层统一注册能力，核心重新认证观察事实，Reporter 只读展示。不要另起一套执行器或把 M3 降成浏览器演示脚本。  
**Tech Stack：** 保留仓库锁定的 Node 24.11.1 / pnpm 11.2.2 / TypeScript 5.9.3 / Vitest 4.0.18 以及现有依赖；新增 React/Vite/Playwright/Python/Compose 组合时实测后锁定版本，不凭空指定“latest”。  
**Spec：** 仓库 `docs/specs/stackgate-v0.1.md` 与 `docs/plans/2026-09-18-stackgate-v0.1-execution.md`；本文件补充当前代码接入细节，不覆盖原稿。  
**固定审计 SHA：** `17ea7adf10bab9961b96cf3edca255b112bf146b`（main）。  
**配套审计：** `StackGate_Main_Audit_17ea7ad.md`。  
**建议保存位置：** `docs/plans/2026-09-21-stackgate-m3-completion.md`。


## 任务快速索引

[AUD-000](#aud-000) · [AUD-001](#aud-001) · [AUD-002](#aud-002) · [AUD-003](#aud-003) · [AUD-004](#aud-004)

[SG-052](#sg-052) · [SG-053](#sg-053) · [SG-054](#sg-054) · [SG-055](#sg-055) · [SG-056](#sg-056) · [SG-057](#sg-057) · [SG-058](#sg-058) · [SG-059](#sg-059) · [SG-060](#sg-060) · [SG-061](#sg-061) · [SG-062](#sg-062) · [SG-063](#sg-063) · [SG-064](#sg-064) · [SG-065](#sg-065) · [SG-066](#sg-066) · [SG-067](#sg-067) · [SG-068](#sg-068) · [SG-069](#sg-069) · [SG-070](#sg-070) · [SG-071](#sg-071) · [SG-072](#sg-072) · [SG-073](#sg-073) · [SG-074](#sg-074) · [SG-075](#sg-075) · [SG-076](#sg-076) · [SG-077](#sg-077)

## 0. 先纠正起点，禁止跳阶段

本计划基于的 main 只完成到 **SG-051**。SG-052、SG-054 是 READY，其他剩余 M3 任务尚未开始；M3 校验器未注册。不是“已完成 M3 后的 M4 计划”。

若 Codex 当前工作区有更多实现：先读取 Git 状态，比较下面列出的相关文件与审计 SHA；逐项验证并复用。不能为迁就旧报告删掉有效代码，不能自动合并远程分支，也不能把只存在于另一个分支的结果当作 main 已通过。

### 0.1 执行顺序和可见交付

| 批次 | 任务 | 退出条件 |
|---|---|---|
| B0：恢复可信起点 | AUD-000—003 | 基线记录、内容指纹、Gate 变更反例、M3 共享协议明确 |
| B1：样例与可采集事实 | SG-052—055 | React、真实 Reporter、受限 Probe、后端独立访问观察 |
| B2：环境与链路 | SG-056—061 | attach/Compose 来源、动态端口、readiness、真实链路和安全清理 |
| B3：产品 Run 集成 | SG-062—065 | 构建后的 CLI 跑出单测绿但全栈 FAIL；修复后新 Run PASS；旧 Run STALE |
| B4：反例与平台 | SG-066—072，AUD-004 | 漂移、旧服务、隐私、安全、Windows/WSL/Linux实际能力 |
| B5：M3 出口 | SG-073—077 | 验收注册、故障库、实测基准、平台矩阵、真实 M3 stage |
| 后续门槛 | 原 SG-078—095 | 只有 M3 出口成立后，才推进 M4 产品化 |

AUD-004 可在 AUD-003 后并行；Linux 执行环境须在真实 Run 之前完成相应能力，Windows 可以先做 B1—B3。审计新增任务单独记账，不修改原 100 项 ID 或依赖身份。

### 0.2 Global Constraints

1. **不覆盖原始需求文件。** 原执行计划 blob SHA 为 `94d07afbb597fa1bdb23b72dbf52f7aa092461f2`；保留 `pnpm verify:source` 的检查，不为迁就实现修改基准文件。
2. 当前台账路径是 **`docs/implementation/tasks.json`**，不是根目录 `tasks.json`。先读取 `AGENTS.md`、`PROGRESS.md`、当前卡片和相关代码，不要求每次重新全文扫描。
3. 保留 SG-001—100 的历史状态与证据。新增 `docs/implementation/audit-m3-fixes.json` 存放 AUD-000—004；历史 DONE 不覆盖为“新验证通过”，追加当前验证引用。
4. 默认 `NOT_STARTED → IN_PROGRESS → IMPLEMENTED_UNVERIFIED → DONE`；环境缺失可为 BLOCKED，并保存继续条件。新状态仅在审计台账使用；原台账遵守已有验证器允许的状态。
5. 产品不自动修改业务代码、不无限重试、不自动合并/部署。故障修复补丁只在测试工具创建的自有 fixture 中应用。
6. 不把任意 shell 文本、日志指令或浏览器响应作为待执行命令。业务脚本仍是不可信代码，本地授权不是 OS 沙箱。
7. 模块产物必须有真实命令、实际退出码、计数、版本、前后输入身份；没有运行不得标绿。不得删除必检、降低 min_tests、修改权威契约或替换真实环境为 mock 以过关。
8. 所有新持久化结构从 `schemas/0.1/` 起草，生成类型后适配调用；不手改 generated 文件。确需新增兼容版本时写迁移 ADR，旧 run 只读、不重封存。
9. 保留 `run/gate` 的退出码合同 0/1/2/3/4/64；`report/handoff` 的操作成功不能被当作业务验收通过。
10. 仓库和当前任务授权仅用于可逆本地开发及自有测试环境。公开发布、远程 push/PR、生产连接和付费模型调用不在本计划执行范围。

### 0.3 Review Focus：五个重点反例

| 条件 | 用户应得到的结果 | 所属任务 |
|---|---|---|
| 同路径、同 HEAD，但源码和未跟踪输入已改 | 开发证据 content hash 改变；不复用路径摘要代表验证结果 | AUD-001 |
| Gate 认证途中插入源码修改 | 返回 STALE/4 或无法确认的拒绝；不能使用认证开始时的 FRESH | AUD-002 |
| Playwright reporter 抛错、只跑部分用例、expected-fail | 完成标记/ID/断言不完整不能绿 | SG-053/063 |
| localhost 服务健康但来自旧分支，或中途换实例 | 环境或真实链路失败，不宣称当前候选通过 | SG-056/059/060/067 |
| 取消时有 detached 后代、无关进程、其他项目容器 | 只清理可证明自有资源；无法确认就保留且拒绝认证 | AUD-004/SG-061/070/071/072 |

## 1. 开始执行前的事实核对

```bash
git status --short
git rev-parse HEAD
git diff --stat
git diff --name-only 17ea7adf10bab9961b96cf3edca255b112bf146b -- packages apps scripts examples schemas tests docs/implementation
node --version
pnpm --version
```

若本地没有审计对象，记录 `AUDIT_BASE_UNAVAILABLE`；可以核对当前代码，但不偷偷 fetch、reset 或声称已完成相同差异比较。默认分支按 main 理解，用户的 mian 是本次请求中对 main 的拼写。

逐项阅读以下入口：

```text
AGENTS.md
docs/implementation/PROGRESS.md
docs/implementation/tasks.json
docs/implementation/audit-fixes.json
docs/implementation/BLOCKERS.md
docs/implementation/evidence/M2-summary.md
package.json
scripts/verify-stage.mjs
packages/core/src/ports/{adapter,evidence,runner,environment}.ts
```

### 1.1 基线验证规则

在符合锁定版本且已审查依赖安装脚本的环境执行 `pnpm install --frozen-lockfile`。安装是开发准备，不作为产品只读扫描的行为。不得擅自改 lock 或升级所有依赖解决环境问题。

```bash
pnpm verify:source
pnpm verify:tasks
pnpm verify:schemas
pnpm verify:boundaries
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm exec vitest run tests/integration/demo/api.test.ts
pnpm verify:stage -- --stage M2
```

上述是基线集合，不要求每个小改动重复全量执行。完成针对性 RED/GREEN 后运行受影响回归；批次和阶段出口再全量运行。阶段脚本自身包含重复的检查组，统计时不要叠加成更多独立测试。

Linux 当前无法运行 Windows-only Runner。环境不满足时保存实际阻塞，先执行纯逻辑/契约/构建工作，不把没有运行的全栈测试改为 skipped 后宣布 M3 完成。

## 2. 当前代码必须沿用的接入点

| 模块 | 当前真实位置 / 接口 | 下一步约束 |
|---|---|---|
| CLI 命令 | `apps/cli/src/commands/execution.ts` | 增量修改；不为对齐旧计划文件名拆成第二套实现 |
| Plan | `PlanService.create/load/inspectCurrent/inspectStored` | 任务、策略、输入和工具身份固定；运行时不能换 profile |
| Run | `RunService.execute(plan_id, options)` | 仍使用统一 scheduler/store/resolver；新增真实适配器而非另一条 demo 通道 |
| Gate | `GateService.inspect/evaluate`、`validateCheckPlanBinding` | 每类真实结果有对应 collector 复核，不信任报告中的 PASS |
| Runner | `RunnerPort.run(...): Promise<RunnerResult>` | 保留字节 stdout/stderr 回调和真实进程归属 |
| Evidence | `FileEvidenceStore` 实现现有 EvidenceStore | 先存证据，再封存；完成后只写外部 evaluations/exports |
| 环境 | `EnvironmentPort.prepare(request, context)` / `observe` / `cleanup` | 原计划写的 prepare(plan,context) 只是旧概念；以当前类型为准 |
| Probe | `packages/core/src/services/adapters/probe-adapter.ts` 的 `collectProbe` | 已有校验复用；认证来源后扩展，不能另起宽松 collector |
| FastAPI | `examples/contract-drift-demo/apps/api/app/main.py:create_app()` | middleware/launcher/Compose 调用同一应用 |
| 测试夹具 | `tests/support/local-run-project.ts`、`tests/support/reliability.ts` | 复用 M2 身份、确认、清理辅助；全栈 helper 新增但不要 import 到产品 |

### 2.1 新增协议先于实现

以下是**本次实施决定**，不是声称当前仓库已经有这些类型。具体字段在 AUD-003 对照现有 schema 后以兼容方式落地。

**共享 RuntimeAdapterRegistry。** 一个版本化注册表同时服务计划 capability、Run 执行与 Gate 重收集。只注册内置、经过审核的适配器，不从业务配置动态 import 任意插件。

```ts
import type { Adapter, AdapterId } from '../ports/adapter.js';

export interface RuntimeAdapterRegistry {
  get(id: AdapterId): Adapter | null;
  supportedIds(): readonly AdapterId[];
}
```

环境生命周期仍使用 EnvironmentPort，不强行把没有测试数量的环境操作伪装成 JUnit。若以 synthetic environment check 表达 DAG 依赖，其 result_kind 可沿用现有约定，但它不得冒充执行了业务断言；计划/结果一致性需要单独验证。

**环境前后事实与认证结果。** 不修改准备阶段的 environment artifact 为 CLEANED 后覆盖旧事实。先存准备快照，再存收尾观察与 cleanup 结果；最终 assessment 引用全部输入摘要。

```ts
export interface VerifiedEnvironmentAssessment {
  schema_version: '0.1';
  run_id: string;
  input_hash: string;
  phase: 'prepare' | 'finalize';
  provenance: 'DECLARED' | 'OBSERVED' | 'CONTROLLED';
  satisfied: boolean;
  evidence_refs: string[];
  reasons: string[];
}
```

此对象必须由核心认证函数返回。不能让外部脚本写入 `satisfied:true` 就被采信；schema 有效只是结构合法。运行时 `environment_ref` 指向最终认证证据，不覆盖先前观察。

**数据版本。** Run 创建前，从已确认 profile/环境/seed 配置取得 `data_revision`；不能先写 `local-input-...` 再更新不可变字段。attach 无可确认数据版本则拒绝需要该前提的 profile。纯本地 M2 profile 保持原逻辑。

**后端访问证据。** 至少绑定 run/check/attempt/request/instance、operation、时间、状态和响应字节摘要；原核心字段保留，新增字段只走 schema。response digest 的输入字节形式固定为“未压缩的 UTF-8 响应体字节”；测试模板禁用压缩，客户端不能用重新 JSON.stringify 的不同字节冒充同一响应。

**HTTP 业务断言。** Probe 输出的 `passed/schema_valid` 不能直接提升为可信事实。增加经 task/config 确认的声明式断言集合，只支持 JSON Pointer 的存在、类型、常量相等和有限数值比较；不 eval 用户代码。核心用已认证的 response_body 重算断言结果。浏览器断言由锁定模板/Reporter 记录，明确不是对同权限恶意代码的证明。

### 2.2 环境证据存储的具体落点（必须在 AUD-003 先落实）

当前 `EvidenceDocument` 已有 `kind: 'environment'`，但同一 root scope 下文档路径固定为 `documents/environment.json`。不能先存 READY 再用同一 kind 覆盖成 CLEANED；存储器会正确拒绝覆盖。

采用以下增量约定，单 run 仍只处理一个 profile 环境：

| 文档 | 路径 | 用途 |
|---|---|---|
| 现有 environment | `documents/environment.json` | 首次准备快照；不可覆盖 |
| 新 environment-finalization | `documents/environment-finalization.json` | 业务步骤后、清理前的最后来源观察 |
| 新 environment-cleanup | `documents/environment-cleanup.json` | cleaned/preserved/failed及归属依据 |
| 新 environment-assessment | `documents/environment-assessment.json` | 最终核心认证结果与引用；Gate仍重新计算，不照读satisfied |

创建 `schemas/0.1/{environment-finalization,environment-cleanup,environment-assessment,backend-observation,probe-declaration}.schema.json`；已有同等schema时复用，不再建同名协议。修改 `packages/core/src/ports/evidence.ts` 的文档联合、contracts schema 注册与生成导出，以及 `packages/core/src/storage/integrity-index.ts` 的引用一致性检查。Gate新增读取器要核对run_id、input_hash、作用域和引用摘要。

新增 `packages/core/src/services/environment-assessment.ts`，从已认证准备/收尾/清理和链路证据推导结果，不能接受CLI传来的布尔批准。prepare阶段需要临时assessment可在内存使用；持久化的最终assessment只写一次。多次readiness观察作为独立artifact保存，最终记录通过evidence_refs引用。

`RunManifest.environment_ref` 指向最终assessment的artifact_id，并验证该引用存在；历史环境准备记录保持可读。初始创建失败没有完整prepare时，仍保存部分资源和cleanup信息，最终不可能ALLOW。

attach配置需要可确认的data_revision：作为新增兼容字段或已声明扩展进入schema与policy hash；旧配置可以静态读取，但当profile要求数据来源而没有该字段时运行应明确BLOCKED。不要把应用自报的数据版本当作用户已确认版本。

### 2.3 阶段与平台出口不能混算

单独执行 `tests/integration/stages/m3.test.ts` 通过，可以标记“此平台核心全栈闭环已测”。正式 `pnpm verify:stage -- --stage M3` 仍须检查原依赖SG-052—076及本轮前置任务。**SG-071的必需Linux/WSL能力尚未验证时，不能将SG-071和整个M3无条件置DONE。**

M4的宿主实际加载、外部可信CI运行未完成，不应被提前算作M3已支持；它们保留在独立外部验证栏，并继续阻止M4发布门槛。这样既不让尚未解锁的M4任务反向造成DAG循环，也不降低M3自身的强制要求。

### 2.4 初始资源预算（实施默认值，可明确收紧）

HTTP 请求默认 5 秒 deadline，响应体上限 1 MiB；重定向默认拒绝。readiness 全程 60 秒 deadline，单次 2 秒，间隔最多 500ms，不无限轮询。每 run 100 MiB 总预算沿用产品目标，核心身份/契约/报告优先；trace/截图超限可不保留，但影响必需证据就必须拒绝完整通过。调整配置必须进入 policy hash，不允许执行中临时加大绕过失败。

## 3. 审计前置任务



<a id="aud-000"></a>
### AUD-000 · 锁定实际交付范围并重建基线

**依赖：** 无。**产物：** `docs/implementation/audit-m3-fixes.json`、`docs/implementation/M3-entry-audit.md`。修改当前 PROGRESS 和 architecture-map，不更改历史日志正文。

- [ ] 输出当前 HEAD、branch、dirty 文件名单，与审计 SHA 的差异；读取 SG-051—077 的 status/actual_files/verification。
- [ ] 检查 `examples/.../apps/web`、adapter-playwright、adapter-compose、M3 stage 是否真实存在。对本地新增实现逐项标记已验证/未验证，不单凭目录存在置 DONE。
- [ ] 根据第1节运行现有 M2 与 SG-051 验证；在未建立新记录器前，保存本次命令的原始输出及独立源码摘要，记录器缺口不阻止保留真实结果。
- [ ] 台账初始化 AUD-000—004 五个唯一 ID；每项记录 dependencies、status、actual_files、verification_refs、blockers、next_action。先创建 `scripts/verify-audit-m3.mjs` 和 `tests/bootstrap/audit-m3-ledger.test.mjs`，使重复 ID/未知状态/无证据 DONE 均失败。
- [ ] 把当前导航改为“M2 已有历史验收；M3 到 SG-051”，并注明审计基线。如当前代码更先进则按新证据更新，不回滚到旧状态。
- [ ] 记录工具能力：native Windows Runner、Linux Runner、Docker、浏览器各自独立，不能用主机上能运行 node 代替认证。

**验证：** `node --test tests/bootstrap/audit-m3-ledger.test.mjs`；`pnpm verify:source`；第1节基线。**完成：** 原始通过/现有失败/环境阻塞三类分清。没有环境不导致其他无依赖任务停止，但不能勾选完整阶段通过。

<a id="aud-001"></a>
### AUD-001 · 修复开发证据源码身份，保留旧记录

**依赖：** AUD-000。**修改：** `scripts/record.mjs`。**新增：** `scripts/verification-inputs.mjs`、`tests/bootstrap/record-identity.test.mjs`。审计关联 A-02。

- [ ] 先在临时 Git 仓库复现：同一 HEAD 下修改 tracked 文件、增加 untracked 文件，现有 `repository.worktree_digest` 不变；保存两个原始 JSON 和独立文件 hash。
- [ ] 实现 `captureVerificationInputs(root, options)`，返回相对路径清单、类型/mode/digest、tracked/index/untracked、明确排除项、completeness 和 content_hash。通过 NUL 分隔 Git 输出读取路径，不能按空格/换行拆文件名。
- [ ] 默认排除 `.git`、开发 evidence 输出、`.stackgate/state` 和可重建缓存；tracked 的必要源码仍纳入。超预算、越界链接、文件读到一半变化要标不完整，不静默漏掉。
- [ ] recorder 在子进程前后分别捕获；保存 `source_before/source_after` 引用、hash、`source_changed_during_verification`。命令 exit 0 仍保存为原始退出，但验证是否可归属另外判断；源码中途变化不能授予该源码 DONE。
- [ ] 旧 `worktree_digest` 按旧语义保留，并增加明确 `repo_path_id` 与新内容字段，不把旧证据重新盖成已拥有内容摘要。
- [ ] 将 recorder 的任务 ID 白名单增补 `AUD-000`—`AUD-004`，校验与独立审计台账一致；不要只把 regex 放宽成任意文本。AUD-001 自己的早期 RED 原始日志先保留，待工具可用再记录验证，不伪造过去时刻。
- [ ] 测试原始字节 CRLF/UTF-8/中文路径、staged 与 unstaged 不同、untracked 删除、只写 evidence 不导致自我失效；改变测试文件/锁文件应改变内容摘要。

**接口草案（需在新增模块真实导出）：**

```ts
// 新模块的接口约束；实现仍在 scripts/verification-inputs.mjs，使用 JSDoc 保持类型可读。
interface VerificationSnapshot {
  content_hash: string | null;
  completeness: 'COMPLETE' | 'INCOMPLETE';
  files: { relative_path: string; digest: string | null; kind: string; mode: string | null }[];
  exclusions: { relative_path: string; reason: string }[];
}
declare function captureVerificationInputs(
  root: string, options?: { maxFileBytes?: number }
): Promise<VerificationSnapshot>;
```

这是待实现模块的接口约束，不是可以单独交付的空声明。第2/3步的实际枚举、读取、内容摘要和反例运行全部完成后才允许标记 DONE。

**关键断言：**

```js
assert.notEqual(before.content_hash, after.content_hash);
assert.equal(before.completeness, 'COMPLETE');
assert.equal(after.completeness, 'COMPLETE');
assert.deepEqual(before.files.map(file => file.relative_path).sort(), expectedBeforePaths);
```

**验证：** `node --test tests/bootstrap/record-identity.test.mjs`；`node --test tests/bootstrap/ledger.test.mjs`；`node scripts/verify-audit-m3.mjs`。**完成：** 对相同源码输出相同内容摘要；对本次已复现的不同源码输出不同摘要；开发命令失败退出码原样保留。

<a id="aud-002"></a>
### AUD-002 · 复现 Gate 认证中途变更，再决定最小修复

**依赖：** AUD-001。**修改：** `packages/core/src/services/gate-service.ts`。**新增：** `tests/integration/gate/during-evaluation-change.test.ts`。复用 `tests/support/local-run-project.ts`。

- [ ] 用真实 LocalRunner 创建 sealed PASS run；确认基础 Gate 正常通过后再安装测试屏障，不能把创建 run 的 collector 提前替换。
- [ ] 在 Gate 的真实 JUnit recollect 第一次进入时写入新 untracked TypeScript 文件，继续调用原 collector。不要 stub 掉 PlanService/TrustService 的新鲜度逻辑。
- [ ] 测试期望 `DENY`，明确已观察到内容变化时 `STALE/4`。若现有代码已经拒绝，保存拒绝路径并将风险关闭，不强制修改业务行为。
- [ ] 若复现错误放行，在所有证据重收集与 seal 完整性核验结束后做第二次当前输入/任务/授权观察；使用最后观察结果计算 evaluation，不能只再读一次 manifest。
- [ ] 身份前后不一致、任务不能重新解析、工具消失分别保留诊断。输入改变是 STALE，当前输入无法观察是 UNVERIFIED；不要把所有当前环境错误写成历史报告遭篡改。
- [ ] 保留正常 PASS、已有 FAIL、损坏报告优先级、取消和旧任务的测试；确认 run 的 seal/manifest 字节未被 Gate 修改。

**拟新增反例主体：**

```ts
import { it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { localRunProject } from '../../support/local-run-project.js';
import { RunService } from '../../../packages/core/src/services/run-service.js';
import { GateService } from '../../../packages/core/src/services/gate-service.js';
import { JunitAdapter } from '../../../packages/adapter-junit/src/junit-adapter.js';

it('rejects a source change during real Gate recollection', async () => {
  const repo = await localRunProject();
  const collect = JunitAdapter.prototype.collect;
  try {
    const plan = await repo.createPlan();
    const run = await new RunService(repo.root, { trustStoreRoot: repo.store }).execute(plan.plan_id);
    expect(run.evaluation.decision).toBe('ALLOW');
    vi.spyOn(JunitAdapter.prototype, 'collect').mockImplementationOnce(async function (step, context) {
      await fs.writeFile(path.join(repo.root, 'apps/web/changed-during-gate.ts'), 'export const changed = true;\n');
      return collect.call(this, step, context);
    });
    const gate = await new GateService(repo.root, { trustStoreRoot: repo.store }).inspect(run.run_id!);
    expect(gate.evaluation).toMatchObject({ decision: 'DENY', freshness: 'STALE', exit_code: 4 });
  } finally {
    vi.restoreAllMocks();
    await repo.cleanup();
  }
});
```

TypeScript 严格 this 类型按现有 Vitest 版本补足；若本地当前 collector 入口变化，测试屏障放在新的同等 I/O 边界，而不是删掉反例。测试文件预算参考已有600秒长认证文件，先记录耗时再设合理预算，不改变产品命令 timeout。

**验证：** `pnpm exec vitest run tests/integration/gate/during-evaluation-change.test.ts tests/integration/gate/current-state.test.ts`；`pnpm typecheck`。**完成：** 真实反例有结果，修复只改变认证末端时序，不承诺对同权限并发攻击提供原子沙箱。

<a id="aud-003"></a>
### AUD-003 · 冻结 M3 事实协议与统一适配器接入

**依赖：** AUD-001；AUD-002 可独立推进，但 SG-062 前必须收口。**新增：** `docs/adr/ADR-012-m3-evidence-runtime.md`、`packages/core/src/services/adapter-registry.ts`、`tests/contract/m3-runtime-contracts.test.ts`。变更相关 `schemas/0.1/`，生成类型，不覆盖现有文件名称。

- [ ] 阅读当前 EnvironmentManifest、ProbeReport、PlaywrightReport、PlanContext、RunCompletion、Artifact schema，逐字段写兼容差异表；已有字段不重复定义。
- [ ] 落实第2.1节 RuntimeAdapterRegistry、准备/收尾观察、cleanup结果、认证assessment，以及声明式 Probe 断言。每个新输入都必须被计划/策略摘要覆盖，来源事实与建议分开。
- [ ] 保留当前 command/JUnit 注册；其他适配器在尚未实现时 `get` 返回 null，不能提前列 supported。支持列表按真实工厂和当前平台 capabilities 计算。
- [ ] 明确 environment synthetic DAG 节点如何转为 CheckResult；不得增加虚构 executed_tests，不能依赖“contract result 可以没有进程”就跳过环境身份认证。
- [ ] 明确 data_revision 在 createRun 前确定；prepare/finalize/cleanup 是追加的不同证据；成功 cleanup 后的 CLEANED 不应抹掉先前 READY 观察，也不能使整个历史 Run 因服务已正常停止而必然失效。
- [ ] Gate 对历史运行验证其当时环境记录、当前代码与配置；不要求已清理测试容器复活，不能为了 `gate` 重验再启动服务。环境连续性由执行期间观察与收尾证据证明。
- [ ] 输入完整性、计划 hash、执行授权 hash、所有权 token 贯穿流程；Runtime bindings 只注入已确认服务与容器端口的实际宿主 origin，不授权任意localhost端口。
- [ ] 更新 architecture-map 的实际 M2 入口、M3 未支持项和新增 schema，补从 Run 到 Gate 的单向依赖测试。

**关键合同断言：** 不支持适配器不能报告支持；从外部 JSON 读到 `satisfied:true` 但没有可认证 evidence 必须拒绝；同一 id 的执行/重收集注册不能不同。

```ts
expect(registry.get('command')).not.toBeNull();
expect(registry.get('junit')).not.toBeNull();
expect(registry.supportedIds()).not.toContain('playwright');
```

这里三行是 AUD-003 尚未安装浏览器实现时的阶段断言。SG-062 完成后改用“注册表包含真实 Playwright 工厂”的集成测试，同时保留“缺工厂必须阻塞”的负例；不能把中间状态断言永久当产品限制。

**验证：** `pnpm generate:types`、`pnpm verify:schemas`、`pnpm exec vitest run tests/contract/m3-runtime-contracts.test.ts`、`pnpm verify:boundaries`、`pnpm typecheck`。**完成：** 结构和职责先统一；不是仅建立空文件后声称 M3 已实现。

<a id="aud-004"></a>
### AUD-004 · 补齐 Linux 受控 Runner 能力，禁止平台假通过

**依赖：** AUD-003。**新增：** `packages/runner-local/src/linux/{capabilities,broker,ownership,cleanup}.ts` 与 `tests/compatibility/linux/{runner,descendants}.test.ts`。**修改：** `local-runner.ts`、`provenance.ts` 和 runner provenance schema。**最终门槛：** SG-071/076。

- [ ] 先写“在 Linux 真实运行 exit0 的 node 命令”的测试并观察当前 UNSUPPORTED；与 Windows Job Object 路径隔离，Windows回归仍应通过。
- [ ] 实现 capability 探测：是否有已授权、可委派的 cgroup v2 子树和必要的生命周期控制能力。不得自动 sudo、改宿主权限、挂载高权限Docker socket或用 CI=true 伪装能力。
- [ ] 选择一个明确支持的 Linux 子集：通过受信 broker 把命令在执行用户代码前纳入独立自有 cgroup。broker 与用户命令分离、stdin 使用结构化 payload；登记 cgroup路径、创建身份和随机 token。若采用 systemd 用户 scope，其有效单元及委派能力必须实际核验。
- [ ] 命令取消/超时后终止本次归属范围，观察空成员和关闭句柄；验证 detached/setsid 后代不能继续写心跳。只使用 process group 的降级可以输出诊断，但未经逃逸测试不能给出与 Job Object 等价的 cleanup VERIFIED。
- [ ] 记录当前支持机制和版本/身份；扩展 `validateCommandProvenance` 对新机制的合法组合。不能把 schema 任意 mechanism 字符串视为可信。
- [ ] 真实测试无关进程仍存活、PID重复/伪台账不杀进程、broker异常/用户取消/输出超限后无自有残留、非委派环境返回能力缺失。
- [ ] CI 和 WSL 分别提供日志：缺 cgroup 能力时按 BLOCKED 填表；可以继续其他任务，但 Linux/WSL 宣称支持及 SG-071 全验收不成立。

**验证命令：** `pnpm exec vitest run tests/compatibility/linux`；在 Windows 上重跑 `tests/integration/runner/process.test.ts`。**完成：** 至少一个明确记录配置的 Linux/WSL 支持环境运行真实进程及清理反例成功；其他环境保留未认证。cgroup 文档是实现依据，不是本次已完成安全认证的证据。

## 4. SG-052—077：保留原要求，追加当前仓库落地细节

下面保留原 v0.1 每张卡的功能目标、依赖与反例，随后添加“当前代码接入补充”。源卡片中的 Wxx/E编号与章节引用均属于原 v0.1 文件，不能被解读为本文同名章节。所有新增代码片段是待实现的接口/测试锚点，不是已经运行通过的代码。

统一附加依赖：SG-052/054 开始前完成 AUD-000；任何 M3 协议与 core 改动在 AUD-003 后落地；SG-062 前 AUD-002 必须有结论；SG-071 前 AUD-004 的对应平台执行能力必须真实可用。现有 SG-051 不重做，但需要新基线下复验。



<a id="sg-052"></a>
### SG-052 · 实现 React 页面与彼此独立的 Mock 单测

**阶段：** M3　**前置：** SG-009、SG-051　**远程审计时状态：** READY

**需求依据：** 原稿 S01、§19.1；原 v0.1 执行计划 §1.3

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

**当前代码接入补充（本轮新增）：**

当前只有 apps/api；新增 apps/web，不另写 API。先核对 pnpm-workspace.yaml，确认根构建是否应包括示例，避免示例依赖无意进入核心发行包。

- [ ] **实现细节 1：** 建立 React+TypeScript+Vite 示例和独立锁文件/工作区声明；先固定并实测选定版本，写入 tools/compatibility-lock.json；不在测试运行时联网安装。
- [ ] **实现细节 2：** 保留默认 broken client 的旧字段读取作为命名清楚的故障 fixture；不要制造编译错误。旧 Mock 返回 data.totalReturn，页面单测可以通过；真实 FastAPI 返回 data.performance.total_return，因此页面真实验收失败。
- [ ] **实现细节 3：** 页面显示加载、空值和明确错误，不让 NaN/Infinity 或静默0充当成功；data-testid 与原目标契约稳定。fixed 补丁只更新允许的消费者和对应应用单测，不更改保护的 E2E 期望。
- [ ] **实现细节 4：** Vite 目标后端从受确认的运行配置取得；临时测试端口按实际启动信息回传，不依赖共享的5173/8000。不要把任意环境变量 URL 直接升格为授权 origin。
- [ ] **实现细节 5：** 使用只读对照 fixture 验证 fixed 补丁适用性和补丁外路径无变化；编译、应用单测、静态契约检查分开记录。

**具体接口 / 配置 / 验收锚点：**

```ts
// apps/web/tests/performance.test.tsx 中的两种明确输入，不是核心PASS返回值。
const oldMock = { data: { totalReturn: 0.1234 } };
const targetResponse = { data: { performance: { total_return: 0.1234 } } };
// 独立场景：broken + oldMock 单测通过；broken + targetResponse 显示数据错误。
// fixed + targetResponse 必须呈现 "12.34%"；null/缺失必须进入空状态。
```

**额外完成条件：** 应用单测运行时可使用 Mock；T01/T02 的浏览器验收不能使用该 Mock。对照测试必须证明 broken 与 fixed 的行为确实不同。



<a id="sg-053"></a>
### SG-053 · 实现 Playwright reporter 与稳定验收 ID

**阶段：** M3　**前置：** SG-006、SG-030、SG-031、SG-038、SG-052　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

packages/adapter-playwright 当前不存在；现有 schemas 中的 PlaywrightReport 应先复用。Gate 目前不会接受这类结果；本卡只完成真实采集和 collector，不声称 CLI 全栈已连通。

- [ ] **实现细节 1：** 新增 reporter default class 与 index.ts 导出，构建脚本增加明确的 reporter 入口；仅用于本地构建验证，发行包仍留 SG-078。
- [ ] **实现细节 2：** onBegin 记录实际发现的全部测试及稳定 annotation；onTestEnd 记录 status、expectedStatus、retry、errors、关键断言和附件；onError 记录框架错误；onEnd 完成原子报告写入并设置 completed。
- [ ] **实现细节 3：** 报告写入 STACKGATE_OUTPUT_DIR/playwright.json，使用当前 run/check/attempt 标识；不读取任意工作区旧 JSON；同一 attempt 不允许覆盖另一份已完成报告。
- [ ] **实现细节 4：** Reporter 回调异常要自己捕获并生成失败/不完整标记，不能假设抛错就会令 Playwright 非零。即使缺错误标记，collector 也须因缺 completed/必要产物拒绝通过。
- [ ] **实现细节 5：** 将浏览器截图/trace 作为受限可选证据，不能用截图存在代替断言执行。至少一次使用真实浏览器而非模拟 reporter 回调验证 positive 和 intentional failure。
- [ ] **实现细节 6：** 写独立 collector：核对原始进程退出、JSON结构、作用域、版本、稳定ID、完整性；单个报告的宣称不能跨run共享。

**具体接口 / 配置 / 验收锚点：**

```ts
import { test, expect } from '@playwright/test';
test('performance summary', {
  annotation: { type: 'stackgate-id', description: 'performance-summary' }
}, async ({ page }) => {
  await page.goto('/');
  await test.step('assert:total-return', async () => {
    await expect(page.getByTestId('total-return')).toHaveText('12.34%');
  });
});
```

**额外完成条件：** 实际 reporter 抛错、输出目录不可写、浏览器崩溃、ID缺失/重复、0测试、retry后通过分别保留负例；具体 Playwright API 以本卡实测锁定版本为准。



<a id="sg-054"></a>
### SG-054 · 实现受限 HTTP probe 与 Python 预设 helper

**阶段：** M3　**前置：** SG-018、SG-022、SG-038、SG-051　**远程审计时状态：** READY

**需求依据：** 原稿 F11、§12.2、§16.2；E15

**可独立验收的目标：** 按声明操作执行实际请求，输出可重新核验的协议证据。

**创建 / 修改文件：** 新增 presets/fastapi-react/scripts/probe_helpers.py、examples/contract-drift-demo/apps/api/scripts/probe_performance.py、packages/core/src/services/http-policy.ts、tests/integration/probe/http.test.ts。

**输入输出与共享接口：** probe_performance.py 只执行配置的 GET /api/performance；生成 原 v0.1 §4.5 probe.json 和受允许的合成响应证据。

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

**当前代码接入补充（本轮新增）：**

collectProbe 已校验报告和响应 schema，但合法输入仍固定 BLOCKED。这是待补的来源认证，不要仅删除最后两个 reasons。

- [ ] **实现细节 1：** 在 Python helper 中实现带总deadline和响应体上限的请求；仅允许登记 operation，默认不跟随重定向；HTTP header/URL/path 通过结构化参数处理。
- [ ] **实现细节 2：** 从运行器注入的已验证 bindings 取得 API origin，不扫描网络，不根据名字含 test 就认为安全。环境变量只携带必要的synthetic身份。
- [ ] **实现细节 3：** 每请求分配唯一 request_id，与 run/check/attempt 一起写受控测试header；保存请求方法/路径、响应状态/media type、受预算限制的响应体和摘要。
- [ ] **实现细节 4：** 新增经确认的 declaration 文件 .stackgate/probes/performance.json；只定义 GET /api/performance、200、application/json 及 JSON Pointer /data/performance/total_return 的数值断言，不支持任意代码或语言模型判定。
- [ ] **实现细节 5：** 核心重算声明式断言与 schema结果；schema_valid/passed 自报值只作对照输入。没有后端观察证明时仍输出来源不足，本卡可单独验证 HTTP helper，不提前赋予整体 PASS。
- [ ] **实现细节 6：** 区分连接失败、超时、未经授权redirect、响应超限、状态不符、类型不符；错误有明确reason，不能都映射到业务断言失败。

**具体接口 / 配置 / 验收锚点：**

```json
{
  "schema_version": "0.1",
  "operation_key": "api:GET /api/performance",
  "expected_status": 200,
  "assertions": [
    {"id": "total-return-type", "pointer": "/data/performance/total_return", "operator": "type", "expected": "number"},
    {"id": "total-return-value", "pointer": "/data/performance/total_return", "operator": "equals", "expected": 0.1234}
  ]
}
```

**额外完成条件：** 这个 JSON 是待新增 probe-declaration schema 的完整例子，不应直接塞进旧 ProbeReport。正例必须发送真实本地 HTTP 请求；未经授权目标用第二个本地哨兵监听器证明请求数为0。



<a id="sg-055"></a>
### SG-055 · 实现测试专用后端访问观察与实例标识

**阶段：** M3　**前置：** SG-030、SG-051、SG-054　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

现有 create_app() 只有业务路由和健康接口；观察中间件应作为显式测试模式包装它，默认关闭，不改变正常 API 契约。

- [ ] **实现细节 1：** 新增 ASGI 观察中间件；instance_id 在服务启动时生成或由可信测试launcher固定，不能从传入header照抄。采集响应发送的实际字节并遵守小响应边界。
- [ ] **实现细节 2：** 只为已经登记的测试run接受关联header；不记录Authorization/Cookie，拒绝超长和无效标识。运行id不能变成可任意指定的文件路径。
- [ ] **实现细节 3：** 观察文件写到自有测试目录，按run/attempt分区，以受控路径读取；不对外公开读取任意本地文件的endpoint。
- [ ] **实现细节 4：** 进程启动记录来自测试launcher/资源检查，而不只来自API自己返回的revision。访问记录与进程身份是两份相互关联但不同性质的事实。
- [ ] **实现细节 5：** 加入防串台：来自run A的请求不能替run B计数；相同request_id重复但响应不同必须冲突；端点健康但没有业务访问不能满足真实链路。

**具体接口 / 配置 / 验收锚点：**

```json
{
  "schema_version": "0.1",
  "run_id": "run_observation_demo",
  "check_id": "runtime",
  "attempt_id": "attempt_observation_demo",
  "request_id": "request_performance_1",
  "instance_id": "instance_backend_1",
  "operation_key": "api:GET /api/performance",
  "status_code": 200
}
```

**额外完成条件：** 上例只展示身份关联字段，完整BackendObservation还必须包含时间及实际计算的response_digest；测试应断言这些字段存在、格式有效，并与捕获字节相符。不要把示例常量instance用于真实执行。



<a id="sg-056"></a>
### SG-056 · 实现 attach 环境来源核验

**阶段：** M3　**前置：** SG-014、SG-018、SG-039、SG-051、SG-055　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

沿用当前 EnvironmentPort.prepare(EnvironmentRequest, ExecutionContext)，不要实现旧卡中与现有端口不兼容的方法。attach不能依赖StackGate自动拥有用户进程。

- [ ] **实现细节 1：** 实现 AttachAdapter：读取已确认 origins、健康路径、启动记录与输入摘要；仅连接专用测试服务，不导入应用或主动重启。
- [ ] **实现细节 2：** 新增显式 demo-env launcher：按固定输入启动FastAPI和React、记录进程创建身份/启动时间/instance/输入/data_revision，并禁用热重载；用户显式调用该launcher不等于attach拥有它。
- [ ] **实现细节 3：** OBSERVED至少要求独立启动事实与当前源码相符、实际instance相符、请求到达该instance；无法观察OS或来源只给DECLARED。对方填一份JSON不等于认证。
- [ ] **实现细节 4：** attach resources记录 created_by_stackgate:false；cleanup只返回PRESERVED，不停止用户服务。launcher自己的teardown仅作用于它独立登记的子进程。
- [ ] **实现细节 5：** 测试路径跨平台差异和伪造provenance、陈旧记录、PID重用、输入hash不一致；对UNC/越界链接保持拒绝或明确未支持。

**具体接口 / 配置 / 验收锚点：**

```ts
import type { EnvironmentPort, EnvironmentRequest } from '../../../core/src/ports/environment.js';
import type { ExecutionContext } from '../../../core/src/ports/adapter.js';
import type { EnvironmentManifest } from '../../../contracts/src/index.js';
// 类位于 packages/adapter-compose/src/attach/adapter.ts；上述路径对应当前 packages 布局。
export interface AttachPreparation {
  prepare(request: EnvironmentRequest, context: ExecutionContext): Promise<EnvironmentManifest>;
}
export type AttachCleanup = EnvironmentPort['cleanup'];
```

**额外完成条件：** 正常attach验收结束后，实际用户进程仍存活并响应。无法确认来源是BLOCKED/2，不是把健康接口200当PASS。



<a id="sg-057"></a>
### SG-057 · 实现 Compose 有效配置安全预检

**阶段：** M3　**前置：** SG-016、SG-018、SG-032、SG-055　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

当前没有Compose适配器与compose.test.yaml；本卡只预检，不能在preview时创建容器、下载镜像或读取生产配置。

- [ ] **实现细节 1：** 用户提供Compose文件作为受保护输入；使用固定信任的Docker CLI解析有效配置，禁止候选仓库在PATH放同名程序。有效配置摘要进入授权预览。
- [ ] **实现细节 2：** 拒绝privileged、host网络、Docker socket、外部卷/网络、敏感宿主路径挂载、固定container_name；检查服务名和预设目标绑定。实际环境变量解析只使用最小允许集合。
- [ ] **实现细节 3：** 固定宿主端口先做冲突检测；默认样例使用loopback动态端口，绑定到已登记service/container_port。不能授权所有localhost端口或访问任意宿主服务。
- [ ] **实现细节 4：** 配置输出可能有secret，敏感原文不进入常规日志；摘要前后的脱敏表现要分开，不用删值后hash假装绑定真实有效配置。
- [ ] **实现细节 5：** 首个demo使用API内部固定合成数据，不引入生产数据库。以后新增数据库要单独预检、seed版本和最小权限。

**具体接口 / 配置 / 验收锚点：**

```yaml
# 示例局部：完整 compose.test.yaml 还需要 build、环境观察目录和已确认健康检查。
services:
  api:
    ports:
      - target: 8000
        host_ip: 127.0.0.1
        protocol: tcp
  web:
    ports:
      - target: 5173
        host_ip: 127.0.0.1
        protocol: tcp
```

**额外完成条件：** 选择的Compose版本必须实测未指定published时动态发布行为；如果不支持这段写法，改为该版本明确支持的动态绑定并记录，不用假定的8000/5173作为宿主端口。



<a id="sg-058"></a>
### SG-058 · 实现 Compose 启动、动态端口与实际来源记录

**阶段：** M3　**前置：** SG-031、SG-033、SG-035、SG-039、SG-057　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

RunManifest.data_revision目前创建后不可变；Compose运行需要在创建前取已确认数据版本。环境适配器不能绕过CommandResolver执行任意Docker命令。

- [ ] **实现细节 1：** 每run创建安全的project名和随机owner token，保存预检计划与将创建的资源类型；只通过白名单模板生成Docker参数数组，进入单独受限环境命令端口。
- [ ] **实现细节 2：** 明确处理命令运行器缺少常驻服务句柄的边界：Compose启动后Docker管理服务生命周期，CLI只执行有界命令；不把uvicorn常驻进程塞入等待退出的LocalRunner导致永不完成。
- [ ] **实现细节 3：** 启动后读取真实container/image/network/volume IDs及labels，按inspect输出确定实际发布端口和对应origin；先校验绑定声明后注入下一步骤。
- [ ] **实现细节 4：** 构建源必须来自本run固定输入或可验证的运行前后快照。禁止在未声明热重载下共享不断变化的挂载源码；使用独立build context并保留输入清单。
- [ ] **实现细节 5：** 记录OBSERVED所需的实例与源码关联；本地Compose不因为运行在容器中就自动CONTROLLED。CONTROLLED只在未来可信CI执行上下文有额外来源时成立。
- [ ] **实现细节 6：** 失败/取消使用部分资源台账交给SG-061清理；不依赖启动成功才保存所有权，因为部分启动也会留下资源。

**具体接口 / 配置 / 验收锚点：**

```text
confirmed compose config + data revision
→ authorize bounded Docker command templates
→ create isolated project
→ inspect actual IDs and loopback bindings
→ record prepare environment artifact
→ readiness and independent source assessment
```

**额外完成条件：** 同时两个run端口和resourceIDs不混用；第二个run不能接受第一个run的inspect JSON。测试实际docker create/up/inspect，不能只mock命令字面量。



<a id="sg-059"></a>
### SG-059 · 实现 readiness、旧服务与环境状态验证

**阶段：** M3　**前置：** SG-056、SG-058　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

/health只返回ready，无来源含义；将健康检查与来源核验分开。

- [ ] **实现细节 1：** 实现deadline驱动readiness：网络可达→健康状态→instance身份→输入/data_revision匹配，分别记录而不是单个ready布尔。
- [ ] **实现细节 2：** 响应体受限，redirect拒绝，origin必须是实际绑定的允许目标。保留每轮最后失败原因，不把环境未就绪当业务FAIL。
- [ ] **实现细节 3：** 在Probe/浏览器执行前检查一次，执行期间关联访问instance，收尾再观察；中途重启instance变化会破坏连续性。
- [ ] **实现细节 4：** 同端口旧服务、健康但错误源码、前端连到另一个后端都不得满足OBSERVED。短时瞬断可以有界重试，不能一直等待到偶然成功而丢失异常事实。

**具体接口 / 配置 / 验收锚点：**

```text
CONNECTED ≠ HEALTHY ≠ EXPECTED_INSTANCE ≠ CURRENT_INPUT
READY requires all configured source and readiness requirements.
A timeout produces an environment blocker; downstream business checks are not executed.
```

**额外完成条件：** 两套真实服务A/B共享相同/health响应但不同instance和输入，必须只接受配置中的那一个；服务启动顺序不等于readiness。



<a id="sg-060"></a>
### SG-060 · 建立浏览器→API→后端观察的真实链路关联

**阶段：** M3　**前置：** SG-022、SG-053、SG-054、SG-055、SG-059　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

需要与现有Probe schema与新的BackendObservation共同工作；当前Gate不会消费浏览器事实，因此本卡交付可重算的ChainAssessment，SG-062再接入。

- [ ] **实现细节 1：** 实现受保护Playwright fixture，为目标API请求注入run/check/attempt/request身份，收集实际请求、响应、所属test_id与关键断言；每次测试重置采集器，不使用全局共享run变量。
- [ ] **实现细节 2：** 关闭service worker；测试模板对目标API的route.fulfill给出明确不支持/拒绝。静态扫描仅作辅助，不能宣称可以识别任意恶意测试代码。
- [ ] **实现细节 3：** 关联五份事实：当前环境、Reporter用例、浏览器请求、后端访问、业务断言。匹配operation、request_id、instance、status与规范化响应字节摘要；缺任一必需项就不通过。
- [ ] **实现细节 4：** 第三方sandbox与真实业务后端分界明确；允许的第三方Mock不等于目标业务API可Mock。
- [ ] **实现细节 5：** 为重复request_id、不同attempt复用、只有后端无浏览器、只有截图、响应体不同但都标200建立负例；在完整目标样例运行真实浏览器正例。

**具体接口 / 配置 / 验收锚点：**

```text
required test_id
  → observed assertion_id
  → browser request_id / operation_key
  → matching backend request_id / instance_id / response_digest
  → authenticated environment input_hash / data_revision
```

**额外完成条件：** 仅有`page.goto`成功、任意截图或自报passed均不能满足真实链路。对response摘要转换规则至少覆盖UTF-8中文和JSON空格差异。



<a id="sg-061"></a>
### SG-061 · 实现 Compose 资源清理与专用测试数据边界

**阶段：** M3　**前置：** SG-045、SG-057、SG-058、SG-059　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

现有清理仅有M2自有文件/进程能力；新增Compose资源不允许直接对用户compose文件运行不受限down -v。

- [ ] **实现细节 1：** 在资源创建前登记意图、创建后登记实际ID与labels。按manifest列出的单个资源读取live inspect，核对run/owner/创建身份再删除。
- [ ] **实现细节 2：** 正常完成和失败/取消均执行清理；清理使用独立有界signal，而不是已被用户abort的业务signal，确保取消也有机会处理自有资源。
- [ ] **实现细节 3：** 按container→network/volume顺序清理，遇到外部引用/共享资源/owner变化就PRESERVED并说明；无法确认安全状态时记录ERROR而不是忽略。
- [ ] **实现细节 4：** 保存cleanup证据后再封存Run；attach resources永远不作为可删除候选；清理失败不能删除已有失败业务证据。
- [ ] **实现细节 5：** 测试启动部分成功就失败、owner标签被改、另一个run仍运行、external volume和无关容器存活；禁止全局docker prune。

**具体接口 / 配置 / 验收锚点：**

```ts
// 关键所有权条件，不等同于完整清理实现。
const mayDelete = resource.created_by_stackgate
  && resource.run_id === requestedRunId
  && resource.owner_token === requestedOwnerToken
  && liveIdentityMatches;
if (!mayDelete) preserved.push(resource);
```

**额外完成条件：** 完整实现应逐native_id调用已授权模板并重新观察结果。只测试mayDelete纯函数不足以验收本任务，需真实Docker取消及资源存活检查。



<a id="sg-062"></a>
### SG-062 · 将环境、候选导出、Probe、浏览器接入同一 Run

**阶段：** M3　**前置：** SG-021、SG-034、SG-039、SG-053、SG-054、SG-056、SG-058、SG-059、SG-060、SG-061　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

本任务是主集成点。必须改PlanService、RunService、GateService、run-evaluation与collectProbe共五处M2限制，并沿用统一存储、调度和退出码。

- [ ] **实现细节 1：** 先添加test fixture同时包含command、junit、openapi、probe、playwright、environment六类步骤；原始main应对后四类阻塞，保存这一阶段反例。
- [ ] **实现细节 2：** 在bootstrap/adapters.ts组装真实内置registry，并注入PlanService/RunService/GateService；CLI现有execution.ts只负责参数/输出，不自行启动浏览器或计算判定。
- [ ] **实现细节 3：** 实现OpenAPI运行适配器：只在当前attempt输出目录执行已确认candidate_command，收集candidate-openapi.json并通过已有ContractService比较已确认target；导出失败不能读取旧文件或让实际规范自行成为权威。
- [ ] **实现细节 4：** 环境prepare和来源核验产生已认证origin bindings，注入Resolver允许的STACKGATE_API_ORIGIN/WEB_ORIGIN；修正当前RunService的allowed_origins空数组，但不能把整个配置allowlist无条件当实际目标。
- [ ] **实现细节 5：** Probe执行后读取当前attempt报告与后端观察，核心重算声明式断言和schema校验；认证成功才增加executed_tests/executed_test_ids。将“自报结果”与“未发现报告”分别映射。
- [ ] **实现细节 6：** PlaywrightAdapter使用受审查参数和实际Reporter，collect时核对稳定ID、retry、断言和real-chain；Gate对该类与OpenAPI/Probe也重新collect，不只取消validateCheckPlanBinding中的白名单。
- [ ] **实现细节 7：** 将environment_satisfied改为由本run环境assessment得出；纯本地profile仍按无环境处理；外部脚本传入satisfied:true但缺引用必须拒绝。
- [ ] **实现细节 8：** 收尾顺序固定：停止新业务步骤→保存执行结果→finalize来源观察→清理自有环境→保存cleanup及completion→更新terminal manifest→封存→返回前输入复核。错误路径也遵守尽力保存、所有权不足不删。
- [ ] **实现细节 9：** 禁止把清理后的environment.status=CLEANED替换先前READY快照；历史Run的Gate依赖封存期间的来源事实，不为检查旧Run重启服务。data_revision在createRun之前由已确认输入赋值。
- [ ] **实现细节 10：** 运行构建后的CLI：task validate/confirm、trust review/confirm、plan、run、四种report、gate、handoff。同一run所有artifact携带相同任务revision与输入hash；运行前后的current input都需要核对。

**具体接口 / 配置 / 验收锚点：**

```text
PlanService → capability registry → fixed DAG
RunService → environment.prepare → current bindings
          → candidate export → target alignment
          → real HTTP probe → backend observation
          → Playwright → real-chain assessment
          → finalize observation → owned cleanup → seal
GateService → same collectors + source authentication
            → final input recheck → evaluateGate
```

**额外完成条件：** 必检至少覆盖：全栈正例、环境不明、candidate缺失、跨run报告、伪造schema_valid、页面实际断言失败、取消、cleanup失败、旧证据复用、认证途中源码变化。每项必须有准确exit/verdict/freshness/decision，不允许只断言不等于0。



<a id="sg-063"></a>
### SG-063 · 联动 inventory、跳过、断言和 flaky 防绕过

**阶段：** M3　**前置：** SG-026、SG-037、SG-053、SG-060、SG-062　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

现有aggregateChecks处理零测试/缺ID/flaky；保留这些规则。浏览器collector必须提供真实计数，不能为了进入纯函数而填配置预期数。

- [ ] **实现细节 1：** 在采集时分别记录预期inventory、实际发现inventory、执行attempts和关键assertions；reporter onBegin只看到筛选后的测试，因此必须与已确认expected inventory对照。
- [ ] **实现细节 2：** .only、grep、shard导致的少执行均保留缺口；P0先支持非分片运行，不自动合并不明来源分片报告。
- [ ] **实现细节 3：** 重复test_id、重复assertion_id、跨attempt伪重试均为冲突；第一次失败后成功标flaky而非覆盖前次失败。
- [ ] **实现细节 4：** test.fail()让框架认为失败符合预期，不代表产品验收成功；必检断言必须真实执行并满足目标。
- [ ] **实现细节 5：** 新增控制用例：环境已认证、所有流程完整但business assertion false应该FAIL/1；缺关键断言应INCOMPLETE/2，不把所有问题都分类为ERROR。

**具体接口 / 配置 / 验收锚点：**

```text
expected {performance-summary, performance-empty}
observed {performance-summary}
→ missing performance-empty → INCOMPLETE / DENY / 2

performance-summary retry0 FAIL, retry1 PASS
→ flaky retained → INCOMPLETE / DENY / 2
```

**额外完成条件：** 复用现有 tests/unit/gate 与运行事实计数测试；新增真实浏览器样例证明 .only/grep/expected-fail 不能改变必检集合。



<a id="sg-064"></a>
### SG-064 · 完成单测绿而联调失败的真实负例

**阶段：** M3　**前置：** SG-051、SG-052、SG-053、SG-060、SG-062、SG-063　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

当前已有新后端但没有旧消费者。初始演示应 baseline=已确认target，让契约兼容性通过，从而真正检出消费者错误而非被规范变更提前挡住。

- [ ] **实现细节 1：** 用专用helper物化隔离Git仓库，保持target包含新字段；应用SG-052 broken客户端，后端使用SG-051原应用。
- [ ] **实现细节 2：** 实际运行前端独立Mock单测和后端单测，保存两者原始exit0；这只是证明错误如何漏过，并非StackGate通过证据。
- [ ] **实现细节 3：** 通过构建后CLI产生同一run，运行真实Probe和浏览器；浏览器必须读取真实API返回的新结构，关键页面断言失败。
- [ ] **实现细节 4：** 断言该run为FAIL/FRESH/DENY，退出1；失败归因到消费者/断言而非ENV_PROVENANCE_INSUFFICIENT；缺真实来源不能算本任务已展示目标故障。
- [ ] **实现细节 5：** 保留artifact、浏览器请求、后端访问、失败断言位置；终端首屏展示具体操作及消费者，不生成无法复现的宽泛建议。

**具体接口 / 配置 / 验收锚点：**

```json
{
  "frontend_unit_exit": 0,
  "backend_unit_exit": 0,
  "stackgate_run_exit": 1,
  "expected_verdict": "FAIL",
  "expected_freshness": "FRESH",
  "expected_decision": "DENY"
}
```

**额外完成条件：** 这份JSON是测试期望，不是伪造产品输出。验收脚本必须把实际子进程输出和退出与其逐项比较。



<a id="sg-065"></a>
### SG-065 · 完成修复后的新 Run 与旧证据失效演示

**阶段：** M3　**前置：** SG-014、SG-043、SG-064　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

已有HandoffService和历史run不可变机制可复用。修复会改变输入身份、trust摘要或plan，因此不能试图重用旧plan强行执行。

- [ ] **实现细节 1：** 保留SG-064失败run的全部文件摘要，导出交接包；对自有fixture应用审查过的fixed补丁，检查diff只在允许路径内。
- [ ] **实现细节 2：** 按新输入重新核对task确认与trust；验收标准不变时不随意新建需求，若当前确认合同确实绑定改变的保护输入，应按明确revision机制处理，不能自动降低保护。
- [ ] **实现细节 3：** 创建新plan、新run和新实例，重新执行契约/Probe/页面与来源检查，最终必须PASS/FRESH/ALLOW/0。
- [ ] **实现细节 4：** 读取旧run的report仍可操作成功，其历史verdict仍FAIL；在当前源码下旧run的gate应STALE/4，不能把旧FAIL覆盖为PASS。
- [ ] **实现细节 5：** 交接验证能发现旧包的输入身份不匹配；第二个Agent仅把旧包当线索，不自动执行其中任意文本。

**具体接口 / 配置 / 验收锚点：**

```text
before fix: run_A → FAIL / FRESH / DENY / 1
after fix:  run_B → PASS / FRESH / ALLOW / 0
current gate(run_A) → STALE / DENY / 4
report(run_A) operation exit 0; historical verdict remains FAIL
```

**额外完成条件：** 比较run_A的seal、manifest和artifacts字节；新run_id !=旧run_id；不得通过恢复旧Mock或改E2E期望实现绿色。



<a id="sg-066"></a>
### SG-066 · 验证改契约、改断言与批准记录的防漂移闭环

**阶段：** M3　**前置：** SG-017、SG-021、SG-026、SG-062、SG-063　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

原TaskService、acceptance drift与Plan身份已实现；本任务测试真实入口组合，不能只再加一组纯函数数据。

- [ ] **实现细节 1：** 从已确认任务fixture分别修改target字段、删除测试、降低min_tests、更换adapter、改approved_breaking_rules；每个反例独立新目录，避免相互污染。
- [ ] **实现细节 2：** 验证修改后旧plan失效或确定性拒绝；不得执行过期计划中的危险命令。
- [ ] **实现细节 3：** 增加合法升级对照：目标变更由新revision确认、精确范围批准，重新plan/run；不能由任意approved:true绕过原条件。
- [ ] **实现细节 4：** 保留原始失败事实、旧确认与新确认，测试保护文件重命名、CRLF字节变化、内容改变但mtime复原。
- [ ] **实现细节 5：** 对语义不明的断言变化保持REVIEW_REQUIRED，不宣称静态算法能够判断全部断言是否更弱。

**具体接口 / 配置 / 验收锚点：**

```text
confirmed target + existing plan
→ change target bytes
→ old plan rejected (STALE or explicit policy denial)
→ no new execution under stale authorization
```

**额外完成条件：** T03/T04分别区分缺实际测试和保护输入变化；不得将所有修改归一成同一个无细节错误。



<a id="sg-067"></a>
### SG-067 · 验证旧服务、伪来源文件和中途环境切换

**阶段：** M3　**前置：** SG-056、SG-058、SG-059、SG-060、SG-062　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

不能用/health或provenance文件存在代替来源。需要两个真实实例而不是两个静态JSON。

- [ ] **实现细节 1：** 启动真实A/B实例，行为相同但输入摘要、instance、启动记录不同；使用A来源记录指向B端口，要求拒绝。
- [ ] **实现细节 2：** 复制/修改provenance文件而不改变实际进程，证明文件自报不是独立观察；不能仅验证JSON格式。
- [ ] **实现细节 3：** 在readiness成功后、浏览器请求前重启后端，或把前端转发目标切到B；实际访问证据必须揭示instance变更。
- [ ] **实现细节 4：** 分别覆盖合法专用attach、来源不明attach、受控测试Compose；每个case清理自身进程，保留另一个实例用于存活断言。
- [ ] **实现细节 5：** 记录环境不明是INCOMPLETE/2，明确身份冲突按schema/策略定义分类；不得伪装成用户业务代码错误。

**具体接口 / 配置 / 验收锚点：**

```text
same /health body
A: instance_A + input_A
B: instance_B + input_B
expected A, observed B → never ALLOW
```

**额外完成条件：** 用延迟屏障确保替换发生在readiness之后；不依赖随机sleep碰巧复现。



<a id="sg-068"></a>
### SG-068 · 验证未知 schema 与动态消费者回归策略

**阶段：** M3　**前置：** SG-019、SG-022、SG-024、SG-025、SG-062　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

M1新增selectionPolicyFor已经传递回归集；本任务验证它在真实Plan→Runner链上生效，不重复把旧M1缺陷当未修。

- [ ] **实现细节 1：** 为number→string、必需字段缺失/null构建合法target与错误真实响应，要求核心校验FAIL，不 coercion。
- [ ] **实现细节 2：** 对超出已测schema子集的特性，输出UNSUPPORTED_SCHEMA和位置；即便某个样本恰好通过也不能宣称规范支持。
- [ ] **实现细节 3：** 动态URL与无法解析模块分别制造unresolved；有已确认workspace_regression时通过实际执行日志证明回归被运行，同时保留analysis_gaps。
- [ ] **实现细节 4：** 没有回归集或只配置了一个工作区而另一个未知，必须保留coverage gap；required检查与task.required_test_ids不可被优化掉。
- [ ] **实现细节 5：** 注意区分analysis_gaps与coverage_gaps：可解释的静态未知在足够保守回归执行后不必永久阻塞；缺实际覆盖仍拒绝。

**具体接口 / 配置 / 验收锚点：**

```text
unknown web consumer + confirmed web regression
→ select and actually execute web regression
→ retain analysis gap

unknown api consumer + no api regression
→ coverage gap → INCOMPLETE / DENY
```

**额外完成条件：** 检查run事件包含workspace回归check_id，不只检查plan列表。



<a id="sg-069"></a>
### SG-069 · 验证真实浏览器产物隐私与超限处理

**阶段：** M3　**前置：** SG-030、SG-053、SG-054、SG-055、SG-062　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

M2已实现文本脱敏、预算和restricted分类；新增浏览器附件不能绕开这些边界。

- [ ] **实现细节 1：** 用合成canary分别放入请求Authorization、Cookie、响应Set-Cookie、页面DOM和错误输出；不使用任何真实账号。
- [ ] **实现细节 2：** 检查terminal/JSON/Markdown/JUnit/handoff和常规导出无canary原文；截图/trace可能包含，必须默认restricted且不自动外传。
- [ ] **实现细节 3：** 报告只引用安全的相对artifact标识，不泄露宿主用户名、绝对路径或env原值。可读失败片段由脱敏后来源取得。
- [ ] **实现细节 4：** 日志/trace/截图超过预算时保留retention信息；必需声明、访问观察或completed报告丢失必须阻断，不能一律当可选附件忽略。
- [ ] **实现细节 5：** 创建超大二进制产物和分块secret的真实测试，确认不会一次性读入无界内存；记录限制而不承诺自动彻底脱敏图像。

**具体接口 / 配置 / 验收锚点：**

```text
regular exports: canary absent
restricted trace/screenshot: classified, not auto-exported
critical report truncated: DENY
optional screenshot omitted: explicit not_retained, never used as pass evidence
```

**额外完成条件：** 无需OCR识别测试秘密；用可控fixture、文件类型和导出清单验证边界，不能把正则当图像脱敏。



<a id="sg-070"></a>
### SG-070 · 完成 Windows 原生命令、文件锁与取消验证

**阶段：** M3　**前置：** SG-032、SG-033、SG-045、SG-062　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

当前LocalRunner为Windows Job Object路径，已有process.test.ts。这里补真实浏览器/Compose下的Windows情况，避免重新造一般进程机制。

- [ ] **实现细节 1：** 在Windows11原生Node下运行UTF-8中文/空格路径、含&和引号的argv、CRLF输入及文件锁；用参数数组验证未被shell解释。
- [ ] **实现细节 2：** Playwright浏览器多子进程与独立无关node同时运行，取消当前run后只清理自有Job和容器，无关进程存活。
- [ ] **实现细节 3：** 文件句柄未关闭时的artifact rename/cleanup失败不得删旧证据或假装清理成功；采用有界重试并保留原始系统错误类别。
- [ ] **实现细节 4：** 与WSL路径隔离：不把G盘安装路径、Windows信任记录或broker能力复用给Linux。
- [ ] **实现细节 5：** 平台缺失记录NOT_RUN；不能在Linux上模拟process.platform并填写Windows通过。

**具体接口 / 配置 / 验收锚点：**

```text
Native Windows test dimensions:
UTF-8 paths | spaces | CRLF | locked artifacts | browser process tree
Each result records actual OS, Node, Git, broker, browser and Docker versions.
```

**额外完成条件：** 保留M2真实进程反例回归；适当调整测试harness预算要基于工作量记录，禁止提高产品超时掩盖资源泄漏。



<a id="sg-071"></a>
### SG-071 · 完成 WSL/工作树身份与 Git 边界验收

**阶段：** M3　**前置：** SG-012、SG-013、SG-014、SG-049、SG-062　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

原卡主要是平台/工作树验收，但当前Linux执行器缺失，所以AUD-004是新增真实依赖；不允许把纯Git测试通过当Linux完整产品通过。

- [ ] **实现细节 1：** 先确认AUD-004该环境的受控Runner能力，运行实际command/JUnit/浏览器进程和清理；不具备委派能力则阻塞真实执行认证。
- [ ] **实现细节 2：** 测试native Windows和WSL对同一源码路径的repo/worktree/platform身份分开，旧授权和绝对路径缓存不能串用。
- [ ] **实现细节 3：** 在linked worktree、dirty index、未跟踪输入和目标分支推进情形分别运行，复用已实现Git捕获；当前candidate必须对应本worktree。
- [ ] **实现细节 4：** 构建两分支各自通过但整合失败的fixture，先实际merge到临时候选再验收；不能拼两张绿报告。
- [ ] **实现细节 5：** 验证运行期间改源码以及Gate期间改源码两种时点；SHA-1/SHA-256仓库能力按当前Git实际支持报告，不凭默认对象格式推断。

**具体接口 / 配置 / 验收锚点：**

```text
Windows evidence platform_id ≠ WSL/Linux platform_id
run from worktree_A cannot authenticate worktree_B
new untracked input after run → STALE / 4
merged candidate must generate its own plan and run
```

**额外完成条件：** WSL文件系统与Linux本机文件系统分别标明；不能由一个环境的单测为另一环境背书。



<a id="sg-072"></a>
### SG-072 · 完成网络、引用、参数和资源安全反例

**阶段：** M3　**前置：** SG-019、SG-032、SG-054、SG-057、SG-061、SG-069　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

安全边界测试只作用于自有临时资源。现有M1外部$ref拒绝与M2路径/argv保护必须保持。

- [ ] **实现细节 1：** 对外部URL/文件$ref用本机哨兵服务和越界临时文件验证无访问，不向真实内网地址发请求。
- [ ] **实现细节 2：** 用两个本地origin测试redirect到未授权端口、协议相对URL、userinfo、IPv6回环规范化，验证URL解析后授权而不是字符串前缀。
- [ ] **实现细节 3：** 对所有artifact输出、Compose观察文件、handoff和clean路径测试../、链接、硬链接和重复ID；安全拒绝不能删除用户资源。
- [ ] **实现细节 4：** 取消在环境创建前、部分创建后、浏览器进行中、seal前发生，均检查证据保存和资源归属。
- [ ] **实现细节 5：** 文档明确allowlist不能限制任意业务脚本所有网络行为；严格网络隔离属于运行环境策略，不能宣称已建立恶意代码沙箱。

**具体接口 / 配置 / 验收锚点：**

```text
forbidden redirect target: observed request count = 0
external $ref sentinel: observed request count = 0
unrelated process/container: still alive
ambiguous resource ownership: preserved + diagnostic
```

**额外完成条件：** 正例保持允许目标可用，不能靠禁用所有网络让安全测试通过。



<a id="sg-073"></a>
### SG-073 · 实现 T01—T27 注册表与验收执行器

**阶段：** M3　**前置：** SG-064、SG-065、SG-066、SG-067、SG-068、SG-069、SG-070、SG-071、SG-072　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

test:acceptance当前指向unimplemented.mjs SG-073；要替换成真实注册和执行，不只填registry.json。

- [ ] **实现细节 1：** 实现registry严格schema，T01—T27各唯一映射test_path、required_platforms、required_tools、scope和expected_product_outcome；T28单独excluded=P1。
- [ ] **实现细节 2：** 执行器在运行前检查文件/工具/平台和选择ID；底层vitest退出0但机器结果缺test_id、实际0测试、过滤掉必检或仅skipped不能算已执行。
- [ ] **实现细节 3：** 区分验收测试harness成功与产品被预期拒绝：例如T01要求真实产品exit1而测试进程应该exit0；不要把所有非零产品结果当测试失败。
- [ ] **实现细节 4：** T23在M3验证交接包身份语义，不宣称Codex/Claude宿主已实际加载；T27在M3验证策略合并及真实CLI拒绝，外部GitLab可信loader仍由SG-084/085验收。注册表同时保存这些覆盖层级。
- [ ] **实现细节 5：** 多平台用例汇总接受独立受验证的结果manifest，记录每个平台实际运行；未测必需组合保持BLOCKED/NOT_RUN，release strict必须非零。
- [ ] **实现细节 6：** 实现未知ID、空选择、重复ID、缺记录、伪test总数、T28错误计入P0的bootstrap反例。

**具体接口 / 配置 / 验收锚点：**

```json
{
  "source_id": "T01",
  "test_path": "tests/acceptance/T01-response-rename.test.ts",
  "required_platforms": ["win32-x64"],
  "required_tools": ["node", "playwright", "python", "docker-compose"],
  "scope": "real-fullstack-local",
  "expected_product_outcome": {"exit_code": 1, "decision": "DENY", "verdict": "FAIL"}
}
```

**额外完成条件：** 例子描述一个平台case；完整registry按原目标保留Linux/WSL必要组合，不能仅复制这个Windows片段就减少跨平台要求。



<a id="sg-074"></a>
### SG-074 · 整理不少于 12 个可复现故障夹具

**阶段：** M3　**前置：** SG-009、SG-064、SG-065、SG-066、SG-067、SG-068、SG-072、SG-073　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

原始FX目录可以复用，但每个catalog条目必须真的能物化并触发不同故障机制；不是复制12份同一字段错误。

- [ ] **实现细节 1：** 建立FX-01—12，分别覆盖消费者旧字段、类型错、必填缺失、null、零测试、旧服务、伪来源、缺报告、flaky、目标漂移、动态消费者缺回归、运行中输入变化。
- [ ] **实现细节 2：** 每条记录seed、base/target/patch、预期rule/reason、允许修复路径、命令与平台；没有成功运行记录的条目不算可运行数量。
- [ ] **实现细节 3：** materialize只创建独立自有临时Git目录；已有目标路径默认拒绝，禁止覆盖用户项目或自动拉远程业务数据。
- [ ] **实现细节 4：** 固定相同输入内容可复现，动态instance/port/run_id不可伪造固定值；比较语义和源码hash，不强行要求所有运行JSON逐字一致。
- [ ] **实现细节 5：** 故障→发现→修复→新验收至少对主案例和代表性的其他故障实跑；保存未解决和不支持情况。

**具体接口 / 配置 / 验收锚点：**

```text
FX-01 consumer field drift
FX-02 runtime type mismatch
FX-03 missing required field
FX-04 unexpected null
FX-05 zero tests
FX-06 old backend
FX-07 forged provenance
FX-08 missing report
FX-09 flaky retry
FX-10 target drift
FX-11 unknown consumer without regression
FX-12 source changed during run
```

**额外完成条件：** 12条是原计划的回归资产门槛，不意味着12个统计独立市场需求或覆盖所有系统问题。



<a id="sg-075"></a>
### SG-075 · 实现性能基准与框架成本分解

**阶段：** M3　**前置：** SG-015、SG-034、SG-041、SG-046、SG-074　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

M2历史记录显示多次Gate认证很重；本卡先测量阶段成本，不能靠缓存集成PASS或减少必检来达标。

- [ ] **实现细节 1：** 生成原规定2000个文件、≤20MB、OpenAPI≤2MB基准；记录OS/CPU/内存/存储、版本和文件数，超出/缺失条件明确标注。
- [ ] **实现细节 2：** 分别测doctor、cold/warm plan、历史report读取、Gate当前输入认证、实际业务测试和清理。记录采样轮次、原始时间和p50/p95算法，不只取最快值。
- [ ] **实现细节 3：** 定位反复全量输入捕获和工具hash的成本；只能对纯解析或同一不可变字节快照的内容缓存，不能跨run复用环境来源或集成通过。
- [ ] **实现细节 4：** 先提供测量而不是强行优化架构；增加缓存时加入输入变更失效和未知能力不升级的反例。
- [ ] **实现细节 5：** 目标未达标记录实际值和瓶颈，不将2s/5s写成测量结果。开发耗时、产品测试耗时、模型费用分开，不推算用户订阅账单。

**具体接口 / 配置 / 验收锚点：**

```text
raw samples → documented quantile calculation → p50/p95
report read cost ≠ Gate re-authentication cost
framework overhead ≠ project build/test time
static cache hit ≠ reusable integration PASS
```

**额外完成条件：** pnpm bench必须生成有真实samples的JSON；无工具或样本不足不能输出已达标。



<a id="sg-076"></a>
### SG-076 · 建立平台与工具组合的验证矩阵

**阶段：** M3　**前置：** SG-010、SG-020、SG-053、SG-062、SG-070、SG-071、SG-073、SG-075　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

当前矩阵主要来自Windows历史；LocalRunner的Linux能力新增后必须真正跑对应组合。

- [ ] **实现细节 1：** 注册Windows native、WSL/Linux和Linux CI的明确组合，记录OS、Node、Git、oasdiff、Python、FastAPI、Playwright/browser、Docker/Compose和Runner mechanism。
- [ ] **实现细节 2：** 每格保存PASS/FAIL/BLOCKED/NOT_RUN及对应源码内容摘要、平台身份与证据；拒绝用Windows日志填写Linux格。
- [ ] **实现细节 3：** 测试版本不符、tool registry跨平台串用、只安装未运行、测试被过滤的结果；避免一个全局VERIFIED给所有平台授权。
- [ ] **实现细节 4：** 将本地M3能力与M4宿主/CI产品化认证分开。没有外部CI环境可以保留NOT_RUN，但不能宣称Linux CI已验证。
- [ ] **实现细节 5：** 输出严格发布检查：所宣称支持的必要格缺证据则非零；单平台核心闭环成功可单独展示，不自动宣称整个矩阵成功。

**具体接口 / 配置 / 验收锚点：**

```json
{
  "platform_id": "linux-x64",
  "scope": "real-fullstack-local",
  "status": "NOT_RUN",
  "evidence_refs": [],
  "reason": "No actual run has been recorded for this combination"
}
```

**额外完成条件：** 示例明确未测。禁止把它预填PASS；只有真实对应组合执行后才更新状态。



<a id="sg-077"></a>
### SG-077 · 完成真实全栈闭环阶段出口

**阶段：** M3　**前置：** SG-062、SG-063、SG-064、SG-065、SG-066、SG-067、SG-068、SG-069、SG-070、SG-071、SG-072、SG-073、SG-074、SG-075、SG-076　**远程审计时状态：** NOT_STARTED

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

**当前代码接入补充（本轮新增）：**

当前verify-stage只支持到M2，M3入口反例已局部复现exit2。本卡必须改变实际注册/执行逻辑，而非仅把字符串M3加入allowlist。

- [ ] **实现细节 1：** 新增M3 manifest、固定必检组和required tools，包含原基础检查、真实环境/浏览器/全栈失败修复、漂移/取消和本轮Gate时序回归；组名与脚本registry一一对应。
- [ ] **实现细节 2：** 新增bootstrap反例：manifest写M3但请求M2、删除必检组、测试目录存在但0执行、结果只含M2组、工具平台不匹配，均不能得到M3完成。
- [ ] **实现细节 3：** 同一隔离fixture通过CLI展示negative→report/handoff→fixed→newrun→gate。保留两个run全部原始事实及环境/浏览器独立来源。
- [ ] **实现细节 4：** 执行T01—27矩阵并显示层级：M3本地核心用例、平台验证、M4宿主/可信CI补充。原SG-077允许外部未具备项保持可见，但必须明确限定阶段成功范围；发布strict仍要求全部P0。
- [ ] **实现细节 5：** 以实际运行推导stage runtime，不硬编码EXECUTED；M3工具缺失时返回BLOCKED而不是skipped green。尚未覆盖的强制核心流程使M3 stage非零。
- [ ] **实现细节 6：** 更新PROGRESS、architecture-map、M3-summary和task ledger，记录本次被测内容hash与提交。SG-077未完成前不得把M4入口标READY；M4开发可先准备文档但不作为完成声明。

**具体接口 / 配置 / 验收锚点：**

```text
M3 core exit requires:
real negative run: FAIL / 1
real fixed run: PASS / 0
old evidence on new code: STALE / 4
missing provenance: DENY
cancel and cleanup: owned resources handled, evidence preserved
required core test absent: non-zero stage
```

**额外完成条件：** 执行 pnpm verify:stage -- --stage M3，保留所有子检查真实退出；最终报告分别列核心闭环状态、平台矩阵状态、M4外部认证状态，不能合并成无范围的“全部完成”。



## 5. SG-062 的联合验收矩阵：禁止只接通一半

下面的条目是本次为当前源码补充的集成验收，不替代原 T01—T27。

| ID | 输入 / 操作 | 必须观察的结果 |
|---|---|---|
| M3-I01 | 完整真实目标、正确页面、真实来源 | 新 Run PASS/FRESH/ALLOW/0 |
| M3-I02 | 前后端独立Mock单测绿，但消费者旧字段 | 单测0、真实浏览器失败、Run FAIL/1 |
| M3-I03 | candidate命令0但无候选文件 | 不读取上个attempt；缺报告拒绝 |
| M3-I04 | candidate来自另一个run | 身份拒绝，不进行伪一致性判定 |
| M3-I05 | target与candidate均被改成旧结构 | 目标确认/计划失效，不能双改修绿 |
| M3-I06 | Probe自报schema_valid:true但实际string | 核心重算FAIL |
| M3-I07 | Probe自报passed:true但期望值不符 | 核心声明式断言FAIL |
| M3-I08 | Probe缺后端观察 | 来源不满足，不能PASS |
| M3-I09 | 浏览器只加载页面/截图 | 缺关键断言和操作，INCOMPLETE |
| M3-I10 | 目标API route.fulfill / service worker拦截 | 受支持模板拒绝或真实访问关联失败 |
| M3-I11 | 后端观察来自另一instance | 环境/链路拒绝 |
| M3-I12 | 不同check复用request_id报告 | Scope冲突，不合并计数 |
| M3-I13 | .only/grep少跑稳定ID | 必检缺失，INCOMPLETE |
| M3-I14 | reporter内部抛错但框架退出0 | 缺完整标记/报告，非绿 |
| M3-I15 | expected-fail由框架接受 | 不能变成业务必检PASS |
| M3-I16 | 第一次失败后重试成功 | flaky保留，默认INCOMPLETE/2 |
| M3-I17 | attach健康但无来源 | DECLARED不足以满足OBSERVED |
| M3-I18 | readiness后替换/重启服务 | instance连续性失败 |
| M3-I19 | Compose部分启动后取消 | 已创建资源可追溯、安全清理 |
| M3-I20 | 用户attach服务参与run后清理 | 服务仍运行，PRESERVED |
| M3-I21 | 其他项目容器和相同镜像实例 | 无关资源不被删除 |
| M3-I22 | owner标签被修改 | 不删、记录安全错误 |
| M3-I23 | data_revision与任务不符 | 拒绝；不得修改不可变Run身份掩盖 |
| M3-I24 | 正常清理后再执行历史Gate | 验证封存时来源，不重启容器，不因CLEANED自动丢失历史READY |
| M3-I25 | 任意外部assessment写satisfied:true | 没有可认证来源证据，不被信任 |
| M3-I26 | 源码在执行中变化 | 当前运行失效；记录变化时点 |
| M3-I27 | 源码在Gate重收集中变化 | AUD-002反例：返回前拒绝旧FRESH |
| M3-I28 | 修改未跟踪消费者后读取旧Run | report可读；gate STALE/4 |
| M3-I29 | stdout/log/trace携带合成secret | 普通报告无secret，受限附件不自动导出 |
| M3-I30 | 关键证据因预算截断 | 拒绝完整PASS，保留预算诊断 |
| M3-I31 | Windows真实浏览器多进程取消 | Job后代停止，无关进程存活 |
| M3-I32 | Linux detached后代取消 | 实际受控归属清理；不具备能力则BLOCKED |
| M3-I33 | 动态消费者有回归集合 | 检查真正执行；保留analysis gap |
| M3-I34 | 另一个未知工作区没有回归集合 | coverage gap仍存在，不能只跑一个工作区就绿 |
| M3-I35 | 普通report/handoff成功读取失败Run | 操作退出0不改变原verdict/decision |
| M3-I36 | 只注册M3字符串但未执行浏览器 | stage拒绝M3完成 |

## 6. 执行证据与里程碑规则

### 6.1 每张任务卡的记录过程

AUD-001 支持新 ID 后，使用现有记录脚本保存真实命令：

```bash
node scripts/record.mjs SG-052 web-fixtures-red -- pnpm exec vitest run tests/integration/demo/web-fixtures.test.ts
node scripts/record.mjs SG-052 web-fixtures-green -- pnpm exec vitest run tests/integration/demo/web-fixtures.test.ts
node scripts/record.mjs AUD-002 gate-during-change -- pnpm exec vitest run tests/integration/gate/during-evaluation-change.test.ts
```

不要机械生成 RED 文件：先实现反例、实际观察失败原因；依赖未安装、文件拼写错误或网络中断不是功能 RED。已有行为正确时直接记录现有通过并解释，不为完成TDD流程制造错误。

每次任务结束至少记录：具体变更、实际文件、接口差异、命令/原始退出码、实际执行测试与 skipped、工具与平台、source_before/after、未验证项、下一可执行任务。生成文件及类型不得隐含漂移。

### 6.2 不把阶段历史与当前验证混淆

M2 在 V1 上的历史 stage退出0应保留。新的 main 合并后，若没有在当前字节和平台重新运行，应写“历史验证通过，当前未复验”，而不是删除历史结果或凭合并推断通过。

项目开发账本中的 DONE 是对特定验收交付的状态，不是任何将来代码都已通过。每次合并/修复后保留差异和新的受影响回归证据。

### 6.3 阻塞时怎么继续

| 阻塞 | 继续工作 | 不可宣称 |
|---|---|---|
| 没有Docker daemon/权限 | schema、Compose预检纯逻辑、collector单测、文档 | 真实Compose启动/清理通过 |
| 没有浏览器二进制 | reporter结构/JSON解析、接口测试 | Playwright实际页面验收完成 |
| 只有Linux、未实现受控Runner | AUD-004及纯逻辑；不伪造process结果 | command/JUnit/浏览器产品Run已通过 |
| 只有Windows | Windows实际流程，Linux端口代码和静态测试 | WSL/Linux环境认证通过 |
| 缺少宿主Codex/Claude加载环境 | M3 CLI与交接数据合同 | M4宿主插件安装已验证 |
| 源文件权限/工具摘要不符 | 诊断、修复本地安装或重新明确授权 | 静默放宽工具身份校验 |

BLOCKED不等于项目全部停止；按DAG继续无依赖任务，最终准确列出哪些出口仍不成立。

## 7. 原稿覆盖与后续 M4 门槛

### 7.1 本计划覆盖

原 SG-052—077 的标题、依赖、功能目标和验收条件都保留；当前源码需要的接口接入、数据revision、历史环境事实、注册表、Gate尾部新鲜度和Linux Runner以新增审计任务或卡片补充表达。

M3验收的 T23 证明交接包身份语义，不证明两个宿主已装好；T27证明实际候选配置不能放宽既有政策，不替代M4的可信CI策略loader。必须在注册表体现这两个层次，不能偷换为“后续CI已经通过”。

以下仍不在本轮实现：自动代码修复、模型调度器、Web控制台、Hooks、MCP、Vue/SpringBoot额外预设、云执行平台或生产部署。不要新增一个漂亮管理台替代缺失的真实链路。

### 7.2 M3 通过后下一批应是什么

| 原任务 | 功能 | 解锁前提 |
|---|---|---|
| SG-078 | 单一发行包、可加载Reporter | SG-077真实M3出口、SG-053 |
| SG-079 | 可独立使用的FastAPI/React预设 | 示例与配置可用、打包烟测准备 |
| SG-080—082 | Codex Skill、Claude插件、安装升级移除 | 核心CLI协议稳定、发行包可用 |
| SG-083—085 | GitLab退出码门槛、可信策略、合并候选 | 真实环境与策略边界完成 |
| SG-086—091 | 兼容升级、文档、许可、干净安装、宿主实测 | 原任务DAG逐项满足 |
| SG-092—095 | 全P0发布矩阵、候选包、接入验证、阶段完成 | 所有必要平台/宿主/CI记录具备 |

表格是后续入口，不是把M4任务算作本轮已经执行。本轮默认停止在SG-077验收报告，公开发布必须另获授权。

## 8. 给 Codex 的首次启动提示词

```text
请执行 docs/plans/2026-09-21-stackgate-m3-completion.md。

原始依据：
docs/specs/stackgate-v0.1.md
docs/plans/2026-09-18-stackgate-v0.1-execution.md

审计基线：17ea7adf10bab9961b96cf3edca255b112bf146b。
这个远程 main 只完成到 SG-051，不能以“M3已经完成”为前提跳到M4。

先读 AGENTS.md、docs/implementation/PROGRESS.md、
docs/implementation/tasks.json 和当前Git状态。
若本地代码更先进，先比较相关路径并逐项验证复用，禁止回滚有效实现或自动合并分支。

本轮优先完成 AUD-000、AUD-001，再推进 AUD-002/003。
之后按依赖实现 SG-052—077；Linux执行能力不足时优先处理AUD-004。
每次只读当前批次所需代码、卡片和协议，不重新生成第二套总架构。

复用现有 RunnerPort、EvidenceStore、EnvironmentPort、Adapter、
PlanService/RunService/GateService 和现有CLI execution.ts。
不允许只删除M2的unsupported blocker或填environment_satisfied=true。

每项先建立真实反例，再实现、跑目标测试和受影响回归。
未执行、缺环境、0测试、损坏报告、旧服务、过期输入不能写为通过。
记录原始退出码、实际用例、前后源码摘要、工具平台、证据和下一任务。
保留原100任务编号；审计新增任务使用独立台账。

不远程push、不创建PR、不公开发布、不生产部署、不使用真实业务凭证、
不调用未经授权的付费模型。发生环境阻塞时记录并继续无依赖工作。
最终汇报实际完成、实际验证、未验证、阻塞和下一READY任务。
```

## 9. 新对话续接提示词

```text
继续 StackGate，不重新规划产品。
读取 AGENTS.md、PROGRESS.md、docs/implementation/tasks.json、
docs/implementation/audit-m3-fixes.json 与当前 git diff。
计划文件：docs/plans/2026-09-21-stackgate-m3-completion.md。

从第一个依赖满足且尚未实际完成的任务继续。
如果此前只有代码、没有真实测试证据，先验证而非直接标DONE。
保持现有契约/权限边界，不重做有证据且未受影响的任务，不做无关重构。
更新真实命令记录、输入身份、缺失平台、下一步；不自动发布或推送。
```

## 10. M3 最终交付清单

- [ ] 审计基线与当前实际实现已逐项核对，未推送内容不被误算到远程main。
- [ ] recorder拥有真实源码内容摘要，旧路径摘要明确兼容语义。
- [ ] Gate中途输入变化反例有实际结果；需要修复时已完成尾部复核。
- [ ] SG-051应用工厂被复用；React示例、Reporter、Probe、后端观察真实运行。
- [ ] 环境来源与健康、实例与数据版本分开判定。
- [ ] 真实Compose动态端口、资源归属、取消/部分失败清理已验证。
- [ ] attach不清理用户原有服务。
- [ ] Plan/Run/Gate使用共同注册与collector，不存在只加执行端不加认证端的旁路。
- [ ] 正常环境清理不修改历史事实，Gate不会重新启动服务验证旧Run。
- [ ] 默认故障单测各自0、真实页面失败；合法修复新run通过；旧run失效。
- [ ] 稳定测试ID、关键断言、flaky、expected-fail、reporter异常均覆盖。
- [ ] 秘密和二进制附件隐私分级、预算及关键证据缺失处理已验证。
- [ ] Windows/WSL/Linux逐格记录；未经实跑组合保持NOT_RUN/BLOCKED。
- [ ] T01—27有真实入口和可核对结果；T28明确P1，不混计。
- [ ] 不少于12个故障夹具可物化并复现；性能有原始样本而非目标值。
- [ ] M3真实阶段出口与范围说明存在，M4宿主/CI/发布仍明确后置。
- [ ] 原设计/原执行计划字节保留，类型/schema/台账/架构地图一致。

## 11. 资料与可追溯来源

**仓库依据：** 配套审计文档的 S01—S26 都绑定固定提交。原 v0.1 计划与本轮保留卡片来自同一内容源；新增 AUD 和“当前代码接入补充”属于本轮提出的实施决定。

**外部核对（2026-09-21）：**

- Playwright 官方 Reporter API：回调、默认导出、onEnd以及异常处理语义；reporter异常不应被假定自动使测试失败。`https://playwright.dev/docs/api/class-reporter`
- Docker 官方 Compose 启动顺序：服务启动与健康就绪不同，需要显式readiness。`https://docs.docker.com/compose/how-tos/startup-order/`
- Linux Kernel cgroup v2：进程归属、委派与终止机制实现参考；具体宿主权限和机制须实测。`https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html`

这些资料只支持外部工具语义，不是StackGate功能已经实现或所有平台安全通过的证明。新增依赖版本必须在真正执行时核对并写入锁文件；不要把资料网页时间当作包版本。

**文档结束：本文件提供实施与验收步骤，不代表已替用户完成编码、完整回归或发布。**
