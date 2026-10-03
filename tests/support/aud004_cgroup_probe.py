"""AUD-004 step 1: measure the real cgroup v2 semantics this host offers.

Every fact printed here is read from the running kernel. Nothing is assumed from
documentation, and the script refuses to run anywhere but Linux so a Windows result
can never be re-labelled as platform evidence. It only creates cgroups inside the
subtree already delegated to the invoking uid, and removes the ones it created.

Usage: python3 -B tests/support/aud004_cgroup_probe.py
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import uuid

READ_ONLY_FILES = ("cgroup.controllers", "cgroup.stat", "pids.current")


def read(file: str) -> str | None:
    try:
        with open(file, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def observe(path: str) -> dict[str, object]:
    """Filesystem identity plus the mode and ownership the kernel actually set."""
    entry: dict[str, object] = {"path": path}
    try:
        info = os.stat(path)
    except OSError as error:
        entry["stat_error"] = errno_name(error)
        return entry
    entry.update(mode=oct(info.st_mode & 0o7777), uid=info.st_uid, gid=info.st_gid,
                 inode=info.st_ino, is_dir=os.path.isdir(path))
    entry["writable"] = os.access(path, os.W_OK)
    return entry


def errno_name(error: OSError) -> str:
    return getattr(error, "strerror", None) or str(error)


def write_text(file: str, payload: str) -> dict[str, object]:
    """Attempt one write and report the kernel's exact answer, never a guess."""
    record = {"file": file, "payload": payload.strip()}
    try:
        with open(file, "w", encoding="utf-8") as handle:
            handle.write(payload)
        record["written"] = True
    except OSError as error:
        record["written"] = False
        record["error"] = errno_name(error)
        record["errno"] = getattr(error, "errno", None)
    return record


def procs(dir_path: str) -> list[int]:
    raw = read(f"{dir_path}/cgroup.procs")
    return [] if raw is None else [int(item) for item in raw.split()]


def cgroup_of(pid: int) -> str | None:
    raw = read(f"/proc/{pid}/cgroup")
    if raw is None:
        return None
    for line in raw.splitlines():
        if line.startswith("0::"):
            return line[3:].strip()
    return None


def mount_facts() -> dict[str, object]:
    lines = (read("/proc/self/mountinfo") or "").splitlines()
    unified = [line.split(" - ", 1)[1] for line in lines if " cgroup2 " in (" " + line.split(" - ", 1)[-1] + " ")]
    return {
        "kernel": (read("/proc/sys/kernel/osrelease") or "").strip(),
        "uid": os.getuid(),
        "gid": os.getgid(),
        "euid": os.geteuid(),
        "groups": sorted(os.getgroups()),
        "self_cgroup": (read("/proc/self/cgroup") or "").strip(),
        "cgroup2_mounts": unified,
        "boot_id": (read("/proc/sys/kernel/random/boot_id") or "").strip(),
        "pid_max": (read("/proc/sys/kernel/pid_max") or "").strip(),
    }


def delegated_root(uid: int) -> str:
    """The only subtree the script may touch: the caller's own user service slice."""
    return f"/sys/fs/cgroup/user.slice/user-{uid}.slice/user@{uid}.service"


def launch_attached(launcher: str, procs_file: str, seconds: int) -> subprocess.Popen[bytes]:
    return subprocess.Popen([launcher, procs_file, "sleep", str(seconds)], stdout=subprocess.DEVNULL)


def main() -> int:
    if sys.platform != "linux":
        print(json.dumps({"refused": "NOT_LINUX", "platform": sys.platform}))
        return 64

    report: dict[str, object] = {"observed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    report["host"] = mount_facts()
    base = delegated_root(os.getuid())
    report["delegated_base"] = observe(base) if os.path.exists(base) else {"path": base, "stat_error": "missing"}
    if not os.path.isdir(base):
        print(json.dumps(report, indent=2))
        return 1

    report["base_readonly_files"] = {name: read(f"{base}/{name}") for name in READ_ONLY_FILES}
    # Deliberately no write attempt against the shared user-service cgroup: `cgroup.kill` there
    # would signal the user's whole session. Only the private subtree is exercised.

    token = uuid.uuid4().hex
    run_dir = f"{base}/stackgate-aud004-{token}"
    report["mkdir_private_run"] = {"dir": run_dir}
    try:
        os.mkdir(run_dir)
        report["mkdir_private_run"]["created"] = True
    except OSError as error:
        report["mkdir_private_run"].update(created=False, error=errno_name(error))
        print(json.dumps(report, indent=2))
        return 1

    created = run_dir
    try:
        report["child_ownership"] = {name: observe(f"{created}/{name}")
                                     for name in ("cgroup.procs", "cgroup.freeze", "cgroup.subtree_control",
                                                  "cgroup.kill", "pids.current", "cgroup.type")}
        report["child_controllers_inherited"] = read(f"{created}/cgroup.controllers")
        report["child_procs_initial"] = procs(created)

        launcher_dir = tempfile.mkdtemp(prefix="stackgate-aud004-")
        launcher_path = os.path.join(launcher_dir, "attach.sh")
        with open(launcher_path, "x", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\n"
                         "printf '%s\\n' \"$$\" > \"$1\" || exit 3\n"
                         "shift\n"
                         "\"$@\" &\n"
                         "child=$!\n"
                         "sleep 20 &\n"
                         "wait $child\n")
        os.chmod(launcher_path, 0o700)

        attached = launch_attached(launcher_path, f"{created}/cgroup.procs", 18)
        deadline = time.monotonic() + 5.0
        members: list[int] = []
        while time.monotonic() < deadline:
            members = procs(created)
            if len(members) >= 2:
                break
            time.sleep(0.1)
        report["self_attach"] = {
            "launcher_pid": attached.pid,
            "members_after_attach": sorted(members),
            "launcher_in_own_subtree": cgroup_of(attached.pid),
            "descendants_inside_subtree": sorted(pid for pid in members if pid != attached.pid),
            "launcher_self_reported_cgroup": cgroup_of(attached.pid),
        }

        # rmdir on a cgroup that still has members: v2 migrates them to the parent instead of
        # refusing, so removing our own directory can never be used as proof of an empty set.
        stray = f"{base}/stackgate-aud004-stray-{token}"
        os.mkdir(stray)
        stray_child = launch_attached(launcher_path, f"{stray}/cgroup.procs", 15)
        time.sleep(0.6)
        stray_members = procs(stray)
        rmdir_record = {"dir": stray, "members_before_rmdir": sorted(stray_members)}
        try:
            os.rmdir(stray)
            rmdir_record["rmdir_succeeded_with_members"] = True
        except OSError as error:
            rmdir_record.update(rmdir_succeeded_with_members=False, error=errno_name(error))
        rmdir_record["where_members_went"] = {str(pid): cgroup_of(pid) for pid in stray_members}
        for pid in stray_members:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        rmdir_record["stray_killed"] = True
        stray_child.wait(timeout=10)
        report["rmdir_with_members"] = rmdir_record

        # cgroup.kill is the only atomic whole-subtree signal, so whether the delegation hands it
        # over decides if signalling each pid is the only available reclaim path.
        kill_dir = f"{base}/stackgate-aud004-kill-{token}"
        os.mkdir(kill_dir)
        kill_child = launch_attached(launcher_path, f"{kill_dir}/cgroup.procs", 12)
        time.sleep(0.6)
        kill_record = {"dir": kill_dir, "members_before": sorted(procs(kill_dir)),
                       "file": observe(f"{kill_dir}/cgroup.kill")}
        kill_record.update(write_text(f"{kill_dir}/cgroup.kill", "1"))
        time.sleep(0.5)
        kill_record["members_after_kill_write"] = sorted(procs(kill_dir))
        for pid in procs(kill_dir):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        kill_child.wait(timeout=10)
        try:
            os.rmdir(kill_dir)
            kill_record["removed"] = True
        except OSError as error:
            kill_record.update(removed=False, error=errno_name(error))
        report["cgroup_kill_attempt"] = kill_record

        # A frozen subtree cannot fork, which is what makes "kill the members" safe to repeat.
        freeze = {"file": observe(f"{created}/cgroup.freeze")}
        freeze.update(write_text(f"{created}/cgroup.freeze", "1"))
        if freeze.get("written"):
            time.sleep(0.3)
            freeze["procs_while_frozen"] = sorted(procs(created))
            freeze["thaw"] = write_text(f"{created}/cgroup.freeze", "0")
        report["freeze_attempt"] = freeze

        # Reclaim path the runner will use: signal the whole member set, re-read, repeat.
        rounds = []
        for _ in range(5):
            current = procs(created)
            if not current:
                break
            for pid in current:
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError as error:
                    rounds.append({"pid": pid, "kill_error": errno_name(error)})
            time.sleep(0.2)
            rounds.append({"attempted": len(current), "remaining": procs(created)})
        report["reclaim_rounds"] = rounds
        report["procs_empty_after_reclaim"] = procs(created) == []
        report["cgroup_events"] = read(f"{created}/cgroup.events")
        report["stat_after_reclaim"] = read(f"{created}/cgroup.stat")
    finally:
        for pid in procs(created):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        try:
            os.rmdir(created)
            report["run_dir_removed"] = True
        except OSError as error:
            report.update(run_dir_removed=False, run_dir_remove_error=errno_name(error))
        report["run_dir_still_exists"] = os.path.isdir(created)
        stray_left = [name for name in os.listdir(base) if name.startswith("stackgate-aud004")]
        report["leftover_probe_dirs"] = stray_left

    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
