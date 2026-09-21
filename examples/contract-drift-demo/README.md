# Contract drift demo

`apps/api` is a real FastAPI service (SG-051): it starts under uvicorn, answers `GET /api/performance`
with `data.performance.total_return = 0.1234`, and exports its own contract through `app.openapi()`.
`GET /health` reports readiness only and is intentionally absent from the exported business contract.
The React front end (SG-052), the acceptance IDs (SG-053), the HTTP probe helper (SG-054), the backend
observation endpoint (SG-055) and the Compose file (SG-057) are still to come, so no browser or environment
run here is observed yet. Contract fixtures under `tests/fixtures/contracts` remain synthetic inputs.

Run the API from `apps/api`:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m pytest
python scripts/export_openapi.py   # requires STACKGATE_OUTPUT_DIR of this attempt
```

Two constraints that later tasks must not rediscover the hard way:

- The exported response schema is stated **inline**, derived from the Pydantic models, because the confirmed
  target contract states it inline and the behavioral comparison is representation-sensitive by design. A
  `$ref` to `components.schemas` describes the same rules but does not compare equal to the target. Neither
  the target fixture nor the comparison is loosened to accommodate the framework.
- A restricted command environment needs `APPDATA` for Windows CPython to see its per-user site-packages;
  without it the pinned FastAPI install is invisible and every export fails as an import error. Register it
  in the demo command environment rather than passing the whole user environment through.

The export refuses to run without an injected `STACKGATE_OUTPUT_DIR`, refuses a path that is relative,
missing or already holding a contract, never reads a leftover `candidate-openapi.json` from the tree, and
exits 3 on an import failure instead of writing something that looks compatible. Exit 64 means the output
target was unusable; 3 means the application itself failed.

Fixture invariants that the real service must keep satisfying:

- Default baseline and confirmed-target sample use identical bytes and `data.performance.total_return: number`.
- `candidate-correct.json` preserves this response. `candidate-wrong.json` changes the number to string; `candidate-missing.json` removes the required field.
- A future browser demo deliberately reads the old field while its backend follows the new target. Independent Mock tests can pass; the real browser assertion must fail.
- Correct value `0.1234` must display `12.34%`. Missing/string/null data violate this target and cannot make API acceptance pass. A valid empty-state scenario needs its own explicitly permitting target; the UI must never display `NaN`.
- The separate upgrade pair moves old `data.total_return` to the new structure. The sample approval binds operation, rule and exact before/after byte hashes. It is DRAFT test data, not real authorization. The rule name follows the [official oasdiff rule](https://www.oasdiff.com/checks/response-required-property-removed); an actual oasdiff binary has not yet verified this pair.
- Before first demo confirmation, the change allowlist must include application sources and `apps/web/tests/performance.test.ts`; target contracts and `tests/acceptance/**` stay protected.

Run `pnpm exec vitest run tests/unit/fixtures.test.ts` and `pnpm verify:schemas`. PASS/FAIL/INCOMPLETE/ERROR/STALE goldens under `tests/fixtures/gate` exercise pure evaluation only.
