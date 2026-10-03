# Linux/WSL 受控执行能力（AUD-004）

本文只记录**在本机内核上实测到的事实**，以及由此推出的实现边界。任何未在本机跑过的项都写在“未验证”一节，不用 Windows 的结果背书，也不用文档推断补齐。

## 1. 范围

`packages/runner-local/src/linux/` 下的 `LinuxRunner` 是 Linux 侧的 `RunnerPort` 实现：把一个已确认命令放进**本次 Run 自建的私有 cgroup v2 子树**，用该子树的成员集合做归属与回收证明。Windows 侧 `local-runner.ts`（Job Object）保持不变，两者共用 `ResolvedCommand`、`RunnerResult`、输出预算与脱敏合同。

## 2. 实测宿主

| 项 | 实测值 |
|---|---|
| 内核 | `6.6.114.1-microsoft-standard-WSL2` |
| init | systemd（`ps -p 1 = systemd`），`XDG_RUNTIME_DIR=/run/user/1000` |
| cgroup 挂载 | `cgroup2 cgroup2 rw,nsdelegate`（统一层级，无 v1） |
| 运行身份 | uid=gid=1000，`CapEff=0000000000000000`（无任何 capability） |
| 普通 `wsl -e bash` 会话所在 cgroup | `/init.scope`（root 拥有） |
| `systemd-run --user --scope` 会话所在 cgroup | `/user.slice/user-1000.slice/user@1000.service/app.slice/run-rXXXX.scope`（uid 1000 拥有） |
| Linux guest 内的解释器 | 只有 `/usr/bin/python3`，**没有 Node** |

证据：`aud-004-linux-migration-refused-from-root-init-scope-2026-10-03T17-20-36-618Z.json`、`aud-004-linux-cgroup-semantics-clean-2026-10-03T17-22-39-984Z.json`。

## 3. 决定实现的内核事实

每条都来自 `tests/support/aud004_scope_probe.sh` 与 `tests/support/aud004_attach_probe.py` 的真实输出，不是文档结论。

| 实测事实 | 对实现的影响 |
|---|---|
| 在 root 拥有的 `/init.scope` 里，把**自己的 PID** 写进自己创建且自己拥有的子 cgroup 的 `cgroup.procs`，返回 `EACCES(13)`；同一动作在 systemd 委派子树内成功 | 可用性必须以“真的移动一个进程”判定，不能只看目标目录属主/模式。`detectCgroupDelegation()` 因此会真起一个一次性子进程去验证，`ROOT_NOT_OWNED`/`MIGRATION_REFUSED` 是两个不同的拒绝原因 |
| 自建的子 cgroup 中 `cgroup.procs`(0644)、`cgroup.freeze`(0644)、`cgroup.subtree_control`(0644)、`cgroup.kill`(0200) 属主均为 uid 1000 | 无需 root 即可冻结与原子全量杀；`cgroup.kill` 是首选回收手段，`SIGKILL` 逐个是后备 |
| 进程自行加入子树后，其 fork 出的后代全部出现在同一 `cgroup.procs` 中（实测成员含被测程序与其心跳子 shell） | “只 kill 启动时那个 PID 就宣称清理完成”是本页明确拒绝的做法；回收对象是成员集合 |
| `cgroup.freeze=1` 期间被观察程序的心跳增长为 `0`，解冻后恢复增长 | 冻结能阻止回收窗口内的进展与 fork；但冻结**不是**杀死 |
| 监督进程把自己加入子树后写 `cgroup.freeze=1`，它自己也停住了，永远走不到解冻语句（该版本探针因此挂起） | `LinuxRunner` 与测试进程**绝不**加入待回收的子树；只有被启动的进程加入 |
| 对 `user@1000.service` 这种共享父 cgroup 写 `cgroup.kill` 会波及整条用户会话 | 能力探针不对共享层做任何写操作，只在自建目录上试 |
| 成员仍在时 `rmdir` 返回 **EBUSY**（`rmdir_with_members=refused`），进程没有向上迁移 | 移除成功可作为“成员集合已空”的**第二**证据；早期一次探针显示“移除成功”是因为那次的 attach 已失败、集合本就是空的，属于无效反证 |
| `cgroup.kill` 清空成员后，该子目录**被内核自动回收**，随后的 `rmdir` 得到 `ENOENT` | VERIFIED 判定必须把 `ENOENT` 视为与 `rmdir` 成功同等，否则一次真正成功的回收会被误报为 `UNVERIFIED` |
| 只 `kill -9` 启动的那个程序，心跳子 shell 仍在集合里（遗留 3 个 stray 与 6 个 `sleep 0.2`） | 回收必须以成员集合为准并逐项确认清空；本机已用 `tests/support/aud004_cleanup.sh` 清干净，`remaining_aud004=[]` |
| 临时 scope 的 `cgroup.controllers`/`subtree_control` 为空，而 `user@1000.service` 层为 `cpu memory pids` | 归属证明不需要任何控制器；但**资源上限**（pids.max/memory.max 等）在当前会话子树里不可用，实现只记录可用控制器，不假装施加了限制 |

## 4. 判定与拒绝语义

`LinuxRunner.run()` 的顺序是：入参安全 → 输入字节摘要复核 → 启动包装器身份 → 委派能力 → 建子树 → 启动 → 确认成员 → 采集创建身份 → 输出与预算 → 回收并证明。

- 任一环不成立即返回 `status:'ERROR'`，并把**内核给的理由**写进 `observed_facts`：`EXECUTION_UNTRUSTED`（路径/argv/env 不安全或字节变了）、`UNSUPPORTED_CAPABILITY`（无委派子树、包装器不可用）、`RESOURCE_OWNERSHIP_UNVERIFIED`（进程未加入子树、创建身份读不到、回收后仍有成员）。
- `provenance.mechanism` 为 `CGROUPV2_DELEGATED_SUBTREE`；`cleanup` 只有在“成员集合为空**且**子树已被移除或已被内核回收”时才是 `VERIFIED`。
- 归属证明是 `(boot_id, /proc/pid/stat starttime)` 加本进程持有的 spawn 句柄；不采信任何持久化 PID，也不按进程名匹配。
- 启动路径是 `spawn('/bin/sh', [包装器, cgroup.procs, 状态文件, 可执行文件, ...argv])`，`shell:false`：可执行文件先自行入组再 `exec`（`exec` 保留 PID），因此不存在“先 fork 后挂账”的逃逸窗口。

## 5. 本机已验证

| 结论 | 证据 |
|---|---|
| `LinuxRunner` 在无委派宿主上拒绝执行并给出 `UNSUPPORTED_CAPABILITY`，且完全不启动进程 | `aud-004-linux-runner-refusal-on-win32-2026-10-03T17-22-53-450Z.json`（`tests/compatibility/linux-runner.test.ts` 13 项通过） |
| 入参校验、字节篡改拒绝、预取消路径跨平台一致 | 同上 |
| Windows 侧行为未被改动 | `aud-004-windows-runner-regression-preserved-2026-10-03T17-22-59-441Z.json`（`tests/integration/runner/process.test.ts` 15 项通过，含“只杀自有作业含 detached 后代、无关进程存活”） |
| Linux 内核语义（第 3 节全部事实） | `aud-004-linux-cgroup-semantics-in-delegated-scope-...json`、`aud-004-linux-cgroup-semantics-clean-...json`（探针 `leftover_aud004_dirs=[]`） |

## 6. 未验证（保持阻塞）

1. **产品代码本身从未在 Linux 上执行过。** Linux guest 内没有 Node，`pnpm exec vitest run tests/compatibility/linux-runner.test.ts` 无法在 Linux 侧运行；第 3 节证明的是内核语义，不是 `cgroup.ts`/`runner.ts` 的实现正确。
2. 因此计划要求的这四条断言**尚无一条被真实执行**：`detachedDescendant.aliveAfterCancel === false`、`unrelatedProcess.aliveAfterCancel === true`、`provenance.cleanup === 'VERIFIED'`、超时/取消两条路径在真实 Linux 上的区分。在 win32 上它们落在拒绝分支（`process === null`、什么都没启动），只证明“不会假装清理过”。
3. 超时/取消后 `TIMED_OUT` 与 `CANCELED` 的 `raw_exit_code` 与信号事实、`ARTIFACT_BUDGET_EXCEEDED` 在 Linux 上的实际表现，均未运行过。
4. 会话子树无控制器可用时若改用 `user@1000.service` 直接建子树（该层控制器可用）能施加资源上限，但本实现不从共享层建资源域，故资源上限能力为 `未验证`。
5. 真实 detached 后代跨 `setsid`、`SIGKILL` 竞态、`cgroup.max.descendants` 触发、跨 restart 的 PID 复用检测均未运行过。

## 7. 解除阻塞所需的宿主准备

按最小改动排序，全部需要用户授权后进行：

1. 在 WSL2 guest 内提供一个 Node 24.11.1 运行时（用户目录级安装即可，不需要 apt 源、不需要 systemd 服务、不需要 root）。
2. 用 `systemd-run --user --scope` 启动该测试，使 StackGate 自身进程位于委派子树内——普通 `wsl -e bash` 会话会被判为 `MIGRATION_REFUSED`（这是正确行为，不是缺陷）。
3. 在该子树内运行 `pnpm exec vitest run tests/compatibility/linux-runner.test.ts`；`DELEGATED` 分支会自动改跑真实归属/回收断言，无需改代码。
4. 只有第 3 步真实退出 0 且 `provenance.cleanup === 'VERIFIED'`、无关进程存活，才能把 AUD-004 记为 DONE，并据此接入 SG-071（Linux/worktree 验收）与 SG-076（兼容矩阵）。

复跑本机语义探针（无需 Node）：

```bash
wsl.exe -e sh -c "tr -d '\015' < /mnt/g/StackGate/tests/support/aud004_scope_probe.sh > /tmp/sgprobe.sh && systemd-run --user --scope --collect -- timeout 100 sh /tmp/sgprobe.sh"
wsl.exe -e python3 -B tests/support/aud004_attach_probe.py
wsl.exe -e sh -c "tr -d '\015' < /mnt/g/StackGate/tests/support/aud004_cleanup.sh > /tmp/sgclean.sh && sh /tmp/sgclean.sh"
```

## 8. 已考虑的替代路径与拒绝理由

| 替代 | 拒绝理由 |
|---|---|
| `wsl -u root` 或 `sudo` 打开委派 | 属于擅自提权，且会把“无特权的真实部署条件”换成一个不存在的宿主 |
| `docker run --privileged` 造一个能写 cgroup 的容器 | 特权容器不是本任务要证明的 Linux/WSL 用户态条件；daemon 还是别的项目在用的共享状态 |
| 拉取 `node` 镜像后在容器里跑测试 | 本机 46 个镜像里没有 Node 系镜像，拉取会改动用户的 Docker 本地状态且未经确认；容器内 `/sys/fs/cgroup` 默认为只读，也无法证明委派路径 |
| 用 Windows 的 13 项通过外推“Runner 已支持 Linux” | 计划明令禁止；本页第 6 节即为该项的未验证清单 |
| 用 `pids.current` 或 `rmdir` 单条证据判定回收完成 | `rmdir` 在成员清空后被内核自动回收时会返回 `ENOENT`；控制器在会话子树里可能根本不可用 |
| 在 Windows 上 mock `process.platform='linux'` 跑测试 | 会测到一条不存在的代码路径，等价于用常量伪造实测 |

## 9. 接线状态

`LinuxRunner` 目前**没有生产调用方**：`packages/core/src/services/run-service.ts` 仍构造 `LocalRunner`。按计划 §2.1，注册表的能力检测与真实接入属于 SG-062，Linux 平台验收属于 SG-071；本任务不声称已接线。`scripts/build.mjs` 已把 `attest-launch.sh` 复制到 `dist/runner-local/`，`.gitattributes` 固定 `*.sh` 为 LF——否则本机 `core.autocrlf=true` 会在检出时给包装器混入 CR，使 `/bin/sh` 无法解析。
