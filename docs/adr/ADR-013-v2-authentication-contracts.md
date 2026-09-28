# ADR-013：V2 认证契约与环境要求确认

**状态：** 接受（V2-R05 落地环境与要求确认部分；V2-R06 追加证据认证工厂部分）
**日期：** 2026-09-22
**关联：** `docs/plans/StackGate_V2_Execution_Plan_v0.4.md` 第 1.2、2.4、2.6、4 节与 V2-R05/V2-R06 任务卡；`docs/plans/StackGate_V2_Audit_2791cf5.md` 第 6 节（V2-F02）、第 7 节（V2-F03）；ADR-012 第 2、3 节
**基线：** 分支 `V2`，V2-R00—V2-R02 已提交后的工作树

## 背景

`assessEnvironment` 是环境结论的唯一确定性入口，但 V2-F02 复现出四类缺陷：`prepare.status` 从未被读取；没有显式最低来源等级，混合 `OBSERVED`/`CONTROLLED` 会同时返回 `satisfied:true` 与 `provenance:DECLARED`；`required_by_task:false` 且无环境文档时直接成功，即使仍要求后端观察；cleanup 只看聚合标签，不逐项核对自有资源集合。第 2.4 节要求把“要求”“证据”“结论”分开，本 ADR 记录 V2-R05 实际改动以及旧 0.1 证据的读取行为。

## 决策

### 1. `ConfirmedEnvironmentRequirements` 是唯一的需求来源

`packages/core/src/services/environment-assessment.ts` 导出计划第 2.4 节固定名称的类型，字段为 `required_by_profile`、`required_by_task`、`requires_backend_observation`、`minimum_provenance`、`expected_data_revision`、`expected_origins`、`required_operations`。原先散落在 `EnvironmentAssessmentInput` 顶层的 `required_by_task`、`requires_backend_observation`、`expected_data_revision`、`required_operations` 已移入该对象；调用方（当前只有 `tests/contract/m3-runtime-contracts.test.ts` 与 `tests/unit/v2/environment-assessment.test.ts`）同步更新。

输入同时新增 `run_window: { started_at, finished_at } | null`：finalization 与 cleanup 的时间必须落在本次 Run 区间内，否则拒绝（`ENV_FINALIZE_OUT_OF_RUN_WINDOW`、`ENV_CLEANUP_OUT_OF_RUN_WINDOW`、`ENV_CLEANUP_BEFORE_FINALIZE`）；调用方给不出区间时得到 `ENV_RUN_WINDOW_UNAVAILABLE`，不允许静默跳过时间核验。`assessEnvironment` 仍是纯函数：不访问文件系统、网络、子进程或系统时钟。

### 2. 只有 READY 的准备事实可以进入业务准备成功

`prepare.status === 'READY'` 是唯一成功入口。`BLOCKED`/`ERROR`/`UNKNOWN` 产生 `ENV_PREPARE_NOT_READY`；`CLEANED` 产生 `ENV_PREPARE_HISTORY_OVERWRITTEN`，因为 ADR-012 第 2 节规定 `documents/environment.json` 首次写入后不可覆盖，准备快照自称 CLEANED 说明历史 READY 已被抹掉。清理产生的 CLEANED 只写在自己的文档里，不改变历史 READY。prepare 文档自带的非空 `reasons` 也不再可忽略（`ENV_PREPARE_REASONS_UNRESOLVED`）。

### 3. 来源等级取最弱，再与已确认最低等级比较，CONTROLLED 不由自报升级

等级序为 `DECLARED < OBSERVED < CONTROLLED`。先取 prepare 与 finalization 两份文档声明的**最弱**等级，再与本 Run 核心能够认证的等级取上限，最后与 `minimum_provenance` 比较。核心认证上限当前固定为 `OBSERVED`：应用在自己 JSON 里写 `CONTROLLED` 只是声明，真正的 CONTROLLED 需要可信执行上下文证明（V2-R06 与 SG-056/058 提供），因此本函数**永不**输出 CONTROLLED，也不会让自报 CONTROLLED 通过 CONTROLLED 门槛。不足时产生 `ENV_PROVENANCE_INSUFFICIENT`，若失败原因包含无法认证的 CONTROLLED 声明，额外产生 `ENV_PROVENANCE_NOT_CERTIFIED`。

### 4. 无环境是独立分支，矛盾配置是前提错误

只有当 profile/任务都不要求环境，且 `requires_backend_observation`、`minimum_provenance`、`expected_data_revision`、`expected_origins`、`required_operations` 全部为空/最低时，才走“不需要环境”分支；该分支返回 `satisfied:true`、`environment_required:false`、三份文档引用为 `null`、`observation_refs:[]`，绝不写入 `missing` 或 `none` 占位符。若 profile/任务为 false 但任一其它字段仍在要求环境，核心抛出既有的 `ServiceError(exit_code 64)` 配置/前提错误（`configurationError`），不再靠“调用方永远不会这样传”掩盖矛盾。要求环境但需求文档在输入里存在时仍走完整核验：未被确认的 origin（`expected_origins` 为 null 而文档报了 origin）按 `ENV_*_ORIGIN_MISMATCH` 拒绝。

### 5. cleanup 与 prepare 资源台账双向逐项核对

以 `resource_type + native_id` 为键，prepare 的每个自有资源必须在 cleanup 中出现（缺项为 `ENV_CLEANUP_RESOURCE_UNREPORTED`），cleanup 报告的每个资源必须在台账中有对应项（多项为 `ENV_CLEANUP_RESOURCE_UNMATCHED`，无论归属）。匹配项逐一核对 `owner_token`、`created_by_stackgate`、`creation_identity`、`created_at` 与 `run_id` scope，不一致为 `ENV_CLEANUP_RESOURCE_IDENTITY_MISMATCH`/`ENV_CLEANUP_RESOURCE_SCOPE`/`ENV_RESOURCE_SCOPE_MISMATCH`；自有资源的上报项缺少 `creation_identity` 视为无法核验（`ENV_CLEANUP_IDENTITY_UNREPORTED`）。逐项状态不可忽略：`PENDING`/自有 `PRESERVED` → `ENV_CLEANUP_INCOMPLETE`，`FAILED` → `ENV_CLEANUP_FAILED`，`UNKNOWN` → `ENV_CLEANUP_UNVERIFIED`，聚合 `PARTIAL` 同样拒绝；非自有资源被删为 `ENV_CLEANUP_PRESERVED_BOUNDARY`；cleanup 文档时间早于台账记录的创建时间为 `ENV_CLEANUP_BEFORE_CREATION`。

### 6. 协议变更与旧 0.1 证据读取

`pnpm generate:types` 重新生成类型，未手改 `packages/contracts/src/generated/` 下任何文件。

- `schemas/0.1/environment-assessment.schema.json`：`prepare_ref`/`finalization_ref`/`cleanup_ref` 允许 `null`；`observation_refs` 顶层 `minItems` 放宽为 0；新增可选布尔字段 `environment_required`；新增条件规则——`satisfied:true` 时必须二选一：引用三份文档 + 至少一条 observation 引用，或者显式 `environment_required:false` 且零引用。失败结论允许引用集合为空，但不允许伪造引用。
- `schemas/0.1/environment-cleanup.schema.json`：资源项新增可选 `creation_identity` 与 `created_at`，用于与 prepare 台账逐项对齐。

兼容行为：`environment_required` 不在 `required` 列表内，旧 0.1 assessment 文档继续通过 schema 校验并可读取；字段缺失时按“引用了环境证据”的最严格形状解释，因此旧文档不会因缺失字段获得任何新的信任。旧文档里的 `none`/`missing` 占位符不再有自动认证豁免——`assessmentReferencesAuthentic` 现在要求每一项都能在核心给出的 `authenticated_refs` 中找到，且出现 `null` 时只有 `environment_required:false`（零引用）才算自洽。未知字段仍被 `additionalProperties:false` 拒绝，不会被静默赋予含义。重新验收必须重新计算，不能把旧结论当成本 Run 的事实。

`assessmentReferencesAuthentic(assessment, authenticated_refs)` 的签名保持不变。V2-R06 将其降级为补充检查。

## 尚未在本 ADR 覆盖（V2-R06）

`packages/core/src/services/authenticate-environment-evidence.ts` 将新增 `EvidenceDocumentRef`、`ExpectedRequest`、`AuthenticatedEnvironmentFacts` 与 `authenticateEnvironmentEvidence(...)` 工厂，用 `EvidenceReader.read` 按本 Run 索引重取真实 artifact 字节，校验 run/check/attempt/文档种类/相对路径/size/digest/时间与请求身份后，把**真实 artifact 引用**喂给本函数的 `prepare_ref`、`finalization_ref`、`cleanup_ref`、`authenticated_refs` 与 `authenticated_digests`，并提供 CONTROLLED 所需的执行上下文证明。V2-F03 的另一半仍留在 R06：当前 `observation.request_id` 仍被写入 `observation_refs`（`tests/contract/m3-runtime-contracts.test.ts` 的 `baseInput` 也把 `request_id` 放进 `authenticated_refs`，人工制造了 request/artifact 同 id 的条件），真实存储打通前不得据此宣称引用已认证。

## 后果

- 环境结论现在要求：READY、来源等级、实例与 origin 连续性、数据版本、运行时间区间、证据引用与资源收尾全部独立成立；缺任一项即不满足。
- 无环境 profile 不再需要伪造成交文档；`environment_required:false` 是唯一合法的零引用形状。
- 需要 CONTROLLED 门槛的 profile 在 V2-R06 之前必然被拒，这是有意的：不得由应用自报升级来源等级。
- 契约与单元测试位置：`tests/contract/m3-runtime-contracts.test.ts`（复用 `baseInput`）与 `tests/unit/v2/environment-assessment.test.ts`（自建夹具）。
