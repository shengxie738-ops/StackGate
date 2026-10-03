# ADR-013：V2 认证契约与环境要求确认

**状态：** 接受（V2-R05 落地环境与要求确认部分；V2-R06 落地证据认证工厂与真实引用部分）
**日期：** 2026-09-28
**关联：** `docs/plans/StackGate_V2_Execution_Plan_v0.4.md` 第 1.2、2.4、2.5、2.6、4 节与 V2-R05/V2-R06 任务卡；`docs/plans/StackGate_V2_Audit_2791cf5.md` 第 6 节（V2-F02）、第 7 节（V2-F03）；ADR-012 第 2、3、5 节
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

## V2-R06 落地：证据认证工厂与真实 artifact 引用

**代码：** `packages/core/src/services/authenticate-environment-evidence.ts`；输入类型变更在 `environment-assessment.ts`；集成证明在 `tests/integration/environment/evidence-authentication.test.ts`（真实 `FileEvidenceStore` + OS 临时 state root），调用点适配在 `tests/contract/m3-runtime-contracts.test.ts` 与 `tests/unit/v2/environment-assessment.test.ts`。

### 7. 工厂导出的名称与形状（第 2.4 节固定名）

`EvidenceDocumentRef {artifact_id, relative_path, digest}`、`ExpectedRequest {run_id, check_id, attempt_id, request_id, operation_key, instance_id, status_code, media_type, response_ref, observation_ref}`、`AuthenticatedEnvironmentFacts`、`authenticateEnvironmentEvidence({run_id, input_hash, requirements, prepare_ref, finalization_ref, cleanup_ref, requests, reader, artifact_index})` 都按第 2.4 节命名。返回判别联合 `{ok:true, facts} | {ok:false, diagnostics: Diagnostic[]}`；任何一步失败都产出一条 `Diagnostic`（`rule_id` 为 `SG-EVIDENCE-<原因>`，`observed_facts.reason` 携带机器可读原因），不存在“部分 facts”。

工厂参数比第 2.4 节的列表多出 `run_window: {started_at, finished_at} | null`：本次运行的时间区间属于 RunManifest，而 `manifest.json` 不是索引内的 artifact，按“未索引路径一律拒绝读取”的规则工厂不能自己去取它，所以由调用方（未来的 SG-062 接线处）传入。传 null 时工厂不做区间判断，`assessEnvironment` 依旧给出 `ENV_RUN_WINDOW_UNAVAILABLE`，V2-R05 的规则没有被放宽。

`AuthenticatedEnvironmentFacts` 只由该工厂构造：它带一个含私有成员的品牌类型 `AuthenticatedFactsIssuer`，对象字面量在 `pnpm typecheck` 下无法赋值（集成测试用 `@ts-expect-error` 钉住这一点）。品牌只防开发误用，不是安全边界，也不证明环境来源的独立性。

### 8. 校验顺序与“只读索引里的东西”

实现顺序（记录在模块头注释里）：先用 `validateSchema('artifact', …)` 重建并校验本 Run 索引，丢弃非法项与别的 Run 的项；然后对每个引用做**读取前**的 preflight——摘要形式、路径必须落在本 Run 自己的 `documents/` 或 `artifacts/` 目录、文档 kind 对应的固定路径、索引存在性、`artifact_id` 与 `digest` 与索引一致、check/attempt 作用域、1 MiB 读取预算；越界形式（`..`、`.`、空段、绝对路径、盘符、反斜杠、`manifest.json`、`events.jsonl`、`seal.json`、`restricted/`）一律拒绝且**不发起读取**。随后才用索引 entry 自己的 `relative_path/expected_digest/max_bytes=size` 通过 `EvidenceReader.read` 回读，再逐一核对回读 artifact 与索引 entry 完全一致（integrity）、字节数与索引 size 相同、`hashBytes(重新读到的字节)` 与索引摘要相同；然后严格 JSON 解析并按 kind 做 `validateSchema`。最后按 run+check+attempt+request+instance 连接请求，比较 operation/status/media/timing 与**从原始响应字节重算的摘要**，并要求观察文档自报的 `observation_path` 就是该请求在索引里的 observation 路径。

期望操作只来自 `requirements.required_operations`：要求里有而 `requests` 里没有的操作直接得到 `EVIDENCE_REQUIRED_OPERATION_NOT_EXPECTED`，工厂不会把观察到的操作反向补成要求。重复 request id、同一份证据被两个请求引用、跨 attempt 的重放 body 都是拒绝项。

### 9. `sha256:` 前缀只在边界转换一次（第 2.5 节）

`presets/fastapi-react/scripts/probe_helpers.py` 写出的 `response_digest` 是 `"sha256:"+hex`，而存储侧 `Artifact.digest` 与 `BackendObservation.response_digest` 必须是 `common.schema.json#/$defs/Sha256` 的裸 64 位小写十六进制。工厂的 `boundaryDigest()` 严格识别这两种形式之一：裸形直接采用，`sha256:`+裸形去掉前缀，其它（大写、空白、双重前缀、非 hex）产生 `EVIDENCE_DIGEST_FORM_INVALID`。前缀只允许出现在**调用方传入的引用字符串与观察摘要字符串**上；索引 entry 或已存文档里出现前缀会被 `validateSchema('artifact'/'backend-observation')` 拒绝，因此不会有两套字符串含义在同一层同时成立，也不会因为历史上带过前缀就把现有 artifact 全部判为非法。

### 10. `assessEnvironment` 的输入变化与引用规则

`EnvironmentAssessmentInput.observations` 由 `readonly BackendObservation[]` 改为 `readonly AuthenticatedObservation[]`，其中 `{observation, artifact_ids}` 的 `artifact_ids` 必须是核心已认证并回取过的 artifact id。`observation_refs` 因此**只可能**装真实 artifact id：`refs.add(observation.request_id)` 已删除，改成把 `artifact_ids` 中出现在 `authenticated_refs` 里的项加入集合；空绑定给 `ENV_OBSERVATION_REFERENCE_UNBOUND`，绑定但未被认证给 `ENV_REFERENCE_UNAUTHENTICATED`。纯函数依旧无 I/O，READY/来源上限/运行区间/清理台账规则与 V2-R05 相同；操作覆盖仍以“字节已认证”为门，绑定只决定可以引用谁。

`assessmentReferencesAuthentic` 保持签名不变并降级为补充检查：它只能确认“引用的都是给定存储 artifact”，不能授予成功——集成测试里自报 CONTROLLED 的被拒评估同时满足 `assessmentReferencesAuthentic(...) === true` 与 `satisfied === false`。

### 11. 旧 0.1 证据的兼容读取与仍未覆盖部分

`assessEnvironment` 的输入是代码内类型，不是持久化协议：本次没有改动 `schemas/0.1/**`（`pnpm verify:schemas` 与 `pnpm generate:types` 均无漂移），新增诊断码沿用既有 `ReasonCode` 取值（`REPORT_INVALID`、`MISSING_REPORT`、`POLICY_WEAKEN_ATTEMPT`、`ARTIFACT_BUDGET_EXCEEDED`、`INPUT_STALE`、`CONFIG_INVALID`），未扩充共享枚举。旧的 `environment-assessment` 文档继续通过 schema 校验并可读取；其 `none`/`missing` 占位引用在 `assessmentReferencesAuthentic` 下依旧得不到信任（除非核心给出的列表里真有这些 id），集成测试保留了这一反例。`BackendObservation.observation_path` 现在必须等于该请求 observation artifact 的实际索引路径，因此旧观察里指向未索引位置的 `observation_path` 会在工厂里被 `EVIDENCE_REQUEST_NOT_CONNECTED` 拒绝，而不是被当作等价事实——这是读取更严格的方向，不改变任何已封存字节。

CONTROLLED 所需的执行上下文证明**不由本 ADR 的工厂提供**：回读成功只证明内容与索引一致，认证上限保持 `OBSERVED`，需要 CONTROLLED 的 profile 在 SG-056/058/060 落地前必然被拒。本任务也未把工厂接进真实 Run——`assessEnvironment` 与 `authenticateEnvironmentEvidence` 目前没有生产调用方，接线属于 SG-062。

## V2-R06 之前的未覆盖记录（历史）

V2-R05 提交时本节写的是“真实存储打通前不得据此宣称引用已认证”，并指出 `tests/contract/m3-runtime-contracts.test.ts` 的 `baseInput` 把 `observation.request_id` 放进 `authenticated_refs`，人工制造了 request/artifact 同 id 的条件。该条件已由上面的第 10 节替换：`baseInput` 现在使用与 request id 不同的 artifact id 常量，真实存储贯通由集成测试承担。

## 后果

- 环境结论现在要求：READY、来源等级、实例与 origin 连续性、数据版本、运行时间区间、证据引用与资源收尾全部独立成立；缺任一项即不满足。
- 无环境 profile 不再需要伪造成交文档；`environment_required:false` 是唯一合法的零引用形状。
- 需要 CONTROLLED 门槛的 profile 在 V2-R06 之前必然被拒，这是有意的：不得由应用自报升级来源等级。
- 契约与单元测试位置：`tests/contract/m3-runtime-contracts.test.ts`（复用 `baseInput`）与 `tests/unit/v2/environment-assessment.test.ts`（自建夹具）；V2-R06 的真实存储贯通在 `tests/integration/environment/evidence-authentication.test.ts`。
- V2-R06 之后，环境结论的证据引用必须是本 Run 索引里可重取的 artifact：把 HTTP request id 当作引用、引用未索引路径、跨 Run/跨 attempt 取证据、字节与摘要不一致、观察自报 `satisfied`/`CONTROLLED` 都在工厂层被拒，纯函数继续只做语义推导。
- 工厂读取成功仍不等于环境来源独立：它只证明“内容与索引一致”。CONTROLLED 与真实 Run 接线分别留给 SG-056/058/060 与 SG-062。

## 7. 测试专用启动记录协议（SG-055，协调者补记）

`examples/contract-drift-demo/apps/api/scripts/launch_test_api.py` 写 `launcher.json`，kind `stackgate-test-api-launch`，字段含 pid、`process_creation{status,mechanism,creation_identity,created_at,clock}`、input_hash、instance_id、data_revision、host/port/origin（恒 127.0.0.1，端口由 OS 分配）、`served_routes`、`evidence_routes`、`source_digests`、`max_recorded_bytes`。要点：

- 观察中间件只由该启动器包裹同一个 `create_app` 挂载；正常应用入口不启用观察，也不公开任何证据读取路由。
- `instance_id` 与 `data_revision` 由启动器生成并作为服务端响应头追加；应用或客户端自报的同名头一律被替换，不回显为来源。
- 观察目录布局 `<root>/<run>/<check>/<attempt>/<request>/{response.bin,observation.json,index.json}`；`index.json` 最后独占提交，即"完成索引"，只有全部字节落盘后才存在。`diagnostic.json` 与 `conflict.json` 与它互斥：重复同一 `(run,check,attempt,request)` 身份得到 `IDENTITY_CONFLICT` 且保留先前字节（`retained_bytes:0`），绝不覆盖。
- 已声明能力边界：仅缓冲字节、以 `more_body=False` 为完成；超预算 `RESPONSE_OVER_BUDGET`；`content-encoding` 非 `identity` 为 `CONTENT_ENCODING_UNSUPPORTED`；其它响应消息类型为 `RESPONSE_MESSAGE_UNSUPPORTED`；`content-length` 与实测温差不符为 `RESPONSE_LENGTH_MISMATCH`；完成后应用抛错记 `APPLICATION_ERROR`。流式响应超出已测能力即显式拒绝，不假装支持。
- 记账失败只写 stderr，不改变客户端已收到的响应；这是"证据失败不得篡改业务结果"的边界。
- POSIX 分支与显式 `--port` 路径在 Windows 上未实跑，`process_creation.status` 在非 win32 属未验证；`<root>` 尚未接入 `FileEvidenceStore`，与认证工厂的联通属 SG-056/060。

## 8. Compose 预检的策略输入边界（SG-057，协调者补记）

`preflightCompose` 读取 `policy.compose_writable_mount_roots`，但该字段**尚未**在 `schemas/0.1/policy.schema.json` 中声明（本轮不改 Schema 以免与 SG-058 的真实资源接线同时变更协议）。当前语义：字段缺失即最严格——所有 bind mount 必须只读，任何可写挂载被拒。SG-058 接线时若要在策略里声明可写输出根，必须与测试一同变更 Schema 并在此追加兼容说明；未知字段仍由 `additionalProperties:false` 拒绝，不会被静默赋予含义。预检本身是纯解析：不 spawn 任何可变状态的进程，`include/configs/secrets` 等未支持段直接拒绝而非忽略。
