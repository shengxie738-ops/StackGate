# ADR-011：M2 执行与证据合同

日期：2026-09-20。状态：接口设计已确定；进入 M2 实施仍须 M1-R07 完整验收。

依据：原始 v0.1 架构/执行计划、v0.2 修复计划、当前 a651054 端口与 Schema。复用现有模块化单体，不建立第二套 runner、adapter、Gate 或账本。

## 已发现的合同反例

v0.2 SG-039 的 finalize 清单把 seal 放在 final event 前；SG-031 同时要求 seal 后 append/store 一律拒绝。两者按字面执行无法同时满足。解决顺序为：collect → 保存 post-run 输入事实和结论事实 → 写最终 manifest 与 final event → 校验并原子提交 seal。seal 是完成提交标记；只有实际校验 seal 有效才对外承认完整完成。崩溃留下的无 seal 记录可读但不能完整 PASS。这里不允许 seal 后补写或回写事实。

原 SG-033 的流式返回示意与已落地 RunnerPort 不同。保留现有 run(command, context): Promise<RunnerResult>；stdout/stderr 经异步回调流式提供。Adapter.execute 的 AsyncIterable<RunEvent> 保留，不将它错当 runner 的返回接口。

## 冻结的现有接口

| 合同 | 真源 | M2 实现规则 |
|---|---|---|
| RunnerPort / ResolvedCommand / RunnerResult | packages/core/src/ports/runner.ts | argv、cwd、最小环境、超时和身份来自已确认配置与本地执行信任；shell:false；只返回进程事实，保留真实退出码，不计算 verdict |
| EvidenceStore / EvidenceReader | packages/core/src/ports/evidence.ts | append/store/seal/read 保持单一端口；createRun/readRun/verifyRun 可以是具体实现的便利方法，不形成替代协议；renderer 只取得读取能力 |
| CheckPlan | schemas/0.1/plan.schema.json | 固定任务 revision、profile、输入/策略/目标/工具链/环境需求摘要、非空必检、步骤和 plan_hash；改变任何受保护身份须重新计划 |
| CheckStep | schemas/0.1/check-step.schema.json | 稳定 step/check 身份、依赖、锁、timeout、预期证据和测试 ID；未实现环境步骤保留为明确阻塞，不能删除 |
| CheckResult | schemas/0.1/check-result.schema.json | 保留真实执行数量、跳过、稳定测试 ID、attempt、原始退出码及证据引用；零测试、丢失报告和必检缺失不能 PASS |
| RunEvent | schemas/0.1/event.schema.json | 单 run 连续 seq；相同 event_id 相同事实幂等、不同事实拒绝；schema 与生命周期均验证；不得删除失败事件 |
| RunManifest | schemas/0.1/run.schema.json | Run 事实不可变；最终 manifest、事件、全部所需证据均由 seal 绑定；重新评估另存 evaluation，不改旧 verdict |
| Adapter | packages/core/src/ports/adapter.ts | describe/validate/plan/execute/collect；只通过受限 command ID、产物写入和日志能力执行；真实进程与 collector 协作，测试替身仅在 tests/ |

Schema first：新增 seal、handoff 或预算字段先修改严格 JSON Schema，再运行 generate:types 与 verify:schemas；禁止手改 generated type 或放宽 additionalProperties。现有 EvidenceDocument 可在必要时增加指向已有严格 schema 的变体；不能加入任意无类型 JSON 通道。

## 信任、执行与 Gate

业务 Task confirmation 与本地 execution trust 分离。Run 开始前重新检查 plan、当前文件、配置、工具字节与信任身份；仅设置 CI=true 不会增加可信度。Plan/Scan 复用 selectionPolicyFor；workspace regression 只能增加必检，不能降低任务、profile 或明确映射要求。

GateService 负责从实际文件与封存信息认证 GateInput。最终判定仅调用 domain/evaluate-gate.ts；runner、reporter、CLI 不复制判定规则。完整性错误优先于 stale；report/handoff 操作成功的 0 不代表 ALLOW。Gate 重新评估必须比较当前 repo/worktree/task/policy/target/input/tool 身份与历史事实。

取消停止新步骤并保留已有证据，有界清理仅限可核验归属资源。PID 本身不证明归属；无法确定子树安全状态必须暴露错误或阻塞。默认最多两个独立步骤并发；副作用锁必须跨 Run/进程保护同一工作树。

## 存储与可读产物

每个 Run 使用独立安全目录；路径穿越、链接逃逸、覆盖既有证据均拒绝。普通日志在写入磁盘之前流式脱敏，记录预算 original_bytes/retained_bytes/truncated/reason；关键报告预算耗尽属于证据缺失，不转为成功。已 seal 的 append/store 被拒绝，导出与重新评估写入另一个命名空间。

JSON/terminal/Markdown/JUnit 四种 reporter 只投影同一验证后的视图。导出默认排除 restricted 产物；未知主版本明确不支持，允许的兼容扩展须显式 schema 声明。v0.2 SG-047 的工具 provenance 汇总是增量要求，仍保留原 SG-047 的版本读取与非覆盖导出验证；v0.2 SG-042 同样不删除原任务的 JUnit 输出要求。

M2 只验证执行器、证据、Gate、报告和交接。未实现的真实环境、网络 probe 执行、浏览器及 Compose 不可标为可用，继续属于 M3。测试 fixture 的本地命令 profile 可在没有环境要求的情况下通过，但不得据此声称全栈 MVP 完成。
