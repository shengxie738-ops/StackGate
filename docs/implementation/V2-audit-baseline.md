# V2 审计基线记录（V2-R00）

**记录时间：** 2026-09-28（本机 UTC）
**唯一目标分支：** `V2`
**审计基线：** `2791cf5f221d6f917101079332f4231c6a450fa7`（2026-09-26T02:13:30Z）
**配套审计报告：** `docs/plans/StackGate_V2_Audit_2791cf5.md`
**执行计划：** `docs/plans/StackGate_V2_Execution_Plan_v0.4.md`
**补充任务台账：** `docs/implementation/audit-v2-fixes.json`

本文件只记录本轮在工作区里实际观测到的状态。它不是产品通过声明：下面列出的构建失败是当前真实结果。

## 1. 工作区身份（计划 §1.1 实测）

原始输出见 `docs/implementation/evidence/v2-r00-workspace-verification-2026-09-28T06-04-00-000Z.log`。

| 项 | 实际值 |
|---|---|
| `git branch --show-current` | `V2` |
| `git rev-parse HEAD` | `2791cf5f221d6f917101079332f4231c6a450fa7` |
| `git cat-file -e 2791cf5^{commit}` | 退出 0，基线对象在本地存在，因此不需要 `AUDIT_BASE_UNAVAILABLE` |
| `git diff --name-status 2791cf5 -- packages apps scripts schemas tests examples presets docs/implementation` | 空输出：已跟踪路径与审计基线逐字节一致 |
| 未跟踪文件 | 两份计划文档 `docs/plans/StackGate_V2_{Audit_2791cf5,Execution_Plan_v0.4}.md`（用户放入），以及本轮新建的 `v2-r00-*` 证据日志 |
| `node --version` | `v24.11.1`（等于 `package.json` 的 `engines.node`） |
| `pnpm --version` | `11.2.2`（等于 `packageManager`） |

HEAD 就等于审计基线，本地没有领先提交，因此不存在"HEAD 已更新需逐条复现"的分支；审计报告的每一条都按原样重新验证。没有执行 `reset`、`clean` 或任何会覆盖用户改动的命令，两份计划文档保持未跟踪状态。

## 2. 本轮实际运行的基线结果

| 命令 | 退出码 | 观测 | 日志 |
|---|---|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | **2** | `packages/adapter-playwright/src/reporter.ts(3,10): error TS2305: Module './inventory.js' has no exported member 'assertNoCompletedReport'.` | `evidence/v2-r00-typecheck-red-2026-09-28T05-50-00-000Z.log` |
| `node scripts/build.mjs` | **1** | 同一条 TS2305 使 `tsc --project tsconfig.build.json` 失败，`build.mjs:6` 的 `execFileSync` 抛出；`dist/` 里没有 `playwright-reporter.mjs` | `evidence/v2-r00-build-red-2026-09-28T05-52-00-000Z.log` |
| 独立 ESM 加载（esbuild 原样转译 `inventory.ts`/`reporter.ts` 后 `import`） | **1** | `SyntaxError: The requested module './inventory.js' does not provide an export named 'assertNoCompletedReport'` | `evidence/v2-r00-reporter-esm-import-red-2026-09-28T05-56-00-000Z.log` |
| `vitest run tests/contract/m3-runtime-contracts.test.ts tests/integration/probe/http.test.ts` | **0** | 2 个文件 20 个测试通过 | `evidence/v2-r00-target-tests-baseline-2026-09-28T05-57-00-000Z.log` |
| `node scripts/record.mjs V2-R00 probe -- node --version` | **64** | 修复台账支持前，记录器拒绝任何 `V2-R` ID | `evidence/v2-r00-recorder-rejects-v2-ids-red-2026-09-28T06-00-30-000Z.log` |
| 既有 M3 台账验证器对"不可归属证据关闭 DONE"的反应 | **1（反例确认）** | `validateAuditM3Ledger(...)` 返回 `[]`，即它接受 `verification_attributable:false` 且 `source_changed_during_verification:true` 的 PASSED 记录 | `evidence/v2-r00-m3-validator-attributable-gap-red-2026-09-28T06-02-00-000Z.log` |

两条与产品无关的脚手架错误也已留痕，不计入产品缺陷：第一次 ESM 复现用了非 `file://` 绝对路径（Windows ESM 加载器拒绝），第一次归属反例只登记了 `AUD-000`，因此验证器是因缺少 `AUD-001—004` 而拒绝，并没有检验归属规则。前者改正后重跑，后者改名为 `v2-r00-m3-validator-attributable-gap-INVALID-probe1-inconclusive-*` 并附带 `.json` 说明其结论无效，未删除。

## 3. 审计项在本轮的处置

| 审计 ID | 本轮状态 | 依据 | 关闭任务 |
|---|---|---|---|
| V2-F01 Reporter 命名导出缺失 | **OPEN，已在锁定环境复现** | 上表 typecheck/build/ESM 三行 | V2-R01 |
| V2-F02 环境 BLOCKED/ERROR/UNKNOWN 仍 `satisfied` | 未由本轮动态重跑；源码与审计报告一致，现有 `m3-runtime-contracts.test.ts` 的 `baseInput` 恰好把 `observation.request_id` 当作 authenticated ref，掩盖了该缺陷 | 审计 R02—R04 | V2-R05 |
| V2-F03 request ID 冒充 artifact 引用 | 同上，现有测试未覆盖真实存储联通 | 审计 R05 | V2-R06 |
| V2-F04 HTTP 授权未核对实际 path | 未重跑；现有 `tests/integration/probe/http.test.ts` 通过，说明它没有断言错误 path/空声明/fragment 三种拒绝 | 审计 R06/R13 | V2-R02 |
| V2-F05 总期限与隐式代理 | 未重跑；现有 http.test 只测"监听器完全不响应"，测不出持续小包的总期限 | 审计 R11/R12 | V2-R03 |
| V2-F06 继承属性与非有限数字 | 未重跑 | 审计 R07/R08 | V2-R04 |
| V2-F07 Reporter retry/脱敏/覆盖 | 部分与 F01 同源；`reporter.ts:71` 读 `result.retries`，`onEnd` 自行 `renameSync` 覆盖目标 | 源码 + 审计 R09/R10 | V2-R01、SG-053 |
| V2-F08 M3 尚未贯通 | 源码事实：`packages/adapter-playwright` 只有 `inventory.ts`、`reporter.ts`，没有 `index.ts`；`build.mjs` 因 `ENOENT` 静默跳过该入口；仓库内没有 `packages/adapter-compose`；`verify-stage.mjs` 仍只接受 M0/M1/M2 | `scripts/build.mjs:8—14`、`scripts/verify-stage.mjs:21` | SG-055—077 |

绿灯与缺陷并不矛盾：F02—F06 都是**错误接受**型缺陷，当前测试集合没有断言这些拒绝路径，所以 20/20 通过不能反驳审计报告，只说明缺少反例。补充任务因此都从反例开始。

## 4. 已解决的旧审计项与仍然存在的平台阻塞

- 保留不动：AUD-001 的源码指纹（`record.mjs` 的 `source_before/source_after/verification_attributable`）、AUD-002 的 Gate 首尾输入观察、AUD-003 的四类环境证据设计、SG-051/052/054 的已验证实现。本轮不重写它们，只把"不可归属证据可关闭 DONE"这一缺口钉在 V2 台账验证器里。
- `@playwright/test` 仍未安装（`node_modules/@playwright` 不存在，根 `package.json` 无该依赖）：SG-053 的真实浏览器合同测试在本机不可执行，属环境阻塞，不以手写回调对象替代 DONE。
- **与 `BLOCKERS.md` 现有描述不一致：** 本轮 `docker info` 成功（`DOCKER_DAEMON_UP`），而 `BLOCKERS.md` 第 24 行仍写 daemon 未运行。Docker CLI/compose 是否真能拉起测试实例仍**未验证**；这里只更正"daemon 不可连接"这一条已过期的说法，能力声明保持 `UNKNOWN`，不因此放行 SG-057/058/059/061。
- 示例 web 子项目独立锁定 React 19.3.0 / Vite 8.3.0 / Vitest 5.0.1，与根 Vitest 4.0.18 不同；两者分开验证，不互相背书。
- WSL2/Linux、macOS、Job Object 之外的平台执行来源仍未运行。

## 5. 本轮尚未验证

- 完整 `pnpm build`、`pnpm typecheck` 的 GREEN：V2-R00 记录时未执行也不声称；V2-R01 后已在锁定环境实测，见第 6 节。
- 完整测试套件（`pnpm test:unit`、全部 contract/integration）与 `pnpm verify:stage -- --stage M2` 的当前重跑：留到 V2-R07 批次出口。
- V2-F02—F06 的动态重跑：留到各自任务，先建反例再修。
- Docker Compose 的真实启动/端口/清理：daemon 可达不等于能力可用，未运行。

## 6. 修复后的关闭记录（同一文件随任务追加）

上表 §2 与 §3 保持为基线快照，不覆写。当前状态以本节和 `audit-v2-fixes.json` 为准。

**V2-R00 DONE**：`scripts/verify-v2-audit.mjs`、`docs/implementation/audit-v2-fixes.json`、`tests/bootstrap/v2-ledger.test.mjs`、`scripts/update-audit-v2.mjs`、`scripts/record.mjs`。`record.mjs` 现在按台账登记的精确 ID 放行 `V2-R00—V2-R07`；`V2-R99`/`V2-R08` 仍退出 64，且验证器不会因正则形状放行。新验证器额外拒绝"以不可归属证据关闭 DONE"，这是上面第 2 节实测出的 M3 验证器缺口。`pnpm lint` 对新增脚本与测试退出 0。

**V2-R01 DONE**：`packages/adapter-playwright/src/inventory.ts` 现在导出 `assertNoCompletedReport`，并把 `atomicWriteJson` 的提交改为独占临时文件 + `link` 提交（`rename` 会静默毁掉并发获胜者）；`reporter.ts` 改用同一提交原语，构造期一旦发现目标已存在或身份无效就进入不可写状态，`onEnd` 不再触碰目标字节，诊断写入自有 `playwright-reporter-error.json`（同样不许覆盖）；`src/index.ts` 提供默认导出后 `scripts/build.mjs` 真实产出 `dist/playwright-reporter.mjs`。锁定环境结果：`pnpm typecheck` 0、`pnpm build` 0、`pnpm lint` 0（`2791cf5` 上为 1，该条 `require('node:fs')` 已在同一文件里改为静态 ESM 读取，见 `evidence/v2-r01-lint-failure-is-preexisting-at-baseline-*.log`）、`tests/unit/v2/reporter-storage.test.ts` + `tests/contract/playwright-reporter.test.ts` 13 项通过、`pnpm test:unit`（41 个单元文件 + 63 项 bootstrap）通过、`pnpm test:contract` 7 个文件通过、`pnpm verify:boundaries` 165 个产品源文件通过。并发证据：6 个真实子进程同时提交同一 attempt，恰好 1 个成功，其余得到 `STALE_INCOMPLETE_REPORT`，最终字节属于获胜者。

**V2-F07 仍未关闭的部分（属 SG-053，不在 V2-R01 范围）**：`reporter.ts` 仍读取 `result.retries` 而非官方 `TestResult.retry`；`stackgate-requests` 附件读取仍无字节预算；附件仍不实际落盘；`sensitivityFor` 仍只按 MIME 判断；`redact` 的 Bearer 跨空格/多行/缓冲边界仍会残留 canary；`forbidOnly` 与真实 inventory 漂移校验缺失。`@playwright/test` 未安装，因此这些都只能用官方锁定类型的合同测试关闭，不以手写回调替代。

**V2-R02 DONE**：新增 `packages/core/src/services/operation-authorization.ts`（`parseDeclaredOperation` 只校验 `schemas/0.1/common.schema.json` 的 OperationKey 语法，`pathRuleViolation` 决定第一版只支持精确字面量 path），`http-policy.ts` 的 `authorizeRequest` 按固定顺序逐字段判定：origin 规范化 → 允许列表 → policy method → 声明存在 → 声明语法 → service→origin 绑定 → 声明 method → path 子集（先请求后声明）→ path 逐字节相等 → 资源界限。`null` 声明不再放行任何业务探针（`DECLARATION_MISSING`），health check 必须是单独登记的操作。`presets/fastapi-react/scripts/probe_helpers.py` 实现同序同码的 `authorize_request`，`perform_request` 在联网前调用它，并且只从声明拼出实际 URL；`probe_performance.py` 不再 `int()` 强转 `deadline_ms`/`max_response_bytes`，因此字符串、小数、布尔、NaN、Infinity 得到 `DEADLINE_OUT_OF_RANGE`/`RESPONSE_BUDGET_OUT_OF_RANGE` 而不是崩溃或悄悄可用。共享夹具 `tests/fixtures/v2-regressions/http-policy.json`（47 例）同时驱动 TS 与 Python，两边 reason 码一致。

实测：TS 侧三个审计反例（`/different-operation`、null 声明、`#ignored`）修复前全部 `allowed:true`，修复后分别得到 `OPERATION_PATH_MISMATCH`、`DECLARATION_MISSING`、`PATH_FRAGMENT_FORBIDDEN`（`evidence/v2-r02-authorize-request-red-*.log` 与 `-green-*.log`）。真实回环监听侧：两个独立 listener 中任一都不接收未绑定 service 的请求（count 均为 0），被监听器实际观测到的 method/target 与声明逐字节一致，`probe-raw.json` 记录 `request_target`；非整数预算的 5 种输入全部退出 2、写 `probe-error.json`、不产出 `probe.json`、服务器访问计数 0。`pnpm typecheck`/`lint`/`verify:schemas`/`verify:boundaries`/`test:unit`（42 文件 + 63 bootstrap）/`test:contract`（7 文件）退出 0，`tests/integration/probe/http.test.ts` 10 项通过。

**V2-R02 未接线项（留给 SG-062，不声称已完成）**：`authorizeRequest` 目前仍无产品调用方——真实授权发生在 Python helper，TS 侧是共享合同的一侧，注册表/Run 接线在 SG-062；`probe-error.json` 的 reason 码只有测试读取，`collectProbe` 仍把非零退出统一记为 `TOOL_FAILURE`/`ERROR`，未把"授权拒绝"与"工具故障"映射成不同 `CheckResult`；`write_json` 的 no-replace 属 V2-R03。
