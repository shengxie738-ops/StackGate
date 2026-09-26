"""Declared-operations probe for the contract-drift sample.

Executes exactly the one GET registered in the declaration file and records what actually happened.
Everything it reports about assertion outcomes is a self-report; StackGate recomputes the assertions
from the recorded response bytes and the independent backend observation.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

PRESETS = Path(__file__).resolve().parents[5] / "presets" / "fastapi-react" / "scripts"
sys.path.insert(0, str(PRESETS))

import probe_helpers as helpers  # noqa: E402


def main() -> int:
    output_dir = os.environ.get("STACKGATE_OUTPUT_DIR", "")
    declaration_path = os.environ.get("STACKGATE_PROBE_DECLARATION", "")
    origin = os.environ.get("STACKGATE_API_ORIGIN", "")
    allowed = [item for item in os.environ.get("STACKGATE_ALLOWED_ORIGINS", "").split(",") if item]
    identity = {
        "run_id": os.environ.get("STACKGATE_RUN_ID", ""),
        "check_id": os.environ.get("STACKGATE_CHECK_ID", ""),
        "attempt_id": os.environ.get("STACKGATE_ATTEMPT_ID", ""),
        "request_id": os.environ.get("STACKGATE_REQUEST_ID", "request_performance_1"),
    }
    if not output_dir or not os.path.isabs(output_dir):
        print("absolute STACKGATE_OUTPUT_DIR is required", file=sys.stderr)
        return 2
    if not declaration_path or not os.path.isfile(declaration_path):
        print("STACKGATE_PROBE_DECLARATION must point at a confirmed declaration file", file=sys.stderr)
        return 2
    with open(declaration_path, "r", encoding="utf-8") as handle:
        declaration = json.load(handle)

    try:
        record = helpers.perform_request(
            origin=origin,
            operation_key=declaration["operation_key"],
            allowed_origins=allowed,
            identity=identity,
            deadline_ms=int(declaration.get("deadline_ms", helpers.DEFAULT_DEADLINE_MS)),
            max_response_bytes=int(declaration.get("max_response_bytes", helpers.MAX_RESPONSE_BYTES)),
        )
    except helpers.ProbeError as error:
        helpers.write_json(os.path.join(output_dir, "probe-error.json"),
                           {"schema_version": "0.1", "reason": error.code, "detail": error.detail, **identity})
        print(f"{error.code}: {error.detail}", file=sys.stderr)
        return 2

    body_path = os.path.join(output_dir, "responses", f"{record['request_id']}.json")
    os.makedirs(os.path.dirname(body_path), exist_ok=True)
    with open(body_path, "wb") as handle:
        handle.write(record["body"])

    try:
        parsed = json.loads(record["body"].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        parsed = None

    self_assertions = []
    for assertion in declaration.get("assertions", []):
        try:
            passed = bool(helpers.evaluate_assertion(parsed, assertion)) if parsed is not None else False
        except helpers.ProbeError:
            passed = False
        self_assertions.append({"assertion_id": assertion["assertion_id"], "passed": passed})

    status_ok = record["status_code"] == declaration.get("expected_status")
    media_ok = record["media_type"] == declaration.get("expected_media_type", record["media_type"])
    report = {
        "schema_version": "0.1",
        "kind": "stackgate-probe",
        "run_id": identity["run_id"],
        "check_id": identity["check_id"],
        "attempt_id": identity["attempt_id"],
        "instance_id": record["instance_id"] or "unknown",
        "completed": True,
        "operations": [{
            "operation_key": declaration["operation_key"],
            "request_id": record["request_id"],
            "status_code": record["status_code"],
            "media_type": record["media_type"],
            "schema_valid": bool(status_ok and media_ok and parsed is not None),
            "response_body": parsed,
            "assertions": self_assertions,
            "backend_observation_ref": f"responses/{os.path.basename(body_path)}",
        }],
    }
    helpers.write_json(os.path.join(output_dir, "probe.json"), report)
    helpers.write_json(os.path.join(output_dir, "probe-raw.json"), {
        "schema_version": "0.1",
        "run_id": identity["run_id"],
        "check_id": identity["check_id"],
        "attempt_id": identity["attempt_id"],
        "request_id": record["request_id"],
        "operation_key": record["operation_key"],
        "origin": origin,
        "started_at": record["started_at"],
        "finished_at": record["finished_at"],
        "status_code": record["status_code"],
        "media_type": record["media_type"],
        "response_bytes": len(record["body"]),
        "response_digest": record["response_digest"],
        "observed_request_id": record["observed_request_id"],
        "instance_id": record["instance_id"],
    })
    print(json.dumps({"status_code": record["status_code"], "assertions": self_assertions}, separators=(",", ":")))
    return 0 if all(item["passed"] for item in self_assertions) and status_ok and media_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
