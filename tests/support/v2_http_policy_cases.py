"""Test support: run the shared HTTP authorization table through the production Python helper.

Prints one JSON array of {name, allowed, reason}. The decision comes from probe_helpers.authorize_request,
the same function perform_request consults before anything reaches the network, so a divergence between
languages is a product defect and not an artifact of this harness.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "presets" / "fastapi-react" / "scripts"))

import probe_helpers as helpers  # noqa: E402


def decode(value):
    if isinstance(value, str):
        if value.startswith("__string__:"):
            return value[len("__string__:"):]
        if value == "__nan__":
            return float("nan")
        if value == "__infinity__":
            return float("inf")
        if value == "__negative_infinity__":
            return float("-inf")
    return value


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python tests/support/v2_http_policy_cases.py <fixture.json>", file=sys.stderr)
        return 64
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        table = json.load(handle)
    rows = []
    for case in table["cases"]:
        policy = {key: decode(value) for key, value in (case.get("policy") or {}).items()}
        declared = case["declared_operation_key"] if "declared_operation_key" in case else table["declaration"]
        decision = helpers.authorize_request(
            origin=case.get("origin", table["origin"]),
            method=case.get("method", "GET"),
            path=case.get("path", table["path"]),
            declared_operation_key=declared,
            allowed_origins=case.get("allowed_origins", [table["origin"]]),
            deadline_ms=policy.get("deadline_ms", helpers.DEFAULT_DEADLINE_MS),
            max_response_bytes=policy.get("max_response_bytes", helpers.MAX_RESPONSE_BYTES),
            service_origins=case.get("service_origins"),
        )
        rows.append({"name": case["name"], "allowed": bool(decision["allowed"]), "reason": decision["reason"]})
    print(json.dumps(rows, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
