"""AUD-004 step 1 follow-up: why does migration into the delegated subtree fail here?

`aud004_cgroup_probe.py` proved the private subtree is writable but left the attaching process in
/init.scope with an empty member set. This script asks the kernel the same question three different
ways and records the exact errno for each, plus the cgroup.type values that decide whether the
parent is a threaded domain.

Usage: python3 -B tests/support/aud004_attach_probe.py
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import uuid


def read(file: str) -> str | None:
    try:
        with open(file, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def attach(file: str, pid: int) -> dict[str, object]:
    record = {"target_pid": pid, "file": file.rsplit("/", 2)[-2]}
    try:
        with open(file, "w", encoding="utf-8") as handle:
            handle.write(f"{pid}\n")
        record["written"] = True
    except OSError as error:
        record.update(written=False, error=getattr(error, "strerror", str(error)), errno=error.errno)
    return record


def main() -> int:
    if sys.platform != "linux":
        print(json.dumps({"refused": "NOT_LINUX", "platform": sys.platform}))
        return 64

    uid = os.getuid()
    base = f"/sys/fs/cgroup/user.slice/user-{uid}.slice/user@{uid}.service"
    token = uuid.uuid4().hex
    run_dir = f"{base}/stackgate-aud004-attach-{token}"
    report: dict[str, object] = {
        "host": {"kernel": (read("/proc/sys/kernel/osrelease") or "").strip(), "uid": uid,
                 "self_cgroup": (read("/proc/self/cgroup") or "").strip(),
                 "capabilities": (read("/proc/self/status").split("CapEff:")[-1].splitlines()[0].strip()
                                  if "CapEff:" in (read("/proc/self/status") or "") else None)},
        "types": {"base": read(f"{base}/cgroup.type"), "base_procs": read(f"{base}/cgroup.procs"),
                  "init_scope_type": read("/sys/fs/cgroup/init.scope/cgroup.type"),
                  "init_scope_procs": sorted(int(x) for x in (read("/sys/fs/cgroup/init.scope/cgroup.procs") or "").split())[:8]},
    }
    os.mkdir(run_dir)
    report["run_dir_type_before_attach"] = read(f"{run_dir}/cgroup.type")
    procs_file = f"{run_dir}/cgroup.procs"
    results = []

    # 1. the probing process itself
    results.append(("self", attach(procs_file, os.getpid())))
    results.append(("self_cgroup_after", (read("/proc/self/cgroup") or "").strip()))

    # 2. a direct child, before it execs anything heavy
    child = subprocess.Popen(["sleep", "12"])
    time.sleep(0.2)
    results.append(("own_child", attach(procs_file, child.pid)))
    child_cgroup = read(f"/proc/{child.pid}/cgroup")
    results.append(("child_cgroup_after", child_cgroup))

    # 3. if attaching after spawn worked, does a later fork stay inside the subtree?
    if child_cgroup and run_dir.split("/")[-1] in child_cgroup:
        forked = subprocess.Popen(["sleep", "11"])
        time.sleep(0.4)
        report["descendant_follows_cgroup"] = {
            "grandchild": forked.pid,
            "grandchild_cgroup": read(f"/proc/{forked.pid}/cgroup"),
            "members": sorted(int(x) for x in (read(procs_file) or "").split()),
        }
        forked.kill()
        forked.wait(timeout=10)
    results.append(("members_after", sorted(int(x) for x in (read(procs_file) or "").split())))

    # 4. does a shell that attaches itself get any further, and what does it print?
    log = f"/tmp/stackgate-aud004-{token}.log"
    script = f"set -x\nprintf '%s\\n' \"$$\" > {procs_file}\necho rc=$?\ncat {procs_file}\ncat /proc/self/cgroup\n"
    proc = subprocess.run(["/bin/sh", "-c", script], capture_output=True, text=True, timeout=20)
    with open(log, "w", encoding="utf-8") as handle:
        handle.write(proc.stdout + "\n--stderr--\n" + proc.stderr)
    results.append(("shell_selfattach", {"returncode": proc.returncode, "stderr_tail": proc.stderr.strip().splitlines()[-4:],
                                         "stdout_tail": proc.stdout.strip().splitlines()[-6:]}))

    report["attempts"] = dict(results)

    # 5. is the restriction about the *source* cgroup? Compare with a sibling under app.slice
    for candidate in (f"{base}/app.slice", "/sys/fs/cgroup/user.slice/user-1000.slice"):
        report.setdefault("sibling_observability", {})[candidate] = {
            "exists": os.path.isdir(candidate),
            "writable": os.access(candidate, os.W_OK) if os.path.isdir(candidate) else False,
            "type": read(f"{candidate}/cgroup.type"),
            "subtree_control": read(f"{candidate}/cgroup.subtree_control"),
        }

    for pid in [int(x) for x in (read(procs_file) or "").split()]:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    try:
        child.kill()
    except OSError:
        pass
    child.wait(timeout=10)
    report["cleanup"] = {"procs_left": read(procs_file), "rmdir": None}
    try:
        os.rmdir(run_dir)
        report["cleanup"]["rmdir"] = "removed"
    except OSError as error:
        report["cleanup"]["rmdir"] = getattr(error, "strerror", str(error))
    report["leftover"] = [name for name in os.listdir(base) if name.startswith("stackgate-aud004")]
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
