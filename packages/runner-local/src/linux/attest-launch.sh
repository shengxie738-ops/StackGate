#!/bin/sh
# usage: attest-launch.sh <cgroup.procs> <status-file> <target> [args...]
#
# The target joins the run cgroup before it can fork, so no descendant can be born outside the subtree
# the runner later claims to reclaim. A parent-side write would leave exactly that window, and exec keeps
# the pid, so the identity the runner recorded at attach time is the identity of the reviewed program.
set -u
procs=$1
status=$2
shift 2
if ! printf '%s\n' "$$" > "$procs" 2>/dev/null; then
  printf 'ATTACH_FAILED\n' > "$status"
  exit 3
fi
printf 'ATTACHED %s\n' "$$" > "$status"
exec "$@"
