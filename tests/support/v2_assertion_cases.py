"""Test support: run the shared assertion and parse table through the production Python evaluator.

Prints one JSON object with two arrays of rows: `assertion` (name, passed, reason) and `parse`
(name, status, reason, root). Every row comes from `presets/fastapi-react/scripts/probe_helpers.py` - the same
module the sample probe imports - so a divergence from the TypeScript core is a product defect and not an
artifact of this harness. Nothing here reimplements a pointer rule, a type rule or a JSON refusal.

Assertion bodies are parsed with the plain `json.loads`, deliberately below the strict gate: the point of those
rows is that the assertion layer itself refuses a non-finite number. Parse bodies go through
`helpers.parse_json_response`, the strict entry.

The table itself is `tests/fixtures/v2-regressions/assertions.json`, shared with
`tests/unit/v2/probe-assertions.test.ts` and `tests/contract/probe-assertions-parity.test.ts`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "presets" / "fastapi-react" / "scripts"))

import probe_helpers as helpers  # noqa: E402


def root_kind(value) -> str:
    """Classify a parsed root the way the reader does, without borrowing the product's private helper."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "absent"


def assertion_rows(table) -> list:
    rows = []
    for case in table["assertion_cases"]:
        document = json.loads(case["body"])
        assertion = {"assertion_id": case["name"], "pointer": case["pointer"], "operator": case["operator"]}
        if "expected" in case:
            assertion["expected"] = case["expected"]
        outcome = helpers.assertion_outcome(document, assertion)
        rows.append({"name": case["name"], "passed": bool(outcome["passed"]), "reason": outcome["reason"]})
    return rows


def parse_rows(table) -> list:
    rows = []
    for case in table["parse_cases"]:
        data = (bytes.fromhex(case["body_hex"]) if "body_hex" in case
                else case["body"].encode("utf-8"))
        arguments = {}
        if "max_bytes" in case:
            arguments["max_bytes"] = case["max_bytes"]
        if "max_depth" in case:
            arguments["max_depth"] = case["max_depth"]
        try:
            value = helpers.parse_json_response(data, **arguments)
        except helpers.ProbeError as error:
            rows.append({"name": case["name"], "status": "refused", "reason": error.code, "root": None})
            continue
        rows.append({"name": case["name"], "status": "parsed", "reason": None, "root": root_kind(value)})
    return rows


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -B -E tests/support/v2_assertion_cases.py <fixture.json>", file=sys.stderr)
        return 64
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        table = json.load(handle)
    groups = {"assertion": assertion_rows(table), "parse": parse_rows(table)}
    print(json.dumps(groups, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
