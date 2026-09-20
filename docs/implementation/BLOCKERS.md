# Implementation blockers

M0 本地实现无待解决的环境或权限阻塞；最终出口状态以 PROGRESS.md 和实际 stage 日志为准。

M1 完整 stage 已退出 0（`m1-stage-2026-09-20T03-18-54-891Z.json`），无剩余阶段阻塞。原始文件符号链接在本机复核探测返回 EPERM（SG-011、SG-027）；Linux/WSL 的原始路径/链接语义、网络文件系统、断电持久性和反复清理 I/O 故障仍未验证。真实目录 junction、硬链接的测试不能替代这些组合。

后续能力缺口（不以静态夹具替代实测）：

- oasdiff 1.32.1 已通过本机 Windows 真实适配器合同；仅锁定的支持子集和规则映射为 VERIFIED。未知规则、未知输出或不支持 Schema 保守阻塞。Playwright 仍 UNKNOWN；Compose 只取得版本输出，未启动服务、验证身份或清理。需它们的后续阶段不能据此通过。
- WSL2/Linux、Linux CI、macOS、T01—T27 端到端验收、实际 FastAPI/React 链路、打包和宿主加载均未运行。相关任务保持未完成。
- Ajv 嵌套动态锚点存在已知限制。SG-019/022 明确拒绝动态引用、未知 format、复杂组合；不会通过降级 OpenAPI 版本或强制转换负载绕过。详见 ../COMPATIBILITY.md。
- Git 从已观测的固定可信安装位置发现，不使用候选仓库 PATH。oasdiff 安装身份在本地部署元数据中固定；跨平台发现、离线发行和升级属于后续任务，当前未验证。
- 根仓库尚无提交；对该根目录执行 scan 会诚实报告缺少基线。M1 Git 验收使用实际初始化、提交与 linked worktree 的独立临时仓库，未为验收修改用户 Git 历史。
- 本地确认/授权是同一用户身份下的审查记录，不是 OS 沙箱或防同身份恶意进程的签名系统。未运行业务脚本、Probe、浏览器或容器；静态扫描返回 0 不代表 Gate ALLOW。

已解决且保留证据的开发问题：pnpm 11 原生构建许可配置、官方 meta-schema 的 Ajv 兼容问题、严格 Schema 引用/条件错误、边界检查及最终 lint 问题。原始失败日志仍保留，未将失败删除或改为成功。

未执行公开发布、远程 push/PR、生产部署或付费模型调用。Git 无远程、无提交；任务 commit 字段为 null。
