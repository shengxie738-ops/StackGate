#!/bin/sh
# AUD-004 step 1: measure the cgroup v2 semantics LinuxRunner will depend on.
#
# Run it inside the systemd-delegated subtree, never from a plain WSL login:
#   wsl.exe -e sh -c "tr -d '\015' < tests/support/aud004_scope_probe.sh > /tmp/sgprobe.sh && \
#     systemd-run --user --scope --collect -- sh /tmp/sgprobe.sh"
# A plain session sits in root-owned /init.scope, and the kernel then refuses migration into the
# delegated subtree with EACCES even for a process writing its own PID.
#
# The supervisor deliberately stays OUTSIDE the run cgroup it creates: a previous revision of this
# probe attached its own shell and then froze the subtree, which stopped the shell from ever
# reaching its thaw step. Every cgroup created here is named stackgate-aud004-* and removed below.
set -u
U=$(id -u)
BASE=$(grep -m1 '^0::' /proc/self/cgroup | cut -d: -f3 | sed 's|^/||')
ROOT=/sys/fs/cgroup/$BASE
RUN=$ROOT/stackgate-aud004-run
STRAY=$ROOT/stackgate-aud004-stray
MARK=/tmp/stackgate-aud004-heartbeat
LAUNCH=/tmp/stackgate-aud004-launch.sh

say() { printf '%s\n' "$1"; }
[ -d "$ROOT" ] || { say "root=$ROOT missing"; exit 1; }

# The launcher is the production shape: attach first, only then exec the target, so no descendant
# can ever exist outside the run cgroup. exec keeps the PID, so the target inherits membership.
rm -f "$MARK"
cat > "$LAUNCH" <<'EOF'
#!/bin/sh
# usage: attest-launch.sh <cgroup.procs> <heartbeat-file> <target> [args...]
printf '%s\n' "$$" > "$1" || exit 3
shift
HBFILE=$1
: > "$HBFILE" || exit 4
shift
( while :; do printf . >> "$HBFILE"; sleep 0.2; done ) &
HB=$!
trap 'kill "$HB" 2>/dev/null' EXIT
exec "$@"
EOF
chmod 700 "$LAUNCH"
say "supervisor_cgroup=$(cat /proc/self/cgroup)"
say "root_owner=$(stat -c '%u %a' "$ROOT")"
say "root_subtree_control=$(cat "$ROOT"/cgroup.subtree_control)"

rm -rf "$RUN" "$STRAY"
mkdir -p "$RUN" || { say "mkdir_run=FAIL"; exit 1; }
say "run_dir_owner=$(stat -c '%u %a' "$RUN/cgroup.procs")"
say "run_kill_owner=$(stat -c '%u %a' "$RUN/cgroup.kill" 2>/dev/null || echo absent)"
say "run_freeze_owner=$(stat -c '%u %a' "$RUN/cgroup.freeze" 2>/dev/null || echo absent)"
say "run_initial_members=[$(tr '\n' ' ' < "$RUN"/cgroup.procs)]"

# 1. a launched process attaches itself; does the kernel let it, and do its forks follow?
sh "$LAUNCH" "$RUN/cgroup.procs" "$MARK" sleep 40 &
TARGET=$!
i=0
while [ $i -lt 40 ]; do
  grep -q "^$TARGET$" "$RUN"/cgroup.procs 2>/dev/null && break
  i=$((i+1)); sleep 0.1
done
say "attach_member_found=$(grep -cx "$TARGET" "$RUN"/cgroup.procs)"
say "target_cgroup=$(cut -d: -f3 /proc/$TARGET/cgroup)"
say "run_members=[$(tr '\n' ' ' < "$RUN"/cgroup.procs)]"
say "supervisor_still_outside=$(cut -d: -f3 /proc/self/cgroup)"

# 2. freeze must be observable from outside, and must stop the heartbeat without killing it
BEFORE=$(wc -c < "$MARK" 2>/dev/null || echo 0)
printf 1 > "$RUN/cgroup.freeze" && say "freeze_write=ok"
sleep 1
FROZEN=$(wc -c < "$MARK" 2>/dev/null || echo 0)
GROWTH=$((FROZEN - BEFORE))
say "heartbeat_growth_while_frozen=$GROWTH"
say "members_while_frozen=[$(tr '\n' ' ' < "$RUN"/cgroup.procs)]"
printf 0 > "$RUN/cgroup.freeze" && say "thaw_write=ok"
sleep 0.6
AFTER=$(wc -c < "$MARK" 2>/dev/null || echo 0)
say "heartbeat_resumed=$((AFTER - FROZEN))"

# 3. rmdir with members still inside: v2 migrates them upward, so removal is not proof of emptiness
mkdir -p "$STRAY"
sh "$LAUNCH" "$STRAY/cgroup.procs" "$MARK" sleep 25 &
STRAY_TARGET=$!
sleep 0.4
say "stray_members=[$(tr '\n' ' ' < "$STRAY"/cgroup.procs)]"
if rmdir "$STRAY" 2>/dev/null; then say "rmdir_with_members=succeeded"; else say "rmdir_with_members=refused"; fi
say "stray_target_cgroup_now=$(cut -d: -f3 /proc/$STRAY_TARGET/cgroup 2>/dev/null || echo gone)"
kill -9 "$STRAY_TARGET" 2>/dev/null
wait "$STRAY_TARGET" 2>/dev/null
# Killing the launched program does not empty the subtree: the heartbeat it left behind is still a member.
# This is exactly why reclaim is done over the member set rather than over one pid.
printf 1 > "$STRAY/cgroup.kill" 2>/dev/null && say "stray_kill_all=ok"
for _ in 1 2 3 4 5 6 7 8 9 10; do rmdir "$STRAY" 2>/dev/null && break; sleep 0.2; done
say "stray_members_left=[$(tr '\n' ' ' < "$STRAY"/cgroup.procs 2>/dev/null)]"
say "stray_removed=$([ -d "$STRAY" ] && echo no || echo yes)"

# 4. atomic reclaim of our own subtree, then prove the member set is empty
printf 1 > "$RUN/cgroup.kill" && say "kill_all_write=ok"
sleep 0.5
say "members_after_kill=[$(tr '\n' ' ' < "$RUN"/cgroup.procs)]"
say "pids_current_after_kill=$(cat "$RUN"/pids.current)"
say "nr_descendants=$(awk '{print $2}' "$RUN"/cgroup.stat)"
wait "$TARGET" 2>/dev/null
if rmdir "$RUN" 2>/dev/null; then say "run_rmdir_after_empty=ok"; else say "run_rmdir_after_empty=refused"; fi
rm -f "$LAUNCH" "$MARK"
say "leftover_aud004_dirs=[$(ls "$ROOT" | grep stackgate-aud004 | tr '\n' ' ')]"
say "done"
