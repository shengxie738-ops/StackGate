# M1 audit repair acceptance

基线 a651054；M1-R00—R07。完整 M1 stage 退出 0。447 项 Vitest 单元 + 27 项开发工具 + 36 项合同 + 81 项集成 = 591 项，零失败、零跳过。

- [完整 stage 命令记录](m1-r07-full-stage-2026-09-20T13-46-48-536Z.json)
- [逐项子命令和输出](m1-stage-2026-09-20T13-48-44-921Z.json)
- help 退出 0；unknown --json 实际退出 64，输出统一错误 envelope。该 64 是预期拒绝，原始 recorder 保留 FAILED 标签，不伪造零退出。
- 实际测试平台 Windows x64；Linux/macOS 运行未验证。
- 原始 SG-001—SG-028 DONE 记录保留，修复证据见独立 audit-fixes.json。
- R06 采用现有 27 个端口/边界反例，并记录 seal/final-event 的文本合同冲突；文档任务不人为制造产品失败。
- 源码未提交；未执行远程 push、公开发布、生产部署或付费模型调用。

下一阶段 SG-029—SG-050；M2 尚未验收，不能声称运行闭环或全栈能力完成。
