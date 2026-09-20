# SG-045 safe cleanup service

`CleanupService({stateRoot, owner, lockRoot?}).planCleanup(run_id)` is read-only. It returns a hashed READY, BLOCKED or EMPTY preview, resource identities and diagnostics suitable for doctor. `applyCleanup(plan, expected_hash)` is the only mutating entry point; it returns APPLIED, EMPTY or ERROR with the exact paths already deleted and diagnostic codes.

The service requires a terminal run with a verified evidence seal, a schema-valid `work/<run_id>/owner.json` matching repository/worktree/run, and verified completion of recorded command process cleanup. Historical PIDs are never authority to kill. Associated execution locks, unknown lock ownership, unsealed runs, junctions/symlinks, multiple hard links and changed resource identities prevent deletion. Unfinished runs are retained for inspection because their live-resource ownership cannot yet be proved. No Docker operation is supported.

Apply recomputes the preview and checks its expected hash, then resolves and checks each absolute target remains under the exact run workspace. It unlinks verified regular single-link files and removes only empty directories; it does not perform recursive deletion. Owner metadata is removed last before the empty run directory. Evidence, seals, plans, state roots, user services and the retained dependency patch scratch directory are outside its deletion scope. Partial failure returns ERROR and preserves all sealed evidence.

The API is intentionally conservative and does not recover stale execution locks or terminate orphan processes. Only the original live resource owner may release such locks. CLI wiring and whole-run cancellation integration remain with the parent tasks SG-039/SG-044; these tests independently exercise the cleanup service on Windows.
