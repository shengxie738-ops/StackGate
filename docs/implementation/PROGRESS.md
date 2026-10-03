# StackGate implementation progress

当前阶段：M3；阶段完成以实际 stage 出口为准。

完成：SG-001, SG-002, SG-003, SG-004, SG-005, SG-006, SG-007, SG-008, SG-009, SG-010, SG-011, SG-012, SG-013, SG-014, SG-015, SG-016, SG-017, SG-018, SG-019, SG-020, SG-021, SG-022, SG-023, SG-024, SG-025, SG-026, SG-027, SG-028, SG-029, SG-030, SG-031, SG-032, SG-033, SG-034, SG-035, SG-036, SG-037, SG-038, SG-039, SG-040, SG-041, SG-042, SG-043, SG-044, SG-045, SG-046, SG-047, SG-048, SG-049, SG-050, SG-051, SG-052, SG-054

当前：SG-054 DONE

审计修复：M1-R07 DONE；详见 [audit-fixes.json](audit-fixes.json) 与 [M1 修复验收](evidence/M1-audit-summary.md)。

M3 审计任务：AUD-003 DONE；详见 [audit-m3-fixes.json](audit-m3-fixes.json) 与 [M3 入口审计](M3-entry-audit.md)。

V2 审计修复任务：V2-R00、V2-R01、V2-R02、V2-R03、V2-R04、V2-R05 DONE；V2-R06、V2-R07 未完成。详见 [audit-v2-fixes.json](audit-v2-fixes.json) 与 [V2 审计基线](V2-audit-baseline.md)。基线 `2791cf5f221d6f917101079332f4231c6a450fa7` 与当时的本地 HEAD 相同，记录时根 `pnpm typecheck` 退出 2、`pnpm build` 退出 1，这是当时的真实状态，不沿用 M2 的绿色记录。

下一步：V2-R06 —— 用真实 `FileEvidenceStore` 与本 Run 索引重取 prepare/finalization/cleanup/observation/body，建立 `AuthenticatedEnvironmentFacts`，消除 `request_id` 冒充 artifact 引用；注意 digest 边界：`probe_helpers.py` 写入 `sha256:<hex>`，而 `backend-observation.schema.json` 要求裸 64 位十六进制，只能在边界严格识别并转换。

## 最近真实验证

- node tests/support/v2_f06_reverify.mjs head → **1**（对已提交字节复现 V2-F06：`{}` 上 `/constructor`、`/__proto__`、`/toString` 的 exists 全为 true，`Infinity` 满足 `type:number`，`/a/01` 命中数组越界下标，共 5 处错误接受）; [evidence](evidence/v2-r04-f06-reverify-red-at-committed-bytes-2026-10-03T11-44-17-918Z.json)
- node tests/support/v2_f06_reverify.mjs worktree → 0（同上全部拒绝且理由各异：`POINTER_NOT_FOUND`/`TYPE_MISMATCH`/`POINTER_INDEX_INVALID`；而自有 `constructor` 成员与规范下标 `/a/1` 仍正常读取，证明不是关键词黑名单）; [evidence](evidence/v2-r04-f06-reverify-green-worktree-2026-10-03T11-44-21-097Z.json)
- pnpm exec vitest run tests/contract/probe-assertions-parity.test.ts tests/unit/v2/probe-assertions.test.ts → 0 (PASSED)，136 项跨语言对照（97 assertion + 38 parse + 1 覆盖守卫），两侧逐行相等且各自等于夹具期望; [evidence](evidence/v2-r04-parity-and-assertion-suites-2026-10-03T11-43-28-927Z.json)
- pnpm test:contract → 0 (PASSED)，8 个文件 217 项; [evidence](evidence/v2-r04-contract-suite-2026-10-03T11-45-06-227Z.json)
- pnpm typecheck → 0、pnpm lint → 0、verify:schemas/boundaries/tasks/source → 0; [evidence](evidence/v2-r04-root-typecheck-2026-10-03T11-44-49-212Z.json)
- python tests/support/v2_f05_reverify.py head → **1**（同一脚本回到已提交字节复现 V2-F05：100ms 期限在 12617.7ms 后返回 200/608 bytes；未授权代理命中 1、已授权目标命中 0）; [evidence](evidence/v2-r03-v2f05-reverify-red-at-committed-bytes-2026-09-28T08-53-29-487Z.json)
- python tests/support/v2_f05_reverify.py worktree → 0（两条场景同处翻转：109.4ms 得 `DEADLINE_EXCEEDED`；代理命中 0、目标命中 1）; [evidence](evidence/v2-r03-v2f05-reverify-green-worktree-2026-09-28T08-53-47-250Z.json)
- pnpm exec vitest run tests/integration/probe/deadline-proxy.test.ts tests/integration/probe/http.test.ts → 0 (PASSED)，10 + 10 项，全部真实回环监听器与真实 Python 子进程; [evidence](evidence/v2-r03-deadline-proxy-and-probe-suites-2026-09-28T08-48-23-893Z.json)
- pnpm exec vitest run tests/unit/v2/environment-assessment.test.ts tests/contract/m3-runtime-contracts.test.ts → 0 (PASSED)，15 + 18 项; [evidence](evidence/v2-r05-environment-assessment-suites-2026-09-28T08-48-53-366Z.json)
- pnpm verify:schemas（`pnpm generate:types` 之后）→ 0 (PASSED)，34 schemas / 29 fixtures / 生成类型无漂移; [evidence](evidence/v2-r05-generated-types-and-schemas-2026-09-28T08-49-52-821Z.json)
- pnpm test:unit → 0 (PASSED)，43 个单元文件 594 项 + 63 项 bootstrap; [evidence](evidence/v2-r05-unit-suite-2026-09-28T08-49-59-515Z.json)
- pnpm test:contract → 0 (PASSED)，7 个文件 81 项; [evidence](evidence/v2-r05-boundaries-and-contracts-2026-09-28T08-51-35-228Z.json)
- pnpm typecheck → 0 (PASSED); [evidence](evidence/v2-r05-root-typecheck-2026-09-28T08-53-52-827Z.json)
- pnpm exec vitest run tests/unit/v2/http-authorization.test.ts tests/integration/probe/http.test.ts → 0 (PASSED)，54 + 10 项，含两个独立回环 listener 的零访问与 wire method/path 核对; [evidence](evidence/v2-r02-http-authorization-and-probe-suites-final-2026-09-28T07-13-05-679Z.json)
- python -B -E -m py_compile presets/.../probe_helpers.py examples/.../probe_performance.py tests/support/v2_http_policy_cases.py → 0 (PASSED); [evidence](evidence/v2-r02-python-modules-compile-final-2026-09-28T07-13-29-319Z.json)
- pnpm typecheck → 0 (PASSED); [evidence](evidence/v2-r02-root-typecheck-final-2026-09-28T07-13-19-072Z.json)
- pnpm lint → 0 (PASSED)，此前在 `2791cf5` 上因 `packages/adapter-playwright/src/reporter.ts` 的 `require('node:fs')` 退出 1；同一轮失败记录仍保留在 V2-R01 台账中; [evidence](evidence/v2-r01-repo-lint-green-2026-09-28T06-24-45-890Z.json)
- pnpm test:unit → 0 (PASSED)，42 个 Vitest 单元文件与 63 项 bootstrap 测试全通过; [evidence](evidence/v2-r02-unit-and-bootstrap-suite-final-2026-09-28T07-14-35-076Z.json)
- pnpm build → 0 (PASSED)，`dist/playwright-reporter.mjs` 首次真实产出; [evidence](evidence/v2-r01-root-build-final-2026-09-28T06-24-31-654Z.json)
- node --test tests/bootstrap/v2-ledger.test.mjs → 0 (PASSED); [evidence](evidence/v2-r00-ledger-test-2026-09-28T05-59-41-376Z.json)
- pnpm verify:schemas → 0 (PASSED); [evidence](evidence/sg-054-probe-declaration-schema-2026-09-21T18-36-28-032Z.json)
- python -B -E -m py_compile presets/fastapi-react/scripts/probe_helpers.py presets/fastapi-react/scripts/stackgate_observation.py examples/contract-drift-demo/apps/api/scripts/probe_performance.py → 0 (PASSED); [evidence](evidence/sg-054-python-modules-compile-2026-09-21T18-36-36-490Z.json)
- python -B -E -c "import ast,sys\nfor f in sys.argv[1:]:\n    ast.parse(open(f, encoding='utf-8').read(), f)\nprint('parsed', len(sys.argv)-1, 'modules')" presets/fastapi-react/scripts/probe_helpers.py presets/fastapi-react/scripts/stackgate_observation.py examples/contract-drift-demo/apps/api/scripts/probe_performance.py → 0 (PASSED); [evidence](evidence/sg-054-python-syntax-check-2026-09-21T18-36-56-060Z.json)

## 限制与续接

- 原稿、计划保持原字节；历史 commit 字段保留原记录，当前 HEAD 见新证据 repository 字段。
- 未执行的工具/平台/产品流程不视为通过；详见 BLOCKERS.md 与 tools/compatibility-lock.json。
- 每项完整红绿记录见 tasks.json；失败的历史记录保留，不代表修复后的当前状态。
