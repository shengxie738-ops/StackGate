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


def _commit(output_dir: str, name: str, document) -> int | None:
    """Write one artifact exclusively. A blocked commit is an evidence error, never a silent overwrite."""
    try:
        helpers.write_json(os.path.join(output_dir, name), document)
    except helpers.ProbeError as error:
        print(f"{error.code}: {error.detail}", file=sys.stderr)
        return 3
    return None


def _worker_document(identity: dict, facts: dict, reason: str | None, completed: bool) -> dict:
    """What happened to the private one-request worker, kept apart from the request facts themselves."""
    return {
        "schema_version": "0.1",
        "kind": "stackgate-probe-worker",
        "run_id": identity["run_id"],
        "check_id": identity["check_id"],
        "attempt_id": identity["attempt_id"],
        "request_id": identity["request_id"],
        "reason": reason,
        "request_completed": completed,
        "worker_pid": facts.get("worker_pid"),
        "spawned": bool(facts.get("spawned", False)),
        "worker_executable": facts.get("worker_executable"),
        "worker_reader_pid": facts.get("worker_reader_pid"),
        # What the reader could still be influenced by, and what it gave up before sending anything. Names and
        # booleans only - never a value - so the artifact can be published with the rest of the evidence.
        "worker_prefix": facts.get("worker_prefix"),
        "worker_base_prefix": facts.get("worker_base_prefix"),
        "worker_environment_names": facts.get("worker_environment_names"),
        "worker_environment_interpretable": facts.get("worker_environment_interpretable"),
        # Absent, not empty, when the worker was terminated before it could answer: the record is the reader's
        # own and this process cannot reconstruct it from the outside.
        "worker_neutralized": facts.get("worker_neutralized"),
        "launch_proofs": facts.get("launch_proofs"),
        "killed": bool(facts.get("killed", False)),
        "reclaimed": bool(facts.get("reclaimed", False)),
        "handle_reaped": bool(facts.get("handle_reaped", False)),
        "pipes_closed": bool(facts.get("pipes_closed", False)),
        "reap_mechanism": facts.get("reap_mechanism"),
        "worker_exit_code": facts.get("worker_exit_code"),
        "deadline_ms": facts.get("deadline_ms"),
        "elapsed_ms": facts.get("elapsed_ms"),
        "reap_ms": facts.get("reap_ms"),
        "worker_stderr": facts.get("worker_stderr", ""),
    }


def main() -> int:
    output_dir = os.environ.get("STACKGATE_OUTPUT_DIR", "")
    declaration_path = os.environ.get("STACKGATE_PROBE_DECLARATION", "")
    origin = os.environ.get("STACKGATE_API_ORIGIN", "")
    allowed = [item for item in os.environ.get("STACKGATE_ALLOWED_ORIGINS", "").split(",") if item]
    # A confirmed run binds each declared service to one origin. Without it the origin only has to be on
    # the allowlist, which is how the sample keeps working; the binding is what stops a request for one
    # service being sent to a different service that shares the allowlist.
    service_origins_raw = os.environ.get("STACKGATE_SERVICE_ORIGINS", "")
    service_origins = None
    if service_origins_raw:
        try:
            service_origins = json.loads(service_origins_raw)
        except json.JSONDecodeError:
            print("STACKGATE_SERVICE_ORIGINS must be a JSON object of service to origin", file=sys.stderr)
            return 64
        if not isinstance(service_origins, dict):
            print("STACKGATE_SERVICE_ORIGINS must be a JSON object of service to origin", file=sys.stderr)
            return 64
    identity = {
        "run_id": os.environ.get("STACKGATE_RUN_ID", ""),
        "check_id": os.environ.get("STACKGATE_CHECK_ID", ""),
        "attempt_id": os.environ.get("STACKGATE_ATTEMPT_ID", ""),
        "request_id": os.environ.get("STACKGATE_REQUEST_ID", "request_performance_1"),
    }
    if not output_dir or not os.path.isabs(output_dir):
        # A relative or missing output directory is a launch-configuration error: nothing ran, so this is the
        # reserved 64, not the 2 a refused request reports. Both exit codes stay distinguishable from the
        # assertion outcomes in section 5.
        print("absolute STACKGATE_OUTPUT_DIR is required", file=sys.stderr)
        return 64
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
            # Passed through uncoerced on purpose: a fraction, NaN, Infinity or a numeric string must be
            # rejected as an invalid budget, not quietly turned into a workable integer.
            deadline_ms=declaration.get("deadline_ms", helpers.DEFAULT_DEADLINE_MS),
            max_response_bytes=declaration.get("max_response_bytes", helpers.MAX_RESPONSE_BYTES),
            service_origins=service_origins,
        )
    except helpers.ProbeError as error:
        # A request-level failure produces diagnostics and nothing else: no report, no raw facts document and
        # no response file a later reader could mistake for a completed attempt. An existing artifact from a
        # previous attempt keeps its bytes; the blocked commit is an evidence error.
        blocked = _commit(output_dir, "probe-error.json",
                          {"schema_version": "0.1", "reason": error.code, "detail": error.detail, **identity})
        if blocked:
            return blocked
        blocked = _commit(output_dir, "probe-worker.json", _worker_document(identity, error.facts, error.code, False))
        if blocked:
            return blocked
        print(f"{error.code}: {error.detail}", file=sys.stderr)
        return 2

    worker_facts = dict(record.get("worker") or {})
    worker_facts.setdefault("deadline_ms", record.get("deadline_ms"))
    body_path = os.path.join(output_dir, "responses", f"{record['request_id']}.json")
    try:
        helpers.write_bytes(body_path, record["body"])
    except helpers.ProbeError as error:
        print(f"{error.code}: {error.detail}", file=sys.stderr)
        return 3

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
    blocked = _commit(output_dir, "probe-raw.json", {
        "schema_version": "0.1",
        "run_id": identity["run_id"],
        "check_id": identity["check_id"],
        "attempt_id": identity["attempt_id"],
        "request_id": record["request_id"],
        "operation_key": record["operation_key"],
        "origin": origin,
        "request_target": record["request_target"],
        "started_at": record["started_at"],
        "finished_at": record["finished_at"],
        "status_code": record["status_code"],
        "media_type": record["media_type"],
        "response_bytes": len(record["body"]),
        "response_digest": record["response_digest"],
        "observed_request_id": record["observed_request_id"],
        "instance_id": record["instance_id"],
    })
    if blocked:
        return blocked
    blocked = _commit(output_dir, "probe-worker.json", _worker_document(identity, worker_facts, None, True))
    if blocked:
        return blocked
    # The completed success report commits last. Until every other artifact is on disk there is nothing here a
    # later reader could mistake for a finished attempt, and a blocked commit leaves the previous attempt's
    # report untouched rather than a half-written one.
    blocked = _commit(output_dir, "probe.json", report)
    if blocked:
        return blocked
    print(json.dumps({"status_code": record["status_code"], "assertions": self_assertions}, separators=(",", ":")))
    return 0 if all(item["passed"] for item in self_assertions) and status_ok and media_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
