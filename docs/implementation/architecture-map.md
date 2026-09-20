# Implemented module map

| Entry | Responsibility | Boundary |
| --- | --- | --- |
| `scripts/verify-source.mjs` | Compare original and retained bytes; enforce supplied requirement SHA-256 | Read-only source verification |
| `scripts/verify-tasks.mjs` | Validate all 100 task records, immutable index, dependencies and evidence links | Development task ledger; no product Gate decision |
| `scripts/record.mjs` | Execute local verification command and save timestamps, exit code and log | Development-only subprocess evidence; no implicit shell |
| `tests/bootstrap/ledger.test.mjs` | Positive and rejection checks for source and ledger | Node built-in tests before package dependencies |
| `apps/cli/src/main.ts` | Built init/doctor/task validate/task confirm/trust/scan plus help/version | Strict arguments; static JSON output is not Gate approval; no business runner |
| `schemas/0.1/` + `packages/contracts/src/generated/` | Strict structures and generated types | Schema is the single structural source; drift fails verification |
| `packages/contracts/src/validation.ts` | Ajv validation and JSON-pointer diagnostics | No coercion or default mutation; structural validation does not authenticate provenance |
| `packages/core/src/domain/` | Gate aggregation/exit priority, capability negotiation, event reduction | Deterministic pure logic; no I/O, system time or models |
| `packages/core/src/ports/` | Git, process runner, environment, evidence, clock/ID and adapter contracts | Runner/environment interfaces remain unexecuted in M1 |
| `packages/core/src/storage/` | Safe path/link inspection, raw byte hashing, canonical JSON and atomic writes | Storage I/O stays outside pure domain; explicit root and overwrite precondition; SG-011 |
| `scripts/verify-boundaries.mjs` | AST dependency and forbidden-operation checks | Product cannot import test doubles; reporter cannot invoke runner/service |
| `tests/support/` | Isolated factories, fake adapter and temporary fixture helpers | Never imported by product build |
| `tests/fixtures/contracts/` | Baseline/target/candidate and separately approved upgrade examples | Failure candidates do not modify protected target |
| `tests/fixtures/gate/` | Literal PASS/FAIL/INCOMPLETE/ERROR/STALE expected outcomes | Fixture data, not executed product evidence |
| `tests/contract/toolchain.test.ts` | Actual external tool contracts | Executes real compiler, bundler and validators |
| `scripts/verify-stage.mjs` | M0/M1 registered checks with actual child exits/logs and requested-stage binding | M1 requires integration and real oasdiff; M2+ explicitly unimplemented |
| `tools/compatibility-lock.json` | Observed versions, integrity and evidence references | Unknown integration capabilities remain UNKNOWN |
| `packages/adapter-git/src/` | Actual baseline/worktree inspection and tracked/staged/dirty/untracked byte manifest | No fetch, hooks, filters, external diff or repository shell execution; explicit incomplete scope |
| `packages/adapter-oasdiff/src/` | Strict OpenAPI load/ref/capability checks, pinned real tool, directional Ajv validation | No external references, unknown rules or coercion; schema validation is not business validation |
| `packages/adapter-typescript/src/` | Explicit mappings and in-memory Compiler API source graph | No tsconfig JS/plugins/code execution; candidates and unresolved edges remain distinct |
| `packages/core/src/services/` | Config, task, trust, contract, initialization and scan orchestration | Immutable task revisions, outside-repository trust store, static scan with protected drift and runtime gaps |
| `packages/core/src/domain/select-checks.ts` | Required union, provenance and conservative fallback | Missing authority or coverage remains a gap; required checks cannot be optimized away |
| `packages/core/src/domain/protected-input-drift.ts` | Confirmed acceptance input and check contract comparison | Ambiguous changes require review; actual runtime inventory belongs to later stages |

Build exports `dist/cli.mjs`, `dist/core.mjs`, `dist/contracts.mjs`, declaration files, presets and schemas. Real business runner, browser/container acceptance, report UI and release packaging remain later stages. M1 raw tool records are retained by adapter APIs; the public scan projection uses output digests and relative source labels.
