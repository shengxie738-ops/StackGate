# SG-033：本地进程执行证据边界

已实现现有 RunnerPort，当前真实验证平台为 Windows x64。POSIX 返回能力不可用；没有把时间戳冒充操作系统进程创建身份，也没有声称 Linux 取消已验证。

Windows 使用固定安装目录中的 PowerShell/C# broker。Trust preview 绑定 PowerShell 可执行文件、broker 脚本及源码摘要；CommandResolver 将这些摘要与实际命令、JS 入口和仓库输入一起传给 Runner，启动前重新核验。PowerShell 使用明确路径、固定参数、shell:false。执行请求通过 stdin JSON 行传输，参数和环境值不写入临时文件。

CreateProcessW 使用挂起创建、明确的三个标准流句柄和 PROC_THREAD_ATTRIBUTE_JOB_LIST，在创建时原子归属私有 Job；不留下“创建后、归属前”孤儿窗口。确认操作系统进程创建时间与 Job 成员关系后才 ResumeThread。目标 stdin 是 NUL，broker 的 stdin 则保留为父进程存活管道。父进程退出使管道 EOF，broker 终止自有 Job。Job 禁止 breakaway 且设置 KILL_ON_JOB_CLOSE。

取消和超时写入含本次 owner token 的控制消息；broker 终止 Job，等待 Job 清空，再通过独立完成记录确认。Runner 只有获得有效完成确认才报告清理已验证；有界期限后只能终止自己的 broker 句柄并报告 ERROR，不按持久化 PID、名称或全局进程列表杀进程。日志回调有背压和截止时间；脱敏在回调之前，原始字节计数在脱敏之前，预算或证据回调失败不能正常通过。

临时目录删除前检查固定临时父目录、随机前缀、链接与创建时文件身份；不全局清理临时目录。进程事实保留原始退出码、创建身份、owner token、输出预算、清理状态、实际 broker 版本和授权摘要；不包含原始环境值。

真实测试覆盖退出 0/1/7、原样 Unicode/引号/反斜杠/分号/& 参数、独立 stdout/stderr、秘密脱敏、海量输出、慢/失败回调、原生进程启动失败、执行文件与输入漂移、启动前取消、取消/超时下 detached 子进程结束以及无关进程仍存活。故障证据与最终验证分别保留在 sg-033-*.json/.log，未删除历史失败。

API 依据：[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[UpdateProcThreadAttribute（包含 Job 列表和句柄列表）](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)、[进程创建标志](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)。这不是对同一操作系统身份恶意进程的沙箱承诺。
