# M2 acceptance summary

阶段：M2（SG-029—SG-050）。基线提交 `a90a066`；本轮收口改动已提交为 V1 分支 `dca78d3`，未合并 `main`、未推送。
M2 只覆盖执行器、证据、Gate、报告与交接。M2 完成不等于 StackGate MVP 完成：真实后端来源、
浏览器、Compose 与 FastAPI/React 链路仍属 M3，本文件不声明其可用。

## 阶段出口

`pnpm verify:stage -- --stage M2` 实际退出 0，13 项注册检查全部退出 0，
清单见 [m2-stage-2026-09-20T18-52-53-834Z.json](m2-stage-2026-09-20T18-52-53-834Z.json)，
命令与仓库身份见 [sg-050-m2-stage-exit](sg-050-m2-stage-exit-2026-09-20T18-06-18-967Z.json)。
平台 `win32-x64`，`runtime` 字段由 `integration`/`m2-runner`/`m2-evidence`/`m2-gate` 的实际退出推导，
不再是硬编码值。

| 检查 | 退出 | 实测 |
|---|---|---|
| source / tasks / schemas / boundaries | 0 | 原稿字节摘要一致；100 项任务账本自洽；29 个 Schema、19 个夹具、生成类型无漂移，7 份 OpenAPI 文档；边界无反向依赖 |
| build / typecheck / lint | 0 | cli、contracts、core 产物；`tsc --noEmit`；`eslint .` |
| unit | 0 | Vitest 518 项（40 文件）+ Node 原生开发工具反例 29 项，零失败零跳过 |
| contract | 0 | 57 项（5 文件） |
| integration | 0 | 237 项（34 文件），2172 秒 |
| m2-runner | 0 | 23 项（真实进程 Runner 与命令解析兼容性；为 integration 子集的定向复跑） |
| m2-evidence | 0 | 42 项（存储、脱敏与预算、兼容读取；子集定向复跑） |
| m2-gate | 0 | 7 项（Gate 再认证与 Run 评估；子集定向复跑） |

独立覆盖计数为 518 + 29 + 57 + 237 = 841 项；三个 `m2-*` 组是 integration 子集的定向复跑，
不叠加进独立覆盖数。

## 本轮实测（record.mjs 真实命令、退出码与日志）

| 任务 | 命令 | 实际结果 |
|---|---|---|
| SG-040 | `vitest run tests/integration/gate/current-state.test.ts` | 6 passed，零跳过（此前记录用 `-t` 过滤只跑 2 项、跳过 4 项，本轮改为整文件） |
| SG-040 | `vitest run tests/unit/gate/command-provenance.test.ts tests/unit/gate/plan-binding.test.ts` | 23 passed |
| SG-040 | `pnpm typecheck` / `pnpm lint` | 均退出 0 |
| SG-039 | `vitest run tests/integration/run/lifecycle.test.ts` | 8 passed |
| SG-041 | `vitest run tests/unit/reports/json.test.ts tests/unit/reports/terminal.test.ts` | 4 passed |
| SG-042 | `vitest run tests/unit/reports/markdown.test.ts tests/unit/reports/junit-output.test.ts tests/unit/reports/consistency.test.ts` | 3 passed，含新增四渲染器一致性用例 |
| SG-043 | `vitest run tests/integration/handoff.test.ts` | 3 passed |
| SG-043 | `vitest run tests/integration/storage/completion.test.ts` | 3 passed，含新增封存后写入拒绝反例 |
| SG-044 | `pnpm build` + `vitest run tests/integration/cli/m2.test.ts` | 3 passed：参数校验 64、构建后 CLI 全链路（确认→授权→计划→真实运行→四种报告→Gate→交接→源码变化后 STALE/4 且 report 仍 0）、失败 Run 的退出码分离（run 1 / report 0 / gate 1 / 缺失证据 report 2 / 篡改包 3 / 非包文件 64 / 参数错误 64） |
| SG-045 | `vitest run tests/integration/cleanup/process-resources.test.ts` | 13 passed |
| SG-047 | `vitest run tests/contract/schema-compatibility.test.ts tests/unit/run-evaluation.test.ts` | 5 passed |
| SG-048 | `vitest run tests/integration/runner/negative-matrix.test.ts` | 27 passed（v0.2 要求的 20 个场景全部在册，另含原任务卡补充反例） |
| SG-049 | `vitest run tests/integration/run/crash.test.ts tests/integration/run/concurrent-runs.test.ts tests/integration/run/finalization-race.test.ts` | 13 passed |

并发上限固定为 2 后的最终阶段结果：单元 518 项、开发工具反例 29 项、合同 57 项、集成 237 项，
零失败零跳过。此前一次默认并发（`cores-1`）的整套件运行出现 10 例超时，全部为越过时限而非断言不符，
详见下节。过滤运行中的 skipped 不计入任何通过声明。

## 本轮发现并修复

1. `vitest.config.ts` 里的 `test.poolOptions` 在 Vitest 4 已被移除且静默忽略，并发限制实际未生效；
   改为顶层 `maxWorkers: 2` 后，默认并发下 10 个超时用例只余 1 个。
2. 该剩余用例 `authenticates a real sealed run ...` 在 240000ms 预算上以 240022ms 越限；
   它真实执行一次 Run 后进行 8 次完整 Gate 再认证，属工作量而非缺陷，故把该文件的 harness 预算提高到
   600000ms，并用整文件重跑证明可通过（6 passed）。产品内命令超时、必检集合与目标契约未放宽。
3. `scripts/verify-stage.mjs` 对 M2 硬编码 `runtime:'EXECUTED'`。改为 `stageRuntime()` 由
   `integration`/`m2-runner`/`m2-evidence`/`m2-gate` 实际退出 0 推导，并补三项反例测试。
4. 封存后 `append`/`store`/`updateManifest` 一律拒绝在生产码中已实现，但没有任何测试断言；
   已在 `tests/integration/storage/completion.test.ts` 补反例（append 返回 ERROR/TARGET_EXISTS，
   store 与 updateManifest 拒绝，事件数与 seal 校验不变）。
5. `handoff --validate PATH --json` 是 v0.1 §7.8 的 CLI 合同项，此前只在 core 有 `validateHandoff`，
   CLI 无入口；`handoff --run` 也未写派生文件、未输出 `handoff_id`/`handoff_json_path`/
   `handoff_markdown_path`/`freshness`。本轮补齐，并覆盖：`--run` 与 `--validate` 互斥、
   `--validate` 拒绝 `--output`、只读不重跑检查、身份不符仍退出 0、重复派生写不覆盖既有字节、
   异克隆缺 plan 时给出 `CURRENT_IDENTITY_UNAVAILABLE` 且退出 0。
   失败码沿用仓库既有分工：可解析但摘要/身份被改的包按完整性以 3 拒绝；连版本化文档都不是的
   Markdown 文本按结构以 64 拒绝（与 `task validate` 面对无法解析输入一致）。两者都不输出 `data`，
   即不会给出伪 valid。
6. 新增四 renderer 一致性用例：JSON/terminal/Markdown/JUnit 对 decision、verdict、freshness、
   exit code 与 reasons 必须投影同一结论，JUnit 的 `<testsuite>` 计数不成为第二套判定。
7. 分类规则写入 `docs/diagnostics/check-classification.md`，SG-042 "JUnit 展示不决定 job 状态"
   由代码注释升级为对外文档。

保留的失败记录（不改写历史）：
`sg-044-cli-handoff-and-exit-codes-2026-09-20T17-43-47-824Z`（退出 1）是新 handoff 用例首次实跑，
断言把"收到的文件根本不是版本化交接包"也期望为完整性错误 3；实测为结构解析错误 64，
是断言写错而非产品缺陷，修正期望后由
`sg-044-cli-handoff-and-exit-codes-final-2026-09-20T17-56-33-932Z`（退出 0，3 passed）覆盖。

## 已知偏差（不改代码，记录在此）

- SG-044 卡片列出 `apps/cli/src/commands/{plan,run,report,gate,handoff}.ts`，实现为单一
  `apps/cli/src/commands/execution.ts` 导出六个命令函数；SG-044/SG-050 卡片指定的测试文件名
  `tests/integration/cli/execution-workflow.test.ts`、`tests/integration/stages/m2.test.ts`
  在实施中分别由 `tests/integration/cli/m2.test.ts`、`tests/integration/stages/m2-local-flow.test.ts`
  承担。功能与反例均已实测，未为对齐文件名而重排测试身份。
- 首屏排序以 v0.2 的九段式实现，它是 v0.1 "结论→被测状态→阻塞→未验证→复现" 的细化超集。
- SG-047 同时按 v0.1（版本兼容读取、非覆盖导出）与 v0.2（工具 provenance 汇总）验收，取并集。

## v0.2 §35 完成定义逐项对照

13 项注册检查覆盖下列全部用例；标注"本轮记录"者另有独立 `record.mjs` 证据。

| # | 条目 | 证据 |
|---|---|---|
| 1 | M1 四个审计问题已修复 | `audit-fixes.json` M1-R00—R07 全 DONE |
| 2 | M1 stage 重新真实通过 | `m1-r07-full-stage-2026-09-20T13-46-48-536Z.json` 退出 0 |
| 3 | Runner 使用真实子进程 | `tests/integration/runner/process.test.ts` |
| 4 | Runner 不使用任意 shell 拼接 | 全仓 `shell:false`，产品码无 `shell:true`；`tests/compatibility/command-resolver.test.ts` |
| 5 | EvidenceStore 已实际持久化 | `tests/integration/storage/store.test.ts` |
| 6 | event_id 幂等 | `tests/integration/run/concurrent-runs.test.ts` 跨进程相同事件 APPENDED/DUPLICATE |
| 7 | 证据可以 seal | `tests/integration/storage/completion.test.ts`（本轮记录） |
| 8 | seal 后不能修改事实 | 同上，本轮新增 append/store/updateManifest 拒绝反例 |
| 9 | DAG cycle 被拒绝 | `tests/unit/plan/dag.test.ts` |
| 10 | dependency BLOCKED 传播正确 | `tests/unit/runner/scheduler.test.ts` |
| 11 | resource lock 实际工作 | `tests/integration/runner/locks.test.ts` + `run/concurrent-runs.test.ts` |
| 12 | command adapter 工作 | `tests/integration/adapters/command.test.ts` |
| 13 | JUnit 真实解析 | `tests/integration/adapters/junit.test.ts`（saxes） |
| 14 | 0 test 不 PASS | 反例矩阵 `zero junit` → INCOMPLETE/2（本轮记录） |
| 15 | missing report 不 PASS | `missing junit` → INCOMPLETE/2 |
| 16 | skipped required 不 PASS | `skipped required` → INCOMPLETE/2 |
| 17 | flaky 不被压成普通 PASS | `tests/unit/gate/acceptance-boundaries.test.ts`、`truth-table.test.ts` |
| 18 | RunService 运行前身份验证 | `tests/integration/run/lifecycle.test.ts`（本轮记录） |
| 19 | RunService 运行后 freshness 复核 | 同上 |
| 20 | GateService 重新验证 current state | `tests/integration/gate/current-state.test.ts`（本轮整文件记录） |
| 21 | evidence corrupted 被发现 | 矩阵 `evidence corrupt` → ERROR/3 |
| 22 | stale 返回 exit 4 | 矩阵 `stale input` + 构建后 CLI 全链路 |
| 23 | FAIL 返回 exit 1 | 矩阵 `command nonzero` + CLI 失败 Run 流 |
| 24 | INCOMPLETE 返回 exit 2 | `m2-local-flow` zero/missing/cancel + CLI 缺失证据 report |
| 25 | internal/evidence ERROR 返回 exit 3 | 矩阵 `spawn failure`/`malformed junit`/`output overflow` + CLI 篡改包 |
| 26 | config invalid 返回 64 | `tests/integration/cli/json-envelope.test.ts` + CLI 参数反例 |
| 27 | JSON error contract 稳定 | 同上（整输出解析、无 ANSI、无第二段 JSON） |
| 28 | report 不会改变 run facts | CLI e2e 断言 seal 字节不变；`handoff.test.ts` 断言封存清单不变 |
| 29 | handoff 不包含凭证 | `tests/integration/handoff.test.ts` canary 排除与不可信数据标注 |
| 30 | cancel 保留已有证据 | `m2-local-flow` 取消流 + 矩阵 `cancel`/`user canceled` |
| 31 | 并发 append 不损坏 JSONL | `tests/integration/run/concurrent-runs.test.ts` |
| 32 | temp write crash 不覆盖最后好文件 | `tests/integration/run/crash.test.ts` |
| 33 | M2 integration fixture 使用真实 subprocess | `tests/integration/fixtures/local-run-project.test.ts`、`stages/m2-local-flow.test.ts` |
| 34 | 完整 `pnpm verify:stage -- --stage M2` 实际退出 0 | 见"阶段出口"节 |
| 35 | M3 能力仍明确 NOT_EXECUTED / UNVERIFIED | `packages/core/src/services/adapters/probe-adapter.ts` 对任何 Probe 结果固定追加 `ENV_PROVENANCE_INSUFFICIENT` 与 `DECLARED_ASSERTIONS_NOT_AUTHENTICATED`；环境步骤在计划中保留为显式阻塞；`tools/compatibility-lock.json` 中 playwright 与 docker-compose 仍为 `UNKNOWN`；见 `BLOCKERS.md` 与 `docs/COMPATIBILITY.md` |

## 未验证与边界

- 平台：仅 `win32-x64` 实测。Linux/WSL/macOS、网络文件系统、断电持久性、反复清理 I/O 故障未验证；
  Windows 进程来源认证（Job Object、创建身份、owner token）在非 win32 平台不成立。
- 本地授权记录不是 OS 沙箱，也不是抵御同用户恶意进程的签名体系。
- 未运行真实 HTTP Probe 来源、浏览器、Compose 服务与 FastAPI/React 链路；Playwright 与
  docker-compose 能力仍为 `UNKNOWN`。Probe 仅完成协议收集与校验。
- 正式打包、宿主加载与 T01—T27 端到端验收未执行。
- 证据可追溯性限制：`record.mjs` 的 `worktree_digest` 只哈希工作树路径字符串，无法证明被验证的
  文件内容；`repository.head` 记录当时 HEAD（本轮为 `a90a066`）。`dist/` 与
  `.stackgate-saxes-patch/` 均在 `.gitignore` 内，补丁的正式声明由
  `patches/saxes@6.0.0.patch` 与锁文件固定。
