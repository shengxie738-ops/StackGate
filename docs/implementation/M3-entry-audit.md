# M3 入口审计与基线重建（AUD-000）

**审计基线：** `17ea7adf10bab9961b96cf3edca255b112bf146b`（远程 main）
**本地入口 HEAD：** `c31b4e0e2e4ca2943363855e6099d2f24920a4e8`，分支 `V2`
**记录时间：** 2026-09-21（UTC）
**配套：** `docs/plans/StackGate_Main_Audit_17ea7ad.md`、`docs/plans/StackGate_Next_Steps_M3_Completion_v0.3.md`、台账 `docs/implementation/audit-m3-fixes.json`

## 1. 审计基线可用性

```text
command: git diff --stat 17ea7adf10bab9961b96cf3edca255b112bf146b -- packages apps scripts examples schemas tests docs/implementation
exit:    128
stderr:  fatal: bad object 17ea7adf10bab9961b96cf3edca255b112bf146b
```

结论记为 `AUDIT_BASE_UNAVAILABLE`：该提交对象不在本地对象库中，本次未执行 `git fetch`（计划第 1 节要求不得偷偷 fetch/reset 后声称已完成同等差异比较）。因此下面的范围核对基于本地 HEAD 的实际代码、任务台账与命令行为，而不是与远程 blob 的逐字节 diff。

可用的等价锚点：审计报告记载 `17ea7ad` 是 2026-09-21T15:30:15Z 由 PR #1（自 `V2`）合并进 main 的提交；本地 `V2` 顶端提交 `c31b4e0` 的标题为 "feat: add the real FastAPI sample service and candidate export"，即 SG-051。两者指向同一里程碑边界，且下述三类缺失证据与审计报告逐条吻合，未发现本地领先的 M3 实现。

## 2. Git 状态

```text
git status --short  →  仅两份未跟踪计划文档：
  ?? docs/plans/StackGate_Main_Audit_17ea7ad.md
  ?? docs/plans/StackGate_Next_Steps_M3_Completion_v0.3.md
git rev-parse HEAD  →  c31b4e0e2e4ca2943363855e6099d2f24920a4e8
git branch --show-current → V2
git log --oneline   →  c31b4e0 / aa7f19d / dca78d3 / a90a066 / a651054 / 443f7e1
```

工作区在代码路径上无未提交改动，无需保护用户手写实现；除上述两份计划文档外不存在待复用的隐藏 M3 代码。

## 3. 台账实际完成边界

`docs/implementation/tasks.json`（100 项，`schema_version` 0.1）：

| 范围 | status | actual_files | verification |
|---|---|---|---|
| SG-001—SG-050 | DONE | 非空 | 非空 |
| SG-051 | DONE | 9 | 6 |
| SG-052 | READY | 0 | 0 |
| SG-054 | READY | 0 | 0 |
| SG-053、SG-055—SG-077 | NOT_STARTED | 0 | 0 |
| SG-078—SG-095 | NOT_STARTED | 0 | 0 |

台账允许状态集合为 `NOT_STARTED|READY|IN_PROGRESS|BLOCKED|IMPLEMENTED_UNVERIFIED|DONE`（见 `scripts/verify-tasks.mjs`）。审计新增 ID 只用 `docs/implementation/audit-m3-fixes.json`，不改动原 100 项身份。

## 4. 三类独立缺失证据

目录：`examples/contract-drift-demo/` 只有 `apps/api`（`app/main.py`、`app/models.py`、`scripts/export_openapi.py`、`tests/test_performance.py`、`pyproject.toml`）；无 `apps/web`、无 `compose.test.yaml`、无浏览器用例。`packages/` 为 `adapter-command`、`adapter-git`、`adapter-junit`、`adapter-oasdiff`、`adapter-typescript`、`contracts`、`core`、`reporters`、`runner-local`；无 `adapter-playwright`、无 `adapter-compose`。`presets/fastapi-react/` 只有 `config.template.yaml` 与 `task.template.json`，无 `scripts/probe_helpers.py`、无 `stackgate_observation.py`。

Schema：`schemas/0.1/` 已有 `environment`、`playwright-report`、`probe`、`run-completion`、`artifact` 等 30 项；缺 `environment-finalization`、`environment-cleanup`、`environment-assessment`、`backend-observation`、`probe-declaration`、`benchmark`。

命令：`scripts/verify-stage.mjs:21,70` 只接受 `M0|M1|M2`，其余阶段在任何阶段文件读取前返回 2 并输出 `Unimplemented stage <X>: NOT VERIFIED`；`package.json` 中 `test:acceptance`、`bench`、`pack:local`、`test:package`、`verify:release` 仍指向 `scripts/unimplemented.mjs`。

## 5. 本次真实执行的基线

在锁定版本环境（Node v24.11.1、pnpm 11.2.2，win32-x64）执行：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm verify:source` | 0 | PASSED |
| `pnpm verify:tasks` | 0 | PASSED（100 项、依赖、状态、文件与已记录证据） |
| `pnpm verify:stage -- --stage M2` | 0 | PASSED（历史 M2 组，当前工作区复验） |

未执行项：完整 `pnpm build / typecheck / lint / test:unit / test:contract / test:integration`、SG-051 样例 pytest、Windows Job Object 进程反例、任何浏览器/Compose/全栈流程；这些属于后续批次的目标验证，本次不声称其结果。

## 6. 工具与平台能力（各自独立，不互相背书）

| 能力 | 实测事实 | 可用于 |
|---|---|---|
| native Windows Runner | 主机为 win32 10.0.26200，`packages/runner-local` 走 Job Object 路径 | Windows 真实进程与清理反例 |
| Linux/WSL Runner | `local-runner.ts` 只有 `process.platform === 'win32'` 分支 | 不可用，SG-071/AUD-004 保持阻塞 |
| Docker | CLI 在 `Program Files/Docker/.../docker`；本次未验证 daemon 与 Compose 插件可用性 | Compose 类任务先按未验证处理 |
| Python | 3.14.3 | 样例后端、Probe helper、观察中间件 |
| Playwright | `@playwright/test` 不在 `package.json` 依赖中；用户缓存存在 chromium/firefox/webkit 等多版本浏览器 | 需先实测锁定版本并写入 `tools/compatibility-lock.json`，运行时不联网安装 |
| Node/pnpm | 与 `tools/compatibility-lock.json` 记录一致 | 已认证 |

主机上能运行 node 不等于任一平台认证通过；每条支持声明必须由该平台的真实执行结果支撑。

## 7. 起点纠正与下一步

导航修正为：**M1/M2 有历史与当前基线支持；M3 仅 SG-051 完成；SG-052/054 已解锁但未实现；M3 校验器未注册；M4 未解锁。**

下一可执行任务顺序：AUD-000 复验收口 → AUD-001（recorder 源码内容摘要，见 `tests/bootstrap/a02-baseline-repro.mjs` 的基线反例）→ AUD-002/AUD-003 → SG-052—055。

## 8. AUD-001 至 AUD-003 的实际结果

### AUD-001（A-02 源码指纹）

基线反例 `node tests/bootstrap/a02-baseline-repro.mjs`（临时 Git 仓库，真实字节）：

```text
legacy_repository_identity_before == after : true
  head            5bc27e07…（同一提交）
  worktree_digest b4014b3b…（同一值，实为仓库路径摘要）
independent_content_sha256  apps/api/main.py : 585c9366… → a8f6c52a…
                             apps/web/extra.ts : null → dfb8cba1…（新增未跟踪）
new_source_content_hash     : sha256:4da760f6… → sha256:ff47edd5…
conclusion : AUDIT_BASE_CONFIRMED（旧字段无法区分两份被验证的源码）
exit 0
```

修复后语义：`repository.repo_path_id` 保留旧含义，`worktree_digest` 同名兼容并附
`worktree_digest_semantics: LEGACY_REPOSITORY_PATH_IDENTITY_NOT_SOURCE_CONTENT`；
新增 `source_before/source_after` 清单（路径、mode、逐文件 SHA-256、tracked/index/untracked
状态、显式排除项）与 `content_hash`；命令退出码原样保留，但
`verification_attributable` 只在退出 0、前后快照均 COMPLETE 且内容一致时为真。

反例覆盖（`tests/bootstrap/record-identity.test.mjs`，11 项全绿）：同 HEAD 改跟踪文件、
增删未跟踪输入、staged 与 unstaged 分类（修掉一处把 `git diff HEAD` 当 unstaged 的误判）、
CRLF/UTF-8 原始字节、含空格与元字符路径不被拆分、只写证据目录不自我失效、
缓存排除但锁文件仍计入、超预算文件标 INCOMPLETE 而非静默跳过、
staged 删除标为缺失输入、退出码 7 原样保留、源码中途变化拒绝归因、
`SG-101/SG-000/AUD-999/ARBITRARY` 退出 64 而 `M1-R07`/已登记 `AUD-00x` 放行。

### AUD-002（A-03 Gate 尾部复核）

修复前真实反例（`tests/integration/gate/during-evaluation-change.test.ts`，退出 1）：

```text
✓ keeps a normal sealed run allowed when the collector only observes        (对照，防误报)
× refuses to certify a protected input that changed during evidence re-collection
    AssertionError: expected 'ALLOW' to be 'DENY'
× reports an unobservable current input as unverified instead of a tampered history
    AssertionError: expected ALLOW to be DENY
✓ leaves the sealed run bytes untouched while authenticating
Tests 2 failed | 2 passed (4)
```

即 A-03 由 `RISK_TO_REPRODUCE` 升级为 **LOCAL_REPRODUCED：认证途中改受保护输入，Gate 确实返回 ALLOW/0**。

修复只调整时序末端：`inspect()` 现在在证据重收集之后、返回 evaluation 之前再做一次当前输入与授权观察，
以最后一次观察计算 freshness（内容变化 → STALE/4；当前输入不可观察 → UNVERIFIED，不误判为历史被篡改），
并在 `reasons` 增加 `INPUT_CHANGED_DURING_AUTHENTICATION`；`post_task_confirmed`/`post_trust_valid`
需两次观察同时成立。修复后同一文件 4/4 通过（含对照与 seal 字节不变断言）。

边界：本地目录仍不是原子快照或 OS 安全边界，FRESH 只代表“返回前最后一次观察时点”；
严格防护属于受控 CI 检出，不作为阻止同权限恶意进程的证明。

### AUD-003（M3 事实协议与统一接入）

`docs/adr/ADR-012-m3-evidence-runtime.md` 冻结协议；新增 5 份 schema 与生成类型（`pnpm verify:schemas`：34 schemas / 29 fixtures，无类型漂移）；
`RuntimeAdapterRegistry` 同时服务计划与认证，未安装工厂返回 `null` 且不进 `supportedIds()`；
环境事实拆成 `environment`（准备快照）+ `environment-finalization` + `environment-cleanup` + `environment-assessment`
四份互不覆盖的文档，`FileEvidenceStore` 读取时校验这些文档的 `run_id` 归属；
`assessEnvironment()` 只输出结论，不接受外部布尔：契约测试期间由反例暴露并修复了一处真实缺陷
（准备/收尾/清理文档缺失时仍判 satisfied），现要求引用存在且指向核心已认证字节。
`tests/contract` 全量 71/71、`pnpm test:unit` 49/49、`pnpm typecheck` 0、`pnpm verify:boundaries` 0（160 个产品源文件）。

未包含在本轮：Playwright/Compose/Probe/React 的真实实现（SG-052 起）、Linux 受控 Runner（AUD-004）、
`data_revision` 在 `createRun` 前的取值改造与 `RunService`/`PlanService` 的注册表接线（SG-062）。

