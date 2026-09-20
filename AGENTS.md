# StackGate implementation rules

- Resume from `docs/implementation/PROGRESS.md`, `tasks.json`, current Git status and relevant diff. Preserve unrelated user changes.
- Original requirements: `docs/specs/stackgate-v0.1.md`. Execution tasks: `docs/plans/2026-09-18-stackgate-v0.1-execution.md`. Read current task cards and their source sections locally.
- Follow task dependencies. Start each task with a failing test or counterexample, implement, run the specified checks, and retain actual commands, exit codes and logs. Unexecuted checks stay unverified.
- Record verification using `node scripts/record.mjs SG-NNN label -- command args...`. Update `docs/implementation/PROGRESS.md` and `tasks.json` after each task; no fabricated commits or DONE states.
- Keep schemas and shared contracts consistent. Gate decisions belong to deterministic core logic; tests and tools supply evidence. Never replace behavior with fixed PASS, remove required checks, or weaken confirmed contracts.
- No public publication, remote push/PR, production deployment or unapproved paid model calls. Local reversible implementation and verification are authorized.
- Keep test doubles under `tests/`. Retain real source bytes; do not rewrite the specification to match implementation.
