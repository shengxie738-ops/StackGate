"""SG-055 checks for the test-only backend observation middleware.

Every case drives the real middleware: either through the demo's real FastAPI app over Starlette's
``TestClient`` (real HTTP framing, real ASGI messages) or through a hand-written ASGI call whose sent
messages are captured byte for byte. The synthetic applications exist only to make a stream end in a
specific way - mid-body exception, withheld final chunk, oversized body - and never replace the middleware.

Detection below is deliberately structural: a record counts as an attestation only when a committed JSON
document actually carries the ``BackendObservation`` fields, so "the response was truncated and nothing was
attested" is a fact about the directory rather than about a path convention.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

API_ROOT = Path(__file__).resolve().parents[1]
PRESET_SCRIPTS = API_ROOT.parents[3] / "presets" / "fastapi-react" / "scripts"
sys.path.insert(0, str(PRESET_SCRIPTS))

import stackgate_observation as observation  # noqa: E402

from app.main import create_app  # noqa: E402

RUN = "run_sg055"
OTHER_RUN = "run_sg055_other"
CHECK = "runtime_probe"
OTHER_CHECK = "browser_chain"
ATTEMPT = "attempt_sg055_1"
OTHER_ATTEMPT = "attempt_sg055_2"
REQUEST = "request_sg055_1"
INSTANCE = "instance_sg055_launcher"
REVISION = "revision_sg055_launcher"
FORGED_INSTANCE = "client_supplied_instance"
FORGED_REVISION = "client-supplied-revision"
CANARY = "bearer-canary-never-recorded"
PERFORMANCE_BODY = b'{"data":{"performance":{"total_return":0.1234}}}'
DRIFTED_BODY = b'{"data":{"performance":{"total_return":9.9999}}}'
OPERATIONS = [{"method": "GET", "path": "/api/performance", "operation_key": "api:GET /api/performance"}]

# The exact field set `schemas/0.1/backend-observation.schema.json` requires, and forbids growing.
OBSERVATION_FIELDS = {
    "schema_version", "run_id", "check_id", "attempt_id", "request_id", "instance_id", "operation_key",
    "status_code", "media_type", "started_at", "finished_at", "response_bytes", "response_digest",
    "digest_input_form", "observation_path", "excluded_fields",
}
DIAGNOSTIC_KINDS = {"stackgate-observation-diagnostic", "stackgate-observation-conflict"}
INDEX_KIND = "stackgate-observation-index"


def headers_for(run_id: str = RUN, check_id: str = CHECK, attempt_id: str = ATTEMPT,
                request_id: str = REQUEST, **extra: str) -> dict[str, str]:
    values = {
        "x-stackgate-run-id": run_id, "x-stackgate-check-id": check_id,
        "x-stackgate-attempt-id": attempt_id, "x-stackgate-request-id": request_id,
    }
    values.update(extra)
    return {key: value for key, value in values.items() if value}


def build_middleware(app, directory: Path, **kwargs):
    settings = {"instance_id": INSTANCE, "allowed_run_ids": [RUN, OTHER_RUN], "data_revision": REVISION,
                "operations": OPERATIONS}
    settings.update(kwargs)
    return observation.StackGateObservationMiddleware(app, directory=str(directory), **settings)


def documents(directory: Path) -> list[tuple[str, dict]]:
    """Every JSON document under the record root, as (relative path, parsed content)."""
    found = []
    for path in sorted(directory.rglob("*.json")):
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(parsed, dict):
            found.append((path.relative_to(directory).as_posix(), parsed))
    return found


def attestations(directory: Path) -> list[tuple[str, dict]]:
    """Committed documents that attest a complete response body."""
    return [(name, doc) for name, doc in documents(directory)
            if {"response_digest", "digest_input_form", "observation_path"} <= set(doc)]


def diagnostics(directory: Path) -> list[tuple[str, dict]]:
    return [(name, doc) for name, doc in documents(directory) if doc.get("kind") in DIAGNOSTIC_KINDS]


def raw_bodies(directory: Path) -> list[str]:
    return sorted(path.relative_to(directory).as_posix() for path in directory.rglob("*.bin"))


def tree(directory: Path) -> dict[str, bytes]:
    return {path.relative_to(directory).as_posix(): path.read_bytes()
            for path in sorted(directory.rglob("*")) if path.is_file()}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def scope_for(headers: dict[str, str], path: str = "/api/performance", method: str = "GET") -> dict:
    return {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
        "method": method, "path": path, "raw_path": path.encode("ascii"), "query_string": b"",
        "root_path": "", "scheme": "http", "server": ("127.0.0.1", 8000), "client": ("127.0.0.1", 51234),
        "headers": [(key.encode("latin-1"), value.encode("latin-1")) for key, value in headers.items()],
    }


def synthetic_app(chunks: list[bytes], *, complete: bool = True, error_after: int | None = None,
                  content_length: int | None = None, content_encoding: str | None = None,
                  status: int = 200, extra_messages: bool = False):
    """An ASGI callable that ends the response in exactly the way a case needs."""

    async def app(scope, receive, send):
        headers = [(b"content-type", b"application/json")]
        if content_length is not None:
            headers.append((b"content-length", str(content_length).encode("ascii")))
        if content_encoding is not None:
            headers.append((b"content-encoding", content_encoding.encode("ascii")))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        for index, chunk in enumerate(chunks):
            if error_after is not None and index >= error_after:
                raise RuntimeError("response stream failed mid-body")
            message = {"type": "http.response.body", "body": chunk}
            if index < len(chunks) - 1 or not complete:
                message["more_body"] = True
            await send(message)
        if extra_messages:
            await send({"type": "http.response.pathsend", "path": "/tmp/never"})

    return app


def counting_app(bodies: list[bytes]):
    """Answers each watched request with the next body in order, so two requests really differ."""
    state = {"calls": 0}

    async def app(scope, receive, send):
        payload = bodies[min(state["calls"], len(bodies) - 1)]
        state["calls"] += 1
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": payload})

    return app


def drive(middleware, headers: dict[str, str], *, path: str = "/api/performance",
          disconnect_at: int | None = None, fail_send_at: int | None = None) -> list[dict]:
    """Run one real ASGI call and return the messages the middleware handed to the server."""
    sent: list[dict] = []
    counter = {"calls": 0}
    sends = {"calls": 0}

    async def receive():
        index = counter["calls"]
        counter["calls"] += 1
        if disconnect_at is not None and index >= disconnect_at:
            return {"type": "http.disconnect"}
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        index = sends["calls"]
        sends["calls"] += 1
        if fail_send_at is not None and index >= fail_send_at:
            # What a real server does when the peer is gone while the next chunk is being written.
            raise ConnectionResetError("client went away mid-response")
        sent.append(message)

    async def call():
        await middleware(scope_for(headers, path), receive, send)

    asyncio.run(call())
    return sent


def body_of(sent: list[dict]) -> bytes:
    return b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")


# --- defect 2: a repeated identity must not destroy the first record --------------------------------------

def test_repeated_request_identity_keeps_the_first_record_and_conflicts(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(counting_app([PERFORMANCE_BODY, DRIFTED_BODY]), directory)

    first_sent = drive(middleware, headers_for())
    assert body_of(first_sent) == PERFORMANCE_BODY
    before = tree(directory)
    assert len(attestations(directory)) == 1, "the first request must be attested"
    assert raw_bodies(directory), "the first response's bytes are filed"

    second_sent = drive(middleware, headers_for())
    assert body_of(second_sent) == DRIFTED_BODY, "the client still receives its own response"

    for name, original in before.items():
        assert (directory / name).read_bytes() == original, f"{name} was overwritten by a repeated identity"
    assert len(attestations(directory)) == 1, "a second attestation for one identity is an overwrite"
    conflict = [doc for _, doc in diagnostics(directory) if doc.get("kind") == "stackgate-observation-conflict"]
    assert conflict, "a repeated identity has to be refused with a conflict record"
    assert "IDENTITY" in str(conflict[0]["reason"])
    assert conflict[0]["retained_bytes"] == 0, "the refused bytes are not kept anywhere"
    assert conflict[0]["discarded_bytes"] == len(DRIFTED_BODY)
    # Nothing new appeared beside the first record: no stray body for the refused request.
    assert raw_bodies(directory) == [name for name in before if name.endswith(".bin")]


def test_two_distinct_identities_are_two_independent_records(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(counting_app([PERFORMANCE_BODY, DRIFTED_BODY]), directory)
    drive(middleware, headers_for())
    drive(middleware, headers_for(request_id="request_sg055_2"))
    assert len(attestations(directory)) == 2
    assert len(raw_bodies(directory)) == 2
    assert diagnostics(directory) == []


# --- defect 1: only a response that really completed may be attested -------------------------------------

def test_withheld_final_chunk_leaves_no_attested_body(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(synthetic_app([b'{"a":', b"1}"], complete=False), directory)
    sent = drive(middleware, headers_for())
    assert body_of(sent) == b'{"a":1}', "the middleware must not alter what the client receives"
    assert attestations(directory) == [], "a response that never terminated may not be attested"
    assert raw_bodies(directory) == [], "no bytes of an incomplete response may be filed"
    assert diagnostics(directory), "an incomplete response still has to say why"
    diagnostic = diagnostics(directory)[0][1]
    assert diagnostic["reason"] == "RESPONSE_INCOMPLETE"
    assert diagnostic["more_body_pending"] is True
    assert diagnostic["retained_bytes"] == 0


def test_exception_mid_response_leaves_only_a_diagnostic(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(synthetic_app([PERFORMANCE_BODY, b"tail"], error_after=1), directory)
    with pytest.raises(RuntimeError):
        drive(middleware, headers_for())
    assert attestations(directory) == [], "a body that failed halfway is not a complete observation"
    assert raw_bodies(directory) == []
    diagnostic = diagnostics(directory)[0][1]
    assert diagnostic["reason"] == "RESPONSE_INCOMPLETE"
    assert diagnostic["error_type"] == "RuntimeError"
    assert diagnostic["bytes_observed"] == len(PERFORMANCE_BODY), "only the chunks that really left were seen"
    assert diagnostic["retained_bytes"] == 0


def test_client_disconnect_before_the_body_finishes_is_not_attested(tmp_path: Path) -> None:
    directory = tmp_path / "records"

    async def watching_app(scope, receive, send):
        """A streaming handler that asks the server whether the client is still there, then stops."""
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": PERFORMANCE_BODY, "more_body": True})
        if (await receive())["type"] == "http.disconnect":
            return
        await send({"type": "http.response.body", "body": b"}"})

    middleware = build_middleware(watching_app, directory)
    drive(middleware, headers_for(), disconnect_at=0)
    assert attestations(directory) == []
    assert raw_bodies(directory) == []
    diagnostic = diagnostics(directory)[0][1]
    assert diagnostic["reason"] == observation.RESPONSE_DISCONNECTED
    assert diagnostic["client_disconnected"] is True
    assert diagnostic["more_body_pending"] is True
    assert diagnostic["retained_bytes"] == 0


def test_a_send_that_fails_because_the_client_went_away_is_not_attested(tmp_path: Path) -> None:
    """The other shape of the same event: the server raises while writing the next chunk."""
    directory = tmp_path / "records"

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": PERFORMANCE_BODY, "more_body": True})
        await send({"type": "http.response.body", "body": b"tail"})

    middleware = build_middleware(app, directory)
    with pytest.raises(ConnectionResetError):
        drive(middleware, headers_for(), fail_send_at=2)
    assert attestations(directory) == []
    assert raw_bodies(directory) == []
    diagnostic = diagnostics(directory)[0][1]
    assert diagnostic["reason"] == observation.RESPONSE_INCOMPLETE
    assert diagnostic["error_type"] == "ConnectionResetError"
    assert diagnostic["bytes_observed"] == len(PERFORMANCE_BODY), "the chunk that never reached the wire is not counted"


def test_declared_content_length_that_does_not_match_the_body_is_refused(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(synthetic_app([PERFORMANCE_BODY],
                                                 content_length=len(PERFORMANCE_BODY) + 8), directory)
    drive(middleware, headers_for())
    assert attestations(directory) == []
    assert diagnostics(directory)[0][1]["reason"] == "RESPONSE_LENGTH_MISMATCH"


def test_supported_stream_is_attested_from_the_exact_bytes_the_client_received(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    chunks = [b'{"data":{"performance"', b'":{"total_return"', b":0.1234}}"]
    middleware = build_middleware(synthetic_app(chunks), directory)
    sent = drive(middleware, headers_for())
    attested = attestations(directory)
    assert len(attested) == 1, "a terminated stream is a complete response"
    record = attested[0][1]
    assert record["response_bytes"] == sum(len(chunk) for chunk in chunks)
    assert record["response_digest"] == digest(b"".join(chunks))
    assert record["digest_input_form"] == "UNCOMPRESSED_UTF8_BODY_BYTES"
    assert next(path.read_bytes() for path in directory.rglob("*.bin")) == body_of(sent)


def test_no_response_at_all_records_a_diagnostic(tmp_path: Path) -> None:
    directory = tmp_path / "records"

    async def silent(scope, receive, send):
        raise RuntimeError("application died before answering")

    middleware = build_middleware(silent, directory)
    with pytest.raises(RuntimeError):
        drive(middleware, headers_for())
    assert attestations(directory) == []
    assert diagnostics(directory)[0][1]["reason"] == observation.RESPONSE_NOT_STARTED


def test_an_exception_after_a_terminated_response_is_not_attested(tmp_path: Path) -> None:
    """The bytes arrived in full and the application still raised: nothing here is a clean fact."""
    directory = tmp_path / "records"

    async def raise_after_answering(scope, receive, send):
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": PERFORMANCE_BODY})
        raise ValueError("raised after the response terminated")

    middleware = build_middleware(raise_after_answering, directory)
    with pytest.raises(ValueError):
        drive(middleware, headers_for())
    assert attestations(directory) == []
    assert raw_bodies(directory) == []
    diagnostic = diagnostics(directory)[0][1]
    assert diagnostic["reason"] == observation.APPLICATION_ERROR
    assert diagnostic["error_type"] == "ValueError"
    assert diagnostic["bytes_observed"] == len(PERFORMANCE_BODY)


# --- defect 3: over budget is a refusal that has to be recorded ------------------------------------------

def test_over_budget_response_produces_a_diagnostic_not_a_partial_digest(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    payload = b"x" * 257
    middleware = build_middleware(synthetic_app([payload[:100], payload[100:]]), directory,
                                  max_recorded_bytes=256)
    sent = drive(middleware, headers_for())
    assert body_of(sent) == payload, "refusing to attest does not truncate the client's response"
    assert attestations(directory) == [], "a partial body must never be hashed as a complete observation"
    assert raw_bodies(directory) == []
    diagnostic = diagnostics(directory)[0][1]
    assert diagnostic["reason"] == "RESPONSE_OVER_BUDGET"
    assert diagnostic["retained_bytes"] == 0
    assert diagnostic["discarded_bytes"] == len(payload)
    assert diagnostic["bytes_observed"] == len(payload)
    assert diagnostic["max_recorded_bytes"] == 256


def test_response_message_after_the_terminating_chunk_is_refused(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(synthetic_app([PERFORMANCE_BODY], extra_messages=True), directory)
    drive(middleware, headers_for())
    assert attestations(directory) == []
    assert diagnostics(directory)[0][1]["reason"] == "RESPONSE_MESSAGE_UNSUPPORTED"


def test_unsupported_content_encoding_is_refused_by_name(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(synthetic_app([PERFORMANCE_BODY], content_encoding="gzip"), directory)
    drive(middleware, headers_for())
    assert attestations(directory) == []
    diagnostic = diagnostics(directory)[0][1]
    assert diagnostic["reason"] == "CONTENT_ENCODING_UNSUPPORTED"
    assert diagnostic["content_encoding"] == "gzip"


# --- preserved guarantees ---------------------------------------------------------------------------------

def test_observation_matches_the_schema_field_set_and_the_recorded_bytes(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(create_app(), directory)
    with TestClient(middleware) as client:
        response = client.get("/api/performance", headers=headers_for())
    assert response.status_code == 200
    attested = attestations(directory)
    assert len(attested) == 1
    name, record = attested[0]
    assert set(record) == OBSERVATION_FIELDS, "BackendObservation is additionalProperties:false"
    assert record["response_digest"] == digest(response.content)
    assert record["status_code"] == 200
    assert record["media_type"] == "application/json"
    assert record["operation_key"] == "api:GET /api/performance"
    assert record["instance_id"] == INSTANCE
    assert record["excluded_fields"] == ["Authorization", "Cookie", "Set-Cookie"]
    assert record["started_at"].endswith("Z") and record["finished_at"].endswith("Z")
    assert (directory / record["observation_path"]).read_bytes() == response.content
    assert name.endswith("observation.json")


def test_record_directory_is_bound_to_run_check_attempt_and_request(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(create_app(), directory)
    with TestClient(middleware) as client:
        client.get("/api/performance", headers=headers_for())
        client.get("/api/performance", headers=headers_for(check_id=OTHER_CHECK))
        client.get("/api/performance", headers=headers_for(attempt_id=OTHER_ATTEMPT))
    assert sorted(name for name, _ in attestations(directory)) == sorted(
        f"{RUN}/{check}/{attempt}/{REQUEST}/observation.json"
        for check, attempt in ((CHECK, ATTEMPT), (OTHER_CHECK, ATTEMPT), (CHECK, OTHER_ATTEMPT)))
    # The completion index for one request names exactly the two artifacts it needs.
    index = json.loads((directory / RUN / CHECK / ATTEMPT / REQUEST / "index.json").read_text(encoding="utf-8"))
    assert index["kind"] == INDEX_KIND
    assert index["run_id"] == RUN and index["check_id"] == CHECK and index["attempt_id"] == ATTEMPT
    assert index["request_id"] == REQUEST
    assert index["instance_id"] == INSTANCE and index["data_revision"] == REVISION
    folder = directory / RUN / CHECK / ATTEMPT / REQUEST
    assert index["body_digest"] == digest((folder / "response.bin").read_bytes())
    assert index["observation_digest"] == digest((folder / "observation.json").read_bytes())


def test_completion_index_only_exists_for_a_finished_record(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(synthetic_app([PERFORMANCE_BODY], complete=False), directory)
    drive(middleware, headers_for())
    assert documents(directory), "the refusal itself is recorded"
    assert not any(path.name == "index.json" for path in directory.rglob("*.json")), "no index, no complete record"


def test_unauthorized_run_id_is_served_without_any_record(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(create_app(), directory)
    with TestClient(middleware) as client:
        response = client.get("/api/performance", headers=headers_for(run_id="run_not_registered"))
    assert response.status_code == 200
    assert response.content
    assert list(directory.rglob("*")) == [], "an unauthorized run creates no fact and no diagnostic"
    assert "x-stackgate-instance-id" not in {key.lower() for key in response.headers}


def test_identity_shaped_headers_are_required_and_bad_ones_pass_through(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(create_app(), directory)
    bad = [
        headers_for(request_id="has space"), headers_for(request_id="..%2Fescape"),
        headers_for(attempt_id="no_prefix"), headers_for(check_id="has space"),
        headers_for(request_id="1starts_with_digit"),
    ]
    with TestClient(middleware) as client:
        for headers in bad:
            assert client.get("/api/performance", headers=headers).status_code == 200
        assert client.get("/api/performance", headers=headers_for(run_id="run_ok")).status_code == 200
        assert client.get("/not-watched", headers=headers_for()).status_code == 404
    assert list(directory.rglob("*")) == [], "a guessed identity is never recorded under a name"


def test_client_supplied_instance_headers_are_never_the_recorded_identity(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(create_app(), directory)
    with TestClient(middleware) as client:
        response = client.get("/api/performance", headers=headers_for(**{
            "x-stackgate-instance-id": FORGED_INSTANCE, "x-stackgate-data-revision": FORGED_REVISION}))
    _, record = attestations(directory)[0]
    assert record["instance_id"] == INSTANCE
    assert record["instance_id"] != FORGED_INSTANCE
    advertised = [value for key, value in response.headers.items() if key.lower() == "x-stackgate-instance-id"]
    assert advertised == [INSTANCE], "exactly one server-side identity, never the client's"
    revisions = [value for key, value in response.headers.items() if key.lower() == "x-stackgate-data-revision"]
    assert revisions == [REVISION]


def test_the_application_entry_point_does_not_enable_observation(tmp_path: Path) -> None:
    source = (API_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    assert "stackgate_observation" not in source
    assert "StackGateObservationMiddleware" not in source
    app = create_app()
    assert list(app.user_middleware) == []
    served = sorted(getattr(route, "path", "") for route in app.routes)
    assert "/api/performance" in served and "/health" in served
    assert not [path for path in served if any(word in path.lower() for word in ("observ", "evidence", "record"))]
    directory = tmp_path / "records"
    with TestClient(app) as client:
        assert client.get("/api/performance", headers=headers_for()).status_code == 200
    assert not directory.exists(), "the plain application records nothing at all"


def test_secret_header_values_never_reach_the_record_root(tmp_path: Path) -> None:
    directory = tmp_path / "records"
    middleware = build_middleware(create_app(), directory)
    with TestClient(middleware) as client:
        assert client.get("/api/performance", headers=headers_for(
            authorization=f"Bearer {CANARY}", cookie=f"session={CANARY}")).status_code == 200
        assert client.get("/api/performance", headers=headers_for(request_id="request_sg055_2")).status_code == 200
    files = [path for path in directory.rglob("*") if path.is_file()]
    assert files, "both authorized requests were recorded"
    for path in files:
        assert CANARY not in path.read_bytes().decode("utf-8", "replace"), path
    assert len(attestations(directory)) == 2
    for _, record in attestations(directory):
        assert record["excluded_fields"] == ["Authorization", "Cookie", "Set-Cookie"]


def test_middleware_refuses_an_implicit_or_unbounded_setup(tmp_path: Path) -> None:
    app = create_app()
    for kwargs in (
        {"instance_id": "has space", "allowed_run_ids": [RUN], "data_revision": REVISION},
        {"instance_id": INSTANCE, "allowed_run_ids": None, "data_revision": REVISION},
        {"instance_id": INSTANCE, "allowed_run_ids": [RUN], "data_revision": ""},
        {"instance_id": INSTANCE, "allowed_run_ids": ["not-a-run"], "data_revision": REVISION},
        {"instance_id": INSTANCE, "allowed_run_ids": [RUN], "data_revision": REVISION,
         "max_recorded_bytes": 10 * 1024 * 1024},
        {"instance_id": INSTANCE, "allowed_run_ids": [RUN], "data_revision": REVISION, "operations": []},
    ):
        with pytest.raises(observation.ObservationError):
            observation.StackGateObservationMiddleware(app, directory=str(tmp_path), **kwargs)


# --- launcher ---------------------------------------------------------------------------------------------

def launch_env(tmp_path: Path, **overrides: str) -> dict[str, str]:
    env = {
        "PATH": str(Path(sys.executable).parent), "SYSTEMROOT": "C:\\Windows",
        "TEMP": str(tmp_path), "TMP": str(tmp_path), "PYTHONIOENCODING": "utf-8",
        "STACKGATE_STATE_DIR": str(tmp_path / "state"), "STACKGATE_ALLOWED_RUN_IDS": RUN,
        "STACKGATE_INPUT_HASH": digest(b"stackgate-sg-055-input"),
    }
    env.update(overrides)
    return {key: value for key, value in env.items() if value is not None}


def launch(args: list[str], env: dict[str, str]):
    return subprocess.run([sys.executable, "-B", "-E", "scripts/launch_test_api.py", *args],
                          cwd=str(API_ROOT), capture_output=True, text=True, timeout=60, env=env)


def test_launcher_refuses_to_run_without_its_test_only_inputs(tmp_path: Path) -> None:
    missing = launch([], launch_env(tmp_path, STACKGATE_STATE_DIR=""))
    assert missing.returncode == 64, missing.stderr
    assert "STACKGATE_STATE_DIR" in missing.stderr

    relative = launch([], launch_env(tmp_path, STACKGATE_STATE_DIR="relative/state"))
    assert relative.returncode == 64, relative.stderr

    bad_run = launch([], launch_env(tmp_path, STACKGATE_ALLOWED_RUN_IDS="not-a-run-id"))
    assert bad_run.returncode == 64, bad_run.stderr

    bad_hash = launch([], launch_env(tmp_path, STACKGATE_INPUT_HASH="not-a-hash"))
    assert bad_hash.returncode == 64, bad_hash.stderr

    for name in ("state", "relative"):
        folder = tmp_path / name
        assert not folder.exists() or list(folder.rglob("*")) == []


def test_launcher_binds_loopback_only_and_never_a_public_host(tmp_path: Path) -> None:
    forbidden = launch(["--host", "0.0.0.0"], launch_env(tmp_path))
    assert forbidden.returncode == 64, forbidden.stderr
    assert "127.0.0.1" in forbidden.stderr
