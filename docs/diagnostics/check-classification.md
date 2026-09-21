# Check result classification

Normative source: execution plan section 7.3 (step status classification) and section 4.2 (exit code
priority). `tests/integration/runner/negative-matrix.test.ts` is the executable counterpart: it runs real
child processes, writes real reports, seals real evidence, and asserts check status, verdict, freshness,
decision, exit code and reason for every row. This table is the reading key for those outcomes; it does not
add rules the matrix does not test.

## Real situation to Gate outcome

| Real situation | Check fact | Gate outcome |
|---|---|---|
| Command exits 0 with no testcase requirement (type check style) | `PASS` / exit-code | Satisfies that check |
| JUnit reports a failure, process exit 0 or non-zero | `FAIL`, raw exit preserved | required `FAIL` / 1 |
| Report absent, no stronger tool-damage evidence | `BLOCKED` / `MISSING_REPORT` | `INCOMPLETE` / 2 |
| Report syntax broken, cross-run impersonation, or sealed digest mismatch | `ERROR` / `REPORT_INVALID` | `ERROR` / 3 |
| Zero required tests discovered or executed | `BLOCKED` / `NO_TESTS` | `INCOMPLETE` / 2 |
| Tool cannot start, parser throws, protocol version unsupported | `ERROR` / `TOOL_FAILURE` or `TOOL_UNSUPPORTED` | `ERROR` / 3 |
| Missing required tool detectable before execution | `BLOCKED` / `DEPENDENCY_MISSING` | `INCOMPLETE` / 2, step never started |
| Upstream environment not ready | downstream `BLOCKED` / `DEPENDENCY_BLOCKED` | `INCOMPLETE` / 2 |
| Required schema feature unsupported | `BLOCKED` / `UNSUPPORTED_SCHEMA` | `INCOMPLETE` / 2 |
| Supported schema clearly violated by the target | `FAIL` / `SCHEMA_MISMATCH` | `FAIL` / 1 |
| Cancellation | facts already observed retained, unfinished work `BLOCKED` / `CANCELED` | `INCOMPLETE` / 2 by default; integrity errors may take 3 |

## Exit code priority

`64 -> 3 -> 4 -> 1 -> 2 -> 0`, keeping every reason. A combination never resolves to the "nicest" number in
a table row: report-integrity and evidence errors outrank staleness, which outranks business failure.
`raw_exit_code` inside a check result and the Gate exit code are different fields and are never conflated.

## Rules the matrix enforces

- A non-zero process exit is never by itself evidence of a business assertion failure. Where tool-crash
  evidence is sufficient the result is `ERROR`; otherwise the absent report is `INCOMPLETE`. Diagnostic
  text therefore names the failing check and evidence reference instead of implying source-code edits.
- `report` succeeding with exit 0 never means the gate passed. Exit 0 from `report` or `handoff` only means
  the read-only operation completed; CI must use the `run` or `gate` exit code.
- Zero executed required tests cannot PASS, whatever the process exit code was.
- Baseline failure provenance on a test annotation is origin information only. It never exempts the current
  required check from its own failure.
- Presence of a report file is never "all requirements met": required test IDs, minimum executed counts and
  sealed evidence are each verified independently.
- An unsealed, missing or corrupted run is reported as `INCOMPLETE`/`ERROR` with `PLAN_UNVERIFIED` or
  `REPORT_UNVERIFIED` prefixes. Unknown required sets are never rendered as satisfied.

## Renderer semantics

The JSON, terminal, Markdown and JUnit renderers project the same authenticated report view and cannot
disagree about decision, verdict, freshness, exit code or reasons. JUnit output is display only: its
`testsuite` failure/error/skipped counts and the synthetic `stackgate.gate` testcase describe the recorded
result but do not decide a CI job status. A pipeline must propagate the `run` or `gate` exit code. A JUnit
document that looks green cannot turn a DENY into a pass, and a `report` or `handoff` exit 0 only means the
read-only projection was produced.

## Related documents

- [Local execution recovery](recovery.md) — crash, concurrency, lock ownership and cleanup behaviour.
- [Compatibility notes](../COMPATIBILITY.md) — which tool capabilities are actually verified on this host.
