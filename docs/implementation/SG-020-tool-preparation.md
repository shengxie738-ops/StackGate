# SG-020 real-tool preparation (not task completion)

Prepared on 2026-09-20 for the future SG-020 adapter. SG-018/SG-019 dependencies and the product adapter are not claimed complete. No compatibility lock, task ledger, schema, package, or progress file was changed by this preparation.

## Official binary and integrity

- Executable: `G:\StackGate\tools\bin\oasdiff-1.32.1\oasdiff.exe`.
- Observed version: `oasdiff version 1.32.1`; platform: native Windows x64.
- [Official versioned release](https://github.com/oasdiff/oasdiff/releases/tag/v1.32.1).
- [Official archive](https://github.com/oasdiff/oasdiff/releases/download/v1.32.1/oasdiff_1.32.1_windows_amd64.tar.gz).
- [Official checksum file](https://github.com/oasdiff/oasdiff/releases/download/v1.32.1/checksums.txt), retained at `tools/oasdiff/checksums-v1.32.1.txt`.
- Archive SHA-256: `4d0758b32d454e6011e59db93884af1ca27ae2b212d990f36738ea5efb5d7f28` (matches checksum file and GitHub release asset digest).
- Extracted executable SHA-256: `cce550834cddfa7584a5cfde8deb2a6a57effcbc445f040f4f7ac37da47e8173`.
- Metadata: `tools/oasdiff/installation.json`. The installation script intentionally labels capabilities UNVERIFIED; the separate executed probes below provide narrowly scoped evidence.
- Reproducible local installation: `node scripts/record.mjs SG-020 official-install -- pwsh -NoProfile -File tools/oasdiff/prepare.ps1`. The reviewed local script downloads only pinned official release assets, verifies the digest before execution, inspects archive member paths, and extracts into ignored `tools/bin/` without modifying global PATH or registry. The archive includes the upstream LICENSE.

GitHub's unauthenticated release API was rate limited during discovery. The official release page and expanded asset page worked, and the direct official release artifact/checksum downloads succeeded. There is no remaining tool-download blocker.

## Observed CLI contract

The real commands used `--format json --allow-external-refs=false`. Controlled probes also used an explicit empty configuration file and removed inherited `OASDIFF_*` variables. Their exact argv, stdout, stderr, exit codes and native executable path are retained individually under `tools/oasdiff/observations/`; the final record log retains all outputs, including failures.

| Probe | Observed result |
| --- | --- |
| target → candidate-correct, breaking `--fail-on ERR` | Exit 0; JSON `[]` |
| target → candidate-wrong | Exit 1; `response-property-type-changed`, level 3, GET `/api/performance` |
| target → candidate-missing | Exit 1; `response-required-property-removed`, level 3 |
| Request optional property becomes required | Exit 1; `request-property-became-required`, level 3 |
| Response enum expands | Exit 1; `response-property-enum-value-added`, level 3 |
| Breaking without `--fail-on` | Exit 0 **despite** the type-change finding |
| Diff with changed response type | Exit 0 by default; hierarchical object rooted at `paths.modified` |
| Same diff with `--fail-on-diff` | Exit 1 with the same structural difference |
| Identical diff | Exit 0; JSON `{}` |
| External HTTP `$ref` with equals-form deny flag | Exit 102; empty stdout; explicit disallowed-reference stderr; local listener received **0** requests |
| Same HTTP fixture, positive control with external refs true | Exit 0; `[]`; local listener received **1** request |
| External relative-file `$ref` with deny flag | Exit 102; disallowed-reference stderr |
| Explicit config with nonexistent `OASDIFF_CONFIG` path | Explicit config wins; expected breaking finding/exit 1 retained |

The HTTP server binds only loopback and serves the synthetic number schema. It is closed in `finally`. No arbitrary external URLs, metadata endpoints, repository scripts, global installers, or paid services were executed. Original `tests/fixtures/contracts/*.json` files were only read. Additional synthetic inputs and the probe are retained under `tests/fixtures/oasdiff/`.

## Adapter implications

The [versioned security documentation](https://github.com/oasdiff/oasdiff/blob/v1.32.1/docs/SECURITY.md) requires the equals form `--allow-external-refs=false`. The [versioned config documentation](https://github.com/oasdiff/oasdiff/blob/v1.32.1/docs/CONFIG-FILES.md) explains implicit working-directory config discovery and explicit config precedence. The adapter must supply its own config and audited temporary input paths, isolate cwd/environment, and reject external refs **before launching** the tool through SG-019. A tool-side refusal does not replace the preflight safety requirement.

Business breaking and tool failure are distinct: exit 1 plus a valid breaking array is a business result; the observed loader failure is exit 102 with no JSON. Invalid or unknown JSON structure must become ERROR; missing executable/capability must become BLOCKED. The default breaking exit 0 alone cannot indicate compatibility.

`breaking` emits an array of records containing raw rule `id`, `text`, numeric `level`, `operation`, `path`, `section`, optional `operationId`/`comment`, and `fingerprint` for these fixtures. `diff` emits a nested structural object, with no equivalent finding IDs. The real `oasdiff schema` and `checks changelog --id response-property-type-changed --format json` commands were captured. The upstream schema requires only `level`; StackGate will need stricter validation of the specific fields required for its normalization and precise approval matching. Preserve original IDs and raw bytes; do not parse human prose to derive identities, and do not treat `fingerprint` as a StackGate approval hash.

Real help says breaking `--fail-on` accepts ERR/WARN and defaults unset; diff uses the separate `--fail-on-diff` boolean. Pin exact commands and observed supported output, without `upgrade`, `auto-upgrade`, `flatten-allof`, `--fetch`, or `--open`. The [versioned diff docs](https://github.com/oasdiff/oasdiff/blob/v1.32.1/docs/DIFF.md) document path matching and comparison defaults; stable StackGate operation keys must preserve path parameter names rather than inheriting undocumented assumptions.

The [release notes](https://github.com/oasdiff/oasdiff/releases/tag/v1.32.1) explicitly retain some cycle nondeterminism/flattening limitations. These probes do not establish recursive schemas, complex composition, all OpenAPI 3.1 keywords, Linux/macOS, sandboxing, or full SG-020 adapter capabilities. SG-019 must continue to reject untested constructs.

## Actual evidence

| Recorded invocation | Exit | Evidence |
| --- | --- | --- |
| Pinned official download, checksum/extraction/version | 0 | [install](evidence/sg-020-official-install-2026-09-20T02-23-50-031Z.json) |
| `oasdiff breaking --help` | 0 | [help](evidence/sg-020-breaking-help-2026-09-20T02-24-13-053Z.json) |
| `oasdiff diff --help` | 0 | [help](evidence/sg-020-diff-help-2026-09-20T02-24-13-114Z.json) |
| Real breaking type-change counterexample | 1 (expected business failure) | [counterexample](evidence/sg-020-breaking-wrong-2026-09-20T02-24-13-152Z.json) |
| Real structural diff type change | 0 | [diff](evidence/sg-020-diff-wrong-2026-09-20T02-24-13-165Z.json) |
| `oasdiff schema` | 0 | [schema](evidence/sg-020-output-schema-2026-09-20T02-25-59-169Z.json) |
| Real rule catalog entry | 0 | [catalog](evidence/sg-020-rule-catalog-2026-09-20T02-25-59-178Z.json) |
| `node tests/fixtures/oasdiff/tool-preparation-probe.mjs` | 0; all 12 real process scenarios and associated assertions passed | [final probe](evidence/sg-020-real-tool-preparation-final-2026-09-20T02-26-43-741Z.json) |
| `pnpm exec eslint tests/fixtures/oasdiff/tool-preparation-probe.mjs` | 0 | [lint](evidence/sg-020-prep-lint-2026-09-20T02-26-45-978Z.json) |

An earlier successful probe is also retained at `sg-020-real-tool-preparation-2026-09-20T02-25-46-574Z.json`; later additions cover config precedence and file refs. Recorded native business-failure exit codes are intentionally preserved, not relabeled as command successes. Full `pnpm test:contract` and the product SG-020 contract suite are not executed by this preparation. No task DONE state or product support claim follows from installation or version output.
