# Implementation blockers

M0 本地实现无待解决的环境或权限阻塞；最终出口状态以 PROGRESS.md 和实际 stage 日志为准。

M1 完整 stage 已退出 0（`m1-stage-2026-09-20T03-18-54-891Z.json`），无剩余阶段阻塞。原始文件符号链接在本机复核探测返回 EPERM（SG-011、SG-027）；Linux/WSL 的原始路径/链接语义、网络文件系统、断电持久性和反复清理 I/O 故障仍未验证。真实目录 junction、硬链接的测试不能替代这些组合。

后续能力缺口（不以静态夹具替代实测）：

- oasdiff 1.32.1 已通过本机 Windows 真实适配器合同；仅锁定的支持子集和规则映射为 VERIFIED。未知规则、未知输出或不支持 Schema 保守阻塞。Playwright 仍 UNKNOWN；Compose 只取得版本输出，未启动服务、验证身份或清理。需它们的后续阶段不能据此通过。
- WSL2/Linux、Linux CI、macOS、T01—T27 端到端验收、实际 FastAPI/React 链路、打包和宿主加载均未运行。相关任务保持未完成。
- Ajv 嵌套动态锚点存在已知限制。SG-019/022 明确拒绝动态引用、未知 format、复杂组合；不会通过降级 OpenAPI 版本或强制转换负载绕过。详见 ../COMPATIBILITY.md。
- Git 从已观测的固定可信安装位置发现，不使用候选仓库 PATH。M1-R01 已将 oasdiff 改为安装目录相对解析，并验证中文、空格路径迁移及缺失/损坏工具反例；其他平台、离线发行和升级仍未验证。
- 根仓库已有 M1 提交 `a651054`。M1 Git 验收使用实际初始化、提交与 linked worktree 的独立临时仓库，未为验收修改用户 Git 历史。
- 本地确认/授权是同一用户身份下的审查记录，不是 OS 沙箱或防同身份恶意进程的签名系统。M2 正在测试真实本地夹具进程，尚未验证真实产品的 Probe、浏览器或容器链路；静态扫描返回 0 不代表 Gate ALLOW。

已解决且保留证据的开发问题：pnpm 11 原生构建许可配置、官方 meta-schema 的 Ajv 兼容问题、严格 Schema 引用/条件错误、边界检查及最终 lint 问题。原始失败日志仍保留，未将失败删除或改为成功。

M1-R07 修复验收记录为 `m1-stage-2026-09-20T13-48-44-921Z.json`：591 项测试通过。M2 完整阶段出口尚未运行，不视为完成。

未执行公开发布、远程 push/PR、生产部署或付费模型调用。本轮未创建提交；历史任务 commit 字段保留原记录，当前 HEAD 见验证证据中的 repository 字段。

SG-037 的 pnpm 临时第三方源码副本 `.stackgate-saxes-patch/` 保留在本地：自动审批拒绝了删除该已核对路径的操作，仅返回 `blocked by policy`。未重试删除或移动。该生成副本与 node_modules 一样排除出自有源码 lint；正式声明修补保存在 `patches/saxes@6.0.0.patch`，由锁文件和 frozen install 验证。所有产品源码和必检仍保留。
