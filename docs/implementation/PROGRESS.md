# StackGate implementation progress

当前阶段：M3；阶段完成以实际 stage 出口为准。

完成：SG-001, SG-002, SG-003, SG-004, SG-005, SG-006, SG-007, SG-008, SG-009, SG-010, SG-011, SG-012, SG-013, SG-014, SG-015, SG-016, SG-017, SG-018, SG-019, SG-020, SG-021, SG-022, SG-023, SG-024, SG-025, SG-026, SG-027, SG-028, SG-029, SG-030, SG-031, SG-032, SG-033, SG-034, SG-035, SG-036, SG-037, SG-038, SG-039, SG-040, SG-041, SG-042, SG-043, SG-044, SG-045, SG-046, SG-047, SG-048, SG-049, SG-050, SG-051, SG-052, SG-054

当前：SG-054 DONE

审计修复：M1-R07 DONE；详见 [audit-fixes.json](audit-fixes.json) 与 [M1 修复验收](evidence/M1-audit-summary.md)。

M3 审计任务：AUD-003 DONE；详见 [audit-m3-fixes.json](audit-m3-fixes.json) 与 [M3 入口审计](M3-entry-audit.md)。

下一步：Wire the probe into a real Run in SG-062; the bounded HTTP helper, declaration schema and core recomputation are verified.

## 最近真实验证

- pnpm exec vitest run tests/integration/probe/http.test.ts → 0 (PASSED); [evidence](evidence/sg-054-probe-http-green-2026-09-21T18-35-54-461Z.json)
- pnpm verify:schemas → 0 (PASSED); [evidence](evidence/sg-054-probe-declaration-schema-2026-09-21T18-36-28-032Z.json)
- python -B -E -m py_compile presets/fastapi-react/scripts/probe_helpers.py presets/fastapi-react/scripts/stackgate_observation.py examples/contract-drift-demo/apps/api/scripts/probe_performance.py → 0 (PASSED); [evidence](evidence/sg-054-python-modules-compile-2026-09-21T18-36-36-490Z.json)
- python -B -E -c "import ast,sys\nfor f in sys.argv[1:]:\n    ast.parse(open(f, encoding='utf-8').read(), f)\nprint('parsed', len(sys.argv)-1, 'modules')" presets/fastapi-react/scripts/probe_helpers.py presets/fastapi-react/scripts/stackgate_observation.py examples/contract-drift-demo/apps/api/scripts/probe_performance.py → 0 (PASSED); [evidence](evidence/sg-054-python-syntax-check-2026-09-21T18-36-56-060Z.json)

## 限制与续接

- 原稿、计划保持原字节；历史 commit 字段保留原记录，当前 HEAD 见新证据 repository 字段。
- 未执行的工具/平台/产品流程不视为通过；详见 BLOCKERS.md 与 tools/compatibility-lock.json。
- 每项完整红绿记录见 tasks.json；失败的历史记录保留，不代表修复后的当前状态。
