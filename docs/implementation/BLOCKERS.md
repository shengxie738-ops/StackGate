# Implementation blockers

M0 本地实现无待解决的环境或权限阻塞；最终出口状态以 PROGRESS.md 和实际 stage 日志为准。

M1 完整 stage 已退出 0（`m1-stage-2026-09-20T03-18-54-891Z.json`），无剩余阶段阻塞。原始文件符号链接在本机复核探测返回 EPERM（SG-011、SG-027）；Linux/WSL 的原始路径/链接语义、网络文件系统、断电持久性和反复清理 I/O 故障仍未验证。真实目录 junction、硬链接的测试不能替代这些组合。

后续能力缺口（不以静态夹具替代实测）：

- oasdiff 1.32.1 已通过本机 Windows 真实适配器合同；仅锁定的支持子集和规则映射为 VERIFIED。未知规则、未知输出或不支持 Schema 保守阻塞。Playwright 仍 UNKNOWN；Compose 只取得版本输出，未启动服务、验证身份或清理。需它们的后续阶段不能据此通过。
- WSL2/Linux、Linux CI、macOS、T01—T27 端到端验收、实际 FastAPI/React 链路、打包和宿主加载均未运行。相关任务保持未完成。
- Ajv 嵌套动态锚点存在已知限制。SG-019/022 明确拒绝动态引用、未知 format、复杂组合；不会通过降级 OpenAPI 版本或强制转换负载绕过。详见 ../COMPATIBILITY.md。
- Git 从已观测的固定可信安装位置发现，不使用候选仓库 PATH。M1-R01 已将 oasdiff 改为安装目录相对解析，并验证中文、空格路径迁移及缺失/损坏工具反例；其他平台、离线发行和升级仍未验证。
- 根仓库已有 M1 提交 `a651054` 与其上的 M2 检查点提交 `a90a066`。M1 Git 验收使用实际初始化、提交与 linked worktree 的独立临时仓库，未为验收修改用户 Git 历史。M2 收口改动已提交为 V1 分支的 `dca78d3`，未合并进 `main`、未推送。
- 证据可追溯性限制：`scripts/record.mjs` 的 `worktree_digest` 只哈希工作树根路径字符串，`repository.head` 只记录当时 HEAD；两者都不能证明被验证文件的具体字节，因此记录不等于可复现快照。本轮所有 M2 重跑记录先于 `dca78d3` 产生，其 `repository.head` 记为当时的 `a90a066`。
- 进程执行来源认证（Job Object、内核创建身份、owner token）仅在 `win32-*` 平台成立；Gate 在非 win32 平台不会把这些字段视为已验证事实，其他平台的执行器未实现也未验证。
- 本地确认/授权是同一用户身份下的审查记录，不是 OS 沙箱或防同身份恶意进程的签名系统。M2 已用真实本地夹具子进程完成执行器、证据、Gate、报告与交接认证，但尚未验证真实产品的 Probe、浏览器或容器链路；静态扫描返回 0 不代表 Gate ALLOW。

已解决且保留证据的开发问题：pnpm 11 原生构建许可配置、官方 meta-schema 的 Ajv 兼容问题、严格 Schema 引用/条件错误、边界检查及最终 lint 问题。原始失败日志仍保留，未将失败删除或改为成功。

M1-R07 修复验收记录为 `m1-stage-2026-09-20T13-48-44-921Z.json`：591 项测试通过。M2 完整阶段出口 `pnpm verify:stage -- --stage M2` 已实际退出 0，13 项注册检查全为 0，独立覆盖 841 项（清单见 [M2 验收摘要](evidence/M2-summary.md) 与 `m2-stage-2026-09-20T18-52-53-834Z.json`）。阶段出口只认证执行器、证据、Gate、报告与交接；M3 的真实环境来源、浏览器与容器链路仍未验证，不构成全栈 MVP。

M3 进行中（改动提交于 `V2` 分支，未合并 `main` 与 `V1`）：SG-051 已完成，`examples/contract-drift-demo/apps/api` 是真实 FastAPI 服务，可独立启动（uvicorn + 轮询 readiness）、跑自带 pytest 并由 `app.openapi()` 导出候选契约；Python 3.14.3 / FastAPI 0.138.1 / Pydantic 2.13.4 / uvicorn 0.49.0 的真实身份与实测能力已写入 `tools/compatibility-lock.json`。该锁条目记录的是已安装 `dist-info/RECORD` 的摘要，因为 Python 依赖是 pip 用户级安装、仓库内没有 Python 锁文件，复现需要同一解释器与固定版本。

M3 尚未开始且本机当前不可运行的部分：Docker CLI 29.5.2 与 docker compose v5.1.4 存在，但 daemon 未运行（`docker info` 无法连接 `dockerDesktopLinuxEngine`），因此 SG-057/058/059/061 的真实 Compose 启动、动态端口绑定与资源清理无法实测；`@playwright/test` 未安装（本机仅有 ms-playwright 浏览器缓存），SG-053 的真实浏览器运行同样不可实测。两者在锁文件中仍为 `UNKNOWN`。相关任务需保持 BLOCKED/IMPLEMENTED_UNVERIFIED，不得以静态夹具替代，也不得据此声明 M3 能力。Windows CPython 需要命令环境内存在 `APPDATA` 才能看到用户级 site-packages，接入 Run 时必须在命令环境变量白名单中显式登记。

未执行公开发布、远程 push/PR、生产部署或付费模型调用。本轮在 V1 分支创建了本地提交 `dca78d3`（未合并 `main`）；任务账本 `commit` 字段按仓库既有约定保留原值（100 项均为 null），提交身份记录在本文件与 [M2 验收摘要](evidence/M2-summary.md) 中，验证证据的 HEAD 见各记录 `repository` 字段。

SG-037 的 pnpm 临时第三方源码副本 `.stackgate-saxes-patch/` 保留在本地：自动审批拒绝了删除该已核对路径的操作，仅返回 `blocked by policy`。未重试删除或移动。该生成副本与 node_modules 一样排除出自有源码 lint；正式声明修补保存在 `patches/saxes@6.0.0.patch`，由锁文件和 frozen install 验证。所有产品源码和必检仍保留。
