# Contract drift fixtures (M0)

These are synthetic fixtures, not observed service or browser runs. Real FastAPI/React execution is SG-051 onward.

- Default baseline and confirmed-target sample use identical bytes and `data.performance.total_return: number`.
- `candidate-correct.json` preserves this response. `candidate-wrong.json` changes the number to string; `candidate-missing.json` removes the required field.
- A future browser demo deliberately reads the old field while its backend follows the new target. Independent Mock tests can pass; the real browser assertion must fail.
- Correct value `0.1234` must display `12.34%`. Missing/string/null data violate this target and cannot make API acceptance pass. A valid empty-state scenario needs its own explicitly permitting target; the UI must never display `NaN`.
- The separate upgrade pair moves old `data.total_return` to the new structure. The sample approval binds operation, rule and exact before/after byte hashes. It is DRAFT test data, not real authorization. The rule name follows the [official oasdiff rule](https://www.oasdiff.com/checks/response-required-property-removed); an actual oasdiff binary has not yet verified this pair.
- Before first demo confirmation, the change allowlist must include application sources and `apps/web/tests/performance.test.ts`; target contracts and `tests/acceptance/**` stay protected.

Run `pnpm exec vitest run tests/unit/fixtures.test.ts` and `pnpm verify:schemas`. PASS/FAIL/INCOMPLETE/ERROR/STALE goldens under `tests/fixtures/gate` exercise pure evaluation only.
