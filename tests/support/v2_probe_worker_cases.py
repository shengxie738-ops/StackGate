"""Test support: drive the private worker's frame and isolation boundaries for real.

Prints one JSON object of named observations. Every case calls the production functions in
`presets/fastapi-react/scripts/probe_helpers.py`, or spawns the production `probe_worker.py` against a real
loopback listener that this process opens. Nothing here reimplements a boundary: it measures the one the
product uses, from outside, so a divergence is a product defect and not an artifact of this harness.

The cases stand in four groups:
  caps        - what a frame may claim before it is refused instead of trusted
  degenerate  - empty, truncated, trailing and lying frames
  bounded     - how much a single read may ask for and for how long
  isolation   - what the worker is allowed to inherit, including a sabotaged import path
  no-spawn    - failures that must happen before any process is created
"""

from __future__ import annotations

import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "presets" / "fastapi-react" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import probe_helpers as helpers  # noqa: E402
import probe_worker  # noqa: E402


def outcome(call):
    """Run `call`, and report the classification it produced instead of raising."""
    try:
        value = call()
    except helpers.ProbeError as error:
        facts = error.facts or {}
        return {"raised": True, "code": error.code, "detail": error.detail,
                "spawned": facts.get("spawned"), "worker_pid": facts.get("worker_pid"),
                "launch_proofs": facts.get("launch_proofs")}
    except Exception as error:  # noqa: BLE001 - an unexpected type is itself the observation
        return {"raised": True, "code": type(error).__name__, "detail": str(error)}
    return {"raised": False, "value": repr(value)[:120]}


def one_frame(metadata: dict, body: bytes = b"") -> bytes:
    return helpers.frame(metadata, body)


class Scripted:
    """A read source that records every size it was asked for, so the per-read bound is observable."""

    def __init__(self, chunk: bytes, repeats: int):
        self.chunk = chunk
        self.repeats = repeats
        self.asked = []

    def read(self, size=-1):
        self.asked.append(size)
        if self.repeats <= 0:
            return b""
        self.repeats -= 1
        return self.chunk[:size] if size and size > 0 else self.chunk


class Slow:
    """A source that keeps trickling past a deadline, so the budget is what ends the read loop."""

    def __init__(self, seconds: float, chunk: bytes = b"x"):
        self.seconds = seconds
        self.chunk = chunk

    def read(self, size=-1):
        time.sleep(self.seconds)
        return self.chunk[:size] if size and size > 0 else self.chunk


def cap_cases() -> dict:
    big = b"y" * (128 * 1024)
    metadata = {"ok": True, "note": "n" * (70 * 1024)}
    payload = json.dumps({"ok": True, "v": 1}, sort_keys=True, separators=(",", ":")).encode("utf-8")
    inside = struct.pack(">I", len(payload)) + payload + struct.pack(">I", 0)
    return {
        "frame_refuses_body_over_granted_cap": outcome(lambda: helpers.frame({"ok": True}, big, max_body=4096)),
        "frame_refuses_metadata_over_cap": outcome(lambda: helpers.frame(metadata)),
        "frame_allows_body_at_exactly_the_cap": outcome(
            lambda: len(helpers.frame({"ok": True}, b"z" * 4096, max_body=4096))
            == 2 * helpers.FRAME_HEADER_BYTES + len(json.dumps({"ok": True}, sort_keys=True,
                                                               separators=(",", ":")).encode("utf-8")) + 4096),
        "unframe_refuses_body_over_granted_cap": outcome(lambda: helpers.unframe(
            helpers.frame({"ok": True}, b"q" * (1024 * 1024)), max_body=4096)),
        "round_trip_preserves_bytes_exactly": outcome(
            lambda: hashlib.sha256(helpers.unframe(one_frame({"ok": True}, big), max_body=helpers.MAX_RESPONSE_BYTES)[1])
            .hexdigest() == hashlib.sha256(big).hexdigest()),
        "request_frame_grammar": outcome(lambda: helpers.unframe(inside, max_body=0, label="parent")[0]),
    }


def degenerate_cases() -> dict:
    whole = helpers.frame({"ok": True, "status_code": 200}, b"{}")
    lying = struct.pack(">I", 2 ** 31 - 1) + b"{}"
    not_object = struct.pack(">I", 4) + b"null" + struct.pack(">I", 0)
    return {
        "empty_answer": outcome(lambda: helpers.unframe(b"")),
        "shorter_than_a_header": outcome(lambda: helpers.unframe(whole[:2])),
        "truncated_body": outcome(lambda: helpers.unframe(whole[: len(whole) - 2])),
        "truncated_metadata": outcome(lambda: helpers.unframe(whole[: helpers.FRAME_HEADER_BYTES + 3])),
        "trailing_bytes_after_frame": outcome(lambda: helpers.unframe(whole + b"x")),
        "metadata_that_is_not_an_object": outcome(lambda: helpers.unframe(not_object)),
        "metadata_length_beyond_cap": outcome(lambda: helpers.unframe(lying)),
        "worker_rejects_a_shapeless_request": outcome(lambda: probe_worker._checked({"url": "x" * 4096})),
    }


def bounded_read_cases() -> dict:
    budget = 100
    scripted = Scripted(b"x" * 10, 1000)
    result = outcome(lambda: helpers._read_bounded(scripted, budget))
    over_budget_asked = [size for size in scripted.asked if size > budget + 1]
    slow = outcome(lambda: helpers._read_bounded(Slow(0.05), 10 * 1024 * 1024, time.monotonic() + 0.12))
    return {
        "per_read_never_exceeds_remaining_budget_plus_one": not over_budget_asked,
        "per_read_sizes_shrink_with_the_budget": scripted.asked[:4],
        "over_budget_is_classified_after_the_first_byte_past": result,
        "steady_trickle_hits_the_absolute_deadline": slow,
    }


def _listener(body: bytes, state: dict):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    head = ("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: %d\r\n\r\n"
            % len(body)).encode("ascii")

    def serve():
        connection, _ = server.accept()
        with connection:
            state["request"] = connection.recv(4096).decode("latin1")
            connection.sendall(head + body)
        state["connections"] += 1

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    return server


def isolation_cases() -> dict:
    """The worker must be unaffected by whatever environment the caller happens to have."""
    body = b'{"data":{"performance":{"total_return":0.1234}}}\n'
    state = {"request": "", "connections": 0}
    server = _listener(body, state)
    port = server.getsockname()[1]
    origin = "http://127.0.0.1:%d" % port
    decoy = Path(os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp") / "v2-r03-decoy"
    decoy.mkdir(parents=True, exist_ok=True)
    (decoy / "probe_helpers.py").write_text('MARKER = "the worker imported the decoy"\n', encoding="utf-8")
    frame = helpers.frame({"url": origin + "/api/performance", "origin": origin, "path": "/api/performance",
                           "method": "GET", "headers": [["Accept", "application/json"]],
                           "max_response_bytes": 4096, "budget_ms": 4000}, max_body=helpers.MAX_REQUEST_FRAME_BYTES)
    started = time.monotonic()
    process = subprocess_run_worker(frame, decoy)
    server.close()
    answer = {"returncode": process.returncode, "elapsed_ms": int((time.monotonic() - started) * 1000),
              "served_connections": state["connections"], "request_line": state["request"].split("\r\n")[0]}
    try:
        metadata, received = helpers.unframe(process.stdout, max_body=4096, label="worker")
    except helpers.ProbeError as error:
        return {"worker_answer": {"raised": True, "code": error.code, "detail": error.detail}, "answer": answer,
                "stderr": process.stderr.decode("utf-8", "replace")[:400]}
    answer["digest_matches_the_bytes_that_were_sent"] = (
        hashlib.sha256(received).hexdigest() == metadata["response_digest"].split(":", 1)[1])
    answer["body_is_the_original_bytes"] = received == body
    neutralized = metadata.get("neutralized") or {}
    return {
        "answer": answer,
        "metadata": {key: metadata.get(key) for key in ("ok", "status_code", "media_type", "request_target",
                                                         "reader_pid", "prefix", "base_prefix")},
        "environment_names": metadata.get("environment_names"),
        "environment_interpretable": metadata.get("environment_interpretable"),
        "neutralized": {"keys": sorted(neutralized), "groups_release": neutralized.get("groups_release"),
                        "umask_set": neutralized.get("umask_set"),
                        "removed_count": len(neutralized.get("removed_environment_variables") or [])},
        "worker_environment_carries_no_interpretable_name": not metadata.get("environment_interpretable"),
        "worker_prefix_is_its_own_interpreter": metadata.get("prefix") == metadata.get("base_prefix"),
        "worker_imported_the_production_helper": metadata.get("request_target") == origin + "/api/performance",
    }


def subprocess_run_worker(frame: bytes, decoy: Path):
    """Spawn the production worker the way the parent does, but with a hostile environment around it."""
    import subprocess
    hostile = dict(os.environ)
    hostile.update({"PYTHONPATH": str(decoy), "PYTHONHOME": str(decoy), "VIRTUAL_ENV": str(decoy),
                    "V_ENV_PATH": str(decoy), "http_proxy": "http://canary:fabricated@127.0.0.1:9",
                    "HTTPS_PROXY": "http://canary:fabricated@127.0.0.1:9", "no_proxy": "127.0.0.1",
                    "AWS_SECRET_ACCESS_KEY": "fabricated", "GH_TOKEN": "fabricated"})
    executable = helpers._worker_executable()
    process = subprocess.Popen([executable, "-B", "-E", str(SCRIPTS / helpers.WORKER_SCRIPT)],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               cwd=str(SCRIPTS), env=hostile, close_fds=True)
    stdout, stderr = process.communicate(input=frame, timeout=30)
    process.stdout = stdout
    process.stderr = stderr
    return process


def escape_cases() -> dict:
    """The worker can only decline a work order it cannot account for; it has no policy of its own to widen."""
    def payload(**overrides):
        base = {"url": "http://127.0.0.1:9/api/performance", "origin": "http://127.0.0.1:9",
                "path": "/api/performance", "method": "GET", "headers": [["Accept", "application/json"]],
                "max_response_bytes": 4096, "budget_ms": 4000}
        base.update(overrides)
        return base
    return {
        "external_ip_origin": outcome(lambda: probe_worker._checked(payload(origin="http://8.8.8.8"))),
        "named_canary_origin": outcome(lambda: probe_worker._checked(
            payload(origin="http://e8a5dc6.invalid", url="http://e8a5dc6.invalid/api/performance"))),
        "url_escapes_the_authorized_origin": outcome(lambda: probe_worker._checked(
            payload(url="http://8.8.8.8/api/performance"))),
        "declared_path_with_a_fragment": outcome(lambda: probe_worker._checked(
            payload(path="/api/performance#printed", url="http://127.0.0.1:9/api/performance#printed"))),
        "budget_beyond_the_maximum": outcome(lambda: probe_worker._checked(payload(budget_ms=99999))),
        "response_cap_beyond_the_maximum": outcome(lambda: probe_worker._checked(payload(max_response_bytes=9999999))),
        "exactly_the_authorized_request": outcome(lambda: sorted(probe_worker._checked(payload()).keys())),
    }


def no_spawn_cases() -> dict:
    """Cases that must be refused before a private process exists, and say so in their own record."""
    identity = {"run_id": "run_v2_r03", "check_id": "runtime_probe", "attempt_id": "attempt_v2_r03_1",
                "request_id": "request_v2_r03_1"}
    out_of_range = outcome(lambda: helpers.perform_request(
        origin="http://127.0.0.1:9", operation_key="api:GET /api/performance",
        allowed_origins=["http://127.0.0.1:9"], identity=identity, deadline_ms=99999))
    missing_script = getattr(helpers, "WORKER_SCRIPT")
    try:
        helpers.WORKER_SCRIPT = "probe_worker_that_does_not_exist.py"
        unprovable = outcome(lambda: helpers.perform_request(
            origin="http://127.0.0.1:9", operation_key="api:GET /api/performance",
            allowed_origins=["http://127.0.0.1:9"], identity=identity, deadline_ms=5000))
    finally:
        helpers.WORKER_SCRIPT = missing_script
    return {"deadline_out_of_range": out_of_range, "unprovable_launch": unprovable,
            "nothing_spawned_for_either": [out_of_range.get("spawned"), unprovable.get("spawned")]}


def main() -> int:
    groups = {"caps": cap_cases(), "degenerate": degenerate_cases(), "bounded": bounded_read_cases(),
              "escape": escape_cases(), "isolation": isolation_cases(), "no_spawn": no_spawn_cases()}
    print(json.dumps(groups, separators=(",", ":"), sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
