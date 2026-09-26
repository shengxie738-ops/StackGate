# ADR-012：M3 证据运行时与统一适配器接入

**状态：** 接受（AUD-003）
**日期：** 2026-09-21
**关联：** `docs/plans/StackGate_Next_Steps_M3_Completion_v0.3.md` 第 2.1、2.2 节；`docs/plans/StackGate_Main_Audit_17ea7ad.md` A-04
**基线：** 审计对象 `17ea7adf10bab9961b96cf3edca255b112bf146b`，本地实现起点 `c31b4e0`

## 背景

M2 把“支持的适配器”这一事实分散在三层：`plan-service.ts` 对非 command/JUnit 增加未支持 blocker，`run-service.ts` 只实例化这两个适配器且 `allowed_origins` 为空，`gate-service.ts` 在 `validateCheckPlanBinding` 中按 adapter_id 推断 `result_kind` 并只对这两类做重收集。`run-evaluation.ts` 的 `environment_satisfied` 只允许“无环境需求且不要求后端观察”。`probe-adapter.ts` 对合法报告固定输出 BLOCKED。

M3 要接入真实 FastAPI + React + HTTP Probe + Playwright + 环境来源，如果不先冻结“谁来注册能力、谁来认证事实、事实存在哪里”，最省事的实现路径就是删除这些限制或把外部写来的布尔值当真，这正是审计 A-04 禁止的做法。

## 决策

### 1. 单一 `RuntimeAdapterRegistry` 同时服务计划、执行与认证

`packages/core/src/services/adapter-registry.ts` 导出只读注册表：`get(id)` 未安装工厂返回 `null`，`supportedIds()` 只列出实际可构造的适配器。计划阶段的能力判断、Run 的执行、Gate 的重收集必须查同一实例，不允许出现“执行端已注册、认证端未注册”的不对称通道。

注册项只来自内置且经代码审查的工厂，不从业务配置动态 import 插件。业务仓库里的脚本、 reporter 或 Compose 文件都不能注册适配器。

### 2. 环境事实按阶段追加，不做覆盖式状态

`EvidenceDocument` 的 `kind: 'environment'` 在同一 root scope 下固定写 `documents/environment.json`，存储器会拒绝覆盖既有文档。因此 M3 采用四份互不覆盖的文档：

| kind | 路径 | 内容 |
|---|---|---|
| `environment` | `documents/environment.json` | 准备阶段快照，首次写入后不可变 |
| `environment-finalization` | `documents/environment-finalization.json` | 业务步骤结束后、清理前的最后来源观察 |
| `environment-cleanup` | `documents/environment-cleanup.json` | cleaned/preserved/failed 及归属依据 |
| `environment-assessment` | `documents/environment-assessment.json` | 核心认证结论与其引用的全部证据摘要 |

`RunManifest.environment_ref` 指向最终 assessment 的 artifact id。正常清理产生的 `CLEANED` 不得抹掉先前的 `READY` 观察；历史 Run 的 Gate 只读取封存期间的事实，不为了重验去重启服务。环境连续性由执行期观察与收尾观察共同证明。

### 3. `satisfied` 由核心推导，不接受外部批准

`packages/core/src/services/environment-assessment.ts` 从已认证的 prepare/finalize/cleanup 与链路证据推导结果：来源等级、实例一致性、`data_revision` 关联、观察证据齐备才可能为真。CLI 或脚本传入 `satisfied: true` 不构成输入；schema 合法只证明结构合法，不证明事实成立。多次 readiness 观察作为独立 artifact 保存，最终 assessment 以 `evidence_refs` 引用它们。

### 4. `data_revision` 在 Run 创建前确定

`RunManifest.data_revision` 是不可变字段。M3 要求：在 `createRun` 之前从已确认的 profile/环境/seed 配置取得数据版本；attach 场景若没有可确认的数据版本，则拒绝一切以此为前提的 profile，而不是先写 `local-input-*` 再试图更新。纯本地 M2 profile 保持原逻辑不变。

### 5. Probe 断言是声明式的，核心重算

Probe 自报的 `passed` / `schema_valid` 只作为对照输入。新增 `probe-declaration` schema：只允许已登记的 operation、期望状态/media type，以及 JSON Pointer 上的存在、类型、常量相等与有限数值比较。核心用已认证的响应字节重新计算断言与 schema 结果，不 eval 用户表达式，不接受模型判定。

`backend-observation` 至少绑定 run/check/attempt/request/instance、operation、时间、状态与实际响应字节摘要。响应摘要的输入字节形式固定为“未压缩的 UTF-8 响应体字节”；禁用压缩的测试模板下，客户端不得用重新序列化的不同字节冒充同一响应。Observation 不含 Authorization/Cookie 原值。

### 6. 资源边界先于实现

HTTP 请求默认 5 秒 deadline、响应体上限 1 MiB、默认拒绝重定向；readiness 总 60 秒、单次 2 秒、间隔不超过 500ms。调整这些值必须进入 policy hash。截图/trace 超预算可以不保留，但缺失会影响必需证据时必须拒绝完整通过。

## 后果

- 新增能力必须同时提供执行侧工厂与认证侧 collector，缺一即视为未实现；计划/结果一致性由 `tests/contract/m3-runtime-contracts.test.ts` 约束。
- `pnpm verify:stage -- --stage M3` 仍需在 SG-052—077 全部具备真实证据后才可注册；本 ADR 只冻结协议，不代表 M3 已实现。
- 未安装浏览器或 Docker 的环境上，注册表返回的能力集合就是事实：`supportedIds()` 不含未安装项，相应计划保持 BLOCKED。
- FRESH 语义（AUD-002 之后）对应“返回前最后一次观察时点”，本地目录不是原子快照，不构成对同权限恶意进程的防护证明。
