# StackGate implementation progress

当前阶段：M3；阶段完成以实际 stage 出口为准。

完成：SG-001, SG-002, SG-003, SG-004, SG-005, SG-006, SG-007, SG-008, SG-009, SG-010, SG-011, SG-012, SG-013, SG-014, SG-015, SG-016, SG-017, SG-018, SG-019, SG-020, SG-021, SG-022, SG-023, SG-024, SG-025, SG-026, SG-027, SG-028, SG-029, SG-030, SG-031, SG-032, SG-033, SG-034, SG-035, SG-036, SG-037, SG-038, SG-039, SG-040, SG-041, SG-042, SG-043, SG-044, SG-045, SG-046, SG-047, SG-048, SG-049, SG-050, SG-051, SG-052, SG-054

当前：SG-054 DONE

审计修复：M1-R07 DONE；详见 [audit-fixes.json](audit-fixes.json) 与 [M1 修复验收](evidence/M1-audit-summary.md)。

M3 审计任务：AUD-003 DONE；详见 [audit-m3-fixes.json](audit-m3-fixes.json) 与 [M3 入口审计](M3-entry-audit.md)。

V2 审计修复任务：V2-R00 DONE、V2-R01 DONE、V2-R02 DONE（V2-R03—V2-R07 NOT_STARTED）；详见 [audit-v2-fixes.json](audit-v2-fixes.json) 与 [V2 审计基线](V2-audit-baseline.md)。基线 `2791cf5f221d6f917101079332f4231c6a450fa7` 与本地 HEAD 相同，记录时根 `pnpm typecheck` 退出 2、`pnpm build` 退出 1，这是当时的真实状态，不沿用 M2 的绿色记录。

下一步：V2-R03 —— 在 probe helper 中实施单调时钟绝对请求期限、显式禁用系统与环境代理、有界响应写入与私有工作进程回收；现有 `http.test.ts` 只测"监听器完全不响应"，测不出持续小包下的总期限。

## 最近真实验证

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
