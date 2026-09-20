# M1 implementation and verification

**M1 已通过：SG-011—SG-028 全部 DONE。** `pnpm verify:stage -- --stage M1` 实际退出 **0**（2026-09-20，本机 Windows x64）。不包含 M2 业务执行器或 M3 浏览器/服务验收。

- [命令、时间和退出码](sg-028-final-stage-2026-09-20T03-15-44-284Z.json)
- [完整命令输出](sg-028-final-stage-2026-09-20T03-15-44-284Z.log)
- [十个子检查及真实退出码](m1-stage-2026-09-20T03-18-54-891Z.json)

| 实际验证 | 结果 |
| --- | --- |
| source / tasks | 两份原稿与保留副本一致；100 项账本有效 |
| schemas / boundaries | 23 个 Schema、19 个结构夹具、7 个 OpenAPI 文档；生成类型无漂移；104 个产品源文件边界通过 |
| build / typecheck / lint | 全部退出 0 |
| Vitest 单测 | 434 / 434 通过 |
| Node 开发工具反例 | 25 / 25 通过 |
| 真实工具合同 | 36 / 36 通过，含固定 oasdiff 1.32.1 |
| 集成测试 | 64 / 64 通过，含 Git、任务/授权、真实契约、CLI、M1 哨兵 |

共 **559 项测试通过，0 失败、0 跳过**。M1 无剩余阻塞；以下明确列出的平台和运行时范围仍未验证，不在本阶段成功范围内。

## F01—F08 范围核对

| 功能 | M1 已实现 | 仍需后续运行证据 |
| --- | --- | --- |
| F01 项目体检与安全初始化 | 只读 doctor、DRAFT 模板预览、冲突保护、显式 ignore 补丁、链接/硬链接写入保护 | SG-079 完整可运行 FastAPI/React 预设、发行包宿主加载 |
| F02 验收任务定义 | 严格引用校验、机读摘要、不可变 revision、精确输入二次确认、封存原检查合同 | 与实际 Run/可信 CI 策略绑定 |
| F03 基线与代码快照 | 实际 Git merge-base/linked worktree/脏索引/untracked/删除/原始字节；失效字段和目标推进纯函数 | 跨平台与实际长时 Run 前后快照 |
| F04 权限与配置确认 | 多层策略只能收紧；仓库外平台隔离授权；工具、脚本、参数、网络和路径摘要；续期 CAS | 受控业务进程、环境启动/清理、可信 CI loader；本地记录不是 OS 沙箱 |
| F05 三方契约检查 | 固定 oasdiff 真输出；兼容性、目标行为一致性、runtime 三部分独立；批准仅匹配确认任务和精确变更 | 本次候选导出及运行时业务观察，M1 candidate/runtime 为 NOT_EXECUTED |
| F06 首版规则范围 | 全文外部引用拒绝、有界本地引用、显式已测子集、严格请求/响应 Ajv 校验、不强制转换 | 更广规则/format/组合和真实网络负载；超范围为 INCOMPLETE/BLOCKED |
| F07 消费者影响分析 | 显式 mappings Schema、来源图、纯内存 TS 解析、动态/未知语言缺口、必检并集和保守选择 | 完整运行测试 inventory 和真实跨语言调用观察；静态分析不承诺全库无遗漏 |
| F08 测试与验收标准漂移 | 原保护文件/配置/adapter/result_kind/min_tests/必检ID 比较；精确批准；含糊修改 REVIEW_REQUIRED + DENY | 测试 reporter、真实执行数量/ID 与 Run 联动；未运行不声称全部执行 |

## 可复现入口

```powershell
pnpm build
pnpm verify:stage -- --stage M1
node dist/cli.mjs --help
```

M1 stage 包含 source、tasks、schemas、boundaries、build、typecheck、unit、lint、contract、integration 十个必检组。清单必须与请求的阶段一致，不能删去任一检查；oasdiff 缺失、身份失配或未验证不会被当作无差异通过。

真实 Git 临时仓库、固定版本 oasdiff、CLI 子进程和恶意 postinstall/Python/JS 哨兵参与验收。历史 RED、环境探测失败和修复前失败日志保留；测试准备错误不作为功能 RED 证据。完整命令、退出码与 task_id 关联见 tasks.json 和本目录的 JSON/log。

## 边界与未验证

- Windows 文件符号链接创建返回 EPERM，证据 `sg-027-native-filelink-capability-2026-09-20T03-08-20-186Z.json`（退出 2）；真实目录 junction/硬链接已单独测试。不能互相替代。
- Linux/WSL/macOS、网络文件系统、断电持久性尚未验证。
- 业务脚本、候选导出、HTTP Probe、Playwright、Compose、实际 FastAPI/React 链路、T01—T27 端到端、打包/发布均未执行；产品 runtime 为 NOT_EXECUTED。
- oasdiff 仅 Windows 1.32.1 的已测规则及子集为 VERIFIED。未知规则、输出结构、Schema 能力拒绝推断成功。
- 根仓库保持用户原始 Git 状态，无提交、无远程 push/公开发布/生产部署/付费模型调用。源文档保持原始字节。

下一任务为 SG-029（M2）：Run 目录、原子存储与幂等事件日志。
