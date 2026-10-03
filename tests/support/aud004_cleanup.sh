#!/bin/sh
# Remove any stackgate-aud004-* cgroup this probe may have left behind, reclaiming the whole member set
# first. Killing only the program it launched is not enough: the heartbeat it forks is still a member.
FOUND=$(find /sys/fs/cgroup -maxdepth 8 -type d -name 'stackgate-aud004-*' 2>/dev/null | tr '\n' ' ')
echo "found=[$FOUND]"
for dir in $FOUND; do
  echo "dir=$dir members=[$(tr '\n' ' ' < "$dir/cgroup.procs")]"
  printf 1 > "$dir/cgroup.kill" 2>/dev/null && echo killed_all=ok
  sleep 0.5
  echo left=[$(tr '\n' ' ' < "$dir/cgroup.procs" 2>/dev/null)]
  rmdir "$dir" && echo "removed=$dir"
done
echo "sleep_loops=[$(ps -eo pid,args | grep '[s]leep 0.2' | tr '\n' ';')]"
echo "remaining_aud004=[$(find /sys/fs/cgroup -maxdepth 7 -name 'stackgate-aud004-*' -type d 2>/dev/null | tr '\n' ' ')]"
