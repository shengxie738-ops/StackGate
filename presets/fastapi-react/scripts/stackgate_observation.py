"""Test-only ASGI observation middleware for the FastAPI/React preset.

It records independent facts about requests that actually reached this process. It is not a signature and not
a security boundary: it only proves what this instance observed while running the declared inputs. Disabled
unless an explicit test launcher constructs it.

What counts as a fact here (SG-055):

* A response is attested only when its ASGI stream really terminated - the middleware tracks ``more_body``
  on every ``http.response.body`` message and completes only after the terminating chunk reached the server.
  A mid-body exception, a client disconnect, a withheld final chunk, a declared ``content-length`` the body
  never reached, or any message shape this middleware does not understand leaves a diagnostic and nothing else.
* Recorded bytes are exactly the bytes handed to the server, so ``response_digest`` recomputes over what the
  client received. Compressed bodies are refused by name, because decompressing and hashing the result would
  report bytes that never existed on the wire.
* One identity - ``run``/``check``/``attempt``/``request`` - owns one record directory and is committed
  exclusively. A repeated identity is refused with a conflict record; it never replaces the first record, and
  the refused bytes are not retained anywhere.
* ``instance_id`` and ``data_revision`` are produced by the process that installed this middleware. A client
  header of the same name is never read as identity, and any identity header the application itself put on
  the response is replaced rather than duplicated.

The commit primitive is the repository's own exclusive commit (`_commit` behind
`probe_helpers.write_bytes`/`write_json`), so the observation tree and the probe tree refuse an overwrite the
same way; no second implementation of that rule lives here.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import probe_helpers as helpers  # noqa: E402

SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,127}$")
ATTEMPT_ID = re.compile(r"^attempt_[A-Za-z0-9_-]+$")
RUN_ID = re.compile(r"^run_[A-Za-z0-9_-]+$")
OPERATION_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*:(GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE) "
                           r"/[^\s\u0000-\u001f\u007f]*$")
EXCLUDED_FIELDS = ("authorization", "cookie", "set-cookie")
# The document field names are the ones the shared `backend-observation` schema enumerates; the tuple above is
# only ever used for case-insensitive header matching, so the two stay spelled separately.
EXCLUDED_RECORD_FIELDS = ["Authorization", "Cookie", "Set-Cookie"]
MAX_RECORDED_BYTES = 1024 * 1024
# The templates that ship this preset never compress a response, so anything else is refused by name instead
# of being decoded and then reported as if those were the bytes that arrived.
SUPPORTED_CONTENT_ENCODINGS = ("", "identity")
REQUEST_IDENTITY_HEADERS = ("x-stackgate-run-id", "x-stackgate-check-id", "x-stackgate-attempt-id",
                            "x-stackgate-request-id")
SERVER_IDENTITY_HEADERS = ("x-stackgate-instance-id", "x-stackgate-data-revision")

BODY_FILE = "response.bin"
OBSERVATION_FILE = "observation.json"
INDEX_FILE = "index.json"
DIAGNOSTIC_FILE = "diagnostic.json"
CONFLICT_FILE = "conflict.json"
KIND_DIAGNOSTIC = "stackgate-observation-diagnostic"
KIND_CONFLICT = "stackgate-observation-conflict"
KIND_INDEX = "stackgate-observation-index"

# Every refusal this middleware can report about a stream, and what each one means. They are reported, never
# repaired: none of them produces an attestation.
RESPONSE_NOT_STARTED = "RESPONSE_NOT_STARTED"
RESPONSE_INCOMPLETE = "RESPONSE_INCOMPLETE"
RESPONSE_DISCONNECTED = "RESPONSE_DISCONNECTED"
RESPONSE_OVER_BUDGET = "RESPONSE_OVER_BUDGET"
RESPONSE_LENGTH_MISMATCH = "RESPONSE_LENGTH_MISMATCH"
RESPONSE_MESSAGE_UNSUPPORTED = "RESPONSE_MESSAGE_UNSUPPORTED"
CONTENT_ENCODING_UNSUPPORTED = "CONTENT_ENCODING_UNSUPPORTED"
APPLICATION_ERROR = "APPLICATION_ERROR"
IDENTITY_CONFLICT = "IDENTITY_CONFLICT"


class ObservationError(Exception):
    pass


def _utc(value: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(value)) + ".%03dZ" % int(value * 1000 % 1000)


def _relative(*parts: str) -> str:
    return "/".join(parts)


def record_directory(root: str, identity: dict) -> str:
    """The one directory a single run/check/attempt/request identity owns."""
    return os.path.join(root, identity["run_id"], identity["check_id"], identity["attempt_id"],
                        identity["request_id"])


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


#: The sample registers exactly one watched business operation. A launcher may replace this list.
OBSERVED_OPERATIONS: list[dict] = [
    {"method": "GET", "path": "/api/performance", "operation_key": "api:GET /api/performance"},
]


class StackGateObservationMiddleware:
    def __init__(self, app, *, directory: str, instance_id: str, allowed_run_ids, data_revision: str,
                 operations: list[dict] | None = None, max_recorded_bytes: int = MAX_RECORDED_BYTES) -> None:
        if not SAFE_ID.match(instance_id):
            raise ObservationError("instance_id must be a safe identifier")
        if not isinstance(allowed_run_ids, (list, tuple, set)) or not all(RUN_ID.match(str(item)) for item in allowed_run_ids):
            raise ObservationError("allowed_run_ids must be explicit run identifiers")
        if not data_revision:
            raise ObservationError("data_revision is required for an observation record")
        if max_recorded_bytes < 1 or max_recorded_bytes > MAX_RECORDED_BYTES:
            raise ObservationError("observation response budget is out of range")
        watched = OBSERVED_OPERATIONS if operations is None else operations
        if not isinstance(watched, (list, tuple)) or not watched:
            raise ObservationError("operations must be an explicit non-empty list of watched operations")
        for entry in watched:
            if not isinstance(entry, dict):
                raise ObservationError("each watched operation must be an object")
            if not isinstance(entry.get("method"), str) or entry["method"] not in helpers.METHODS:
                raise ObservationError("each watched operation needs a supported method")
            path = entry.get("path")
            if not isinstance(path, str) or helpers.path_rule_violation(path) is not None:
                raise ObservationError("each watched operation needs an exact literal path")
            if not isinstance(entry.get("operation_key"), str) or not OPERATION_KEY.match(entry["operation_key"]):
                raise ObservationError("each watched operation needs a valid operation key")
        if not isinstance(directory, str) or not directory:
            raise ObservationError("directory must be the record root this process was given")
        self.app = app
        self.directory = directory
        self.instance_id = instance_id
        self.allowed_run_ids = {str(item) for item in allowed_run_ids}
        self.data_revision = data_revision
        self.operations = list(watched)
        self.max_recorded_bytes = max_recorded_bytes
        os.makedirs(directory, exist_ok=True)

    def _headers(self, scope) -> dict:
        return {key.decode("latin-1").lower(): value.decode("latin-1").strip()
                for key, value in scope.get("headers", []) or []}

    def _watched(self, scope):
        method = scope.get("method", "")
        path = scope.get("path", "")
        for entry in self.operations:
            if entry["method"] == method and entry["path"] == path:
                return entry
        return None

    async def __call__(self, scope, receive, send) -> None:  # noqa: D102
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = self._headers(scope)
        entry = self._watched(scope)
        # The identity is read from the request headers because the caller has to name which request this is;
        # `instance_id` and `data_revision` are never read from here at all.
        identity = {
            "run_id": headers.get("x-stackgate-run-id", ""),
            "check_id": headers.get("x-stackgate-check-id", ""),
            "attempt_id": headers.get("x-stackgate-attempt-id", ""),
            "request_id": headers.get("x-stackgate-request-id", ""),
        }
        if entry is None or identity["run_id"] not in self.allowed_run_ids:
            await self.app(scope, receive, send)
            return
        if not (SAFE_ID.match(identity["check_id"]) and ATTEMPT_ID.match(identity["attempt_id"])
                and SAFE_ID.match(identity["request_id"]) and SAFE_ID.match(identity["run_id"])):
            # A request whose identity cannot be named is served and left unobserved; guessing a directory
            # name for it would put facts about one request under another request's identity.
            await self.app(scope, receive, send)
            return

        state = {
            "status": None, "media": "", "encoding": "", "content_length": None,
            "body": bytearray(), "bytes_observed": 0, "chunks": 0, "overflow": False,
            "complete": False, "more_body_pending": False, "disconnected": False,
            "unsupported_message": None, "error_type": None, "completed_at": None, "last_at": None,
        }

        async def receive_wrapper():
            message = await receive()
            if message.get("type") == "http.disconnect":
                # The only way to see a client that went away mid-response: the stream never terminated,
                # so nothing about the body can be attested.
                state["disconnected"] = True
            return message

        async def send_wrapper(message) -> None:
            kind = message.get("type")
            if kind == "http.response.start":
                state["status"] = int(message["status"])
                kept = []
                for key, value in message.get("headers", []) or []:
                    name = key.decode("latin-1").lower()
                    if name == "content-type":
                        state["media"] = value.decode("latin-1").split(";")[0].strip()
                    elif name == "content-encoding":
                        state["encoding"] = value.decode("latin-1").strip().lower()
                    elif name == "content-length":
                        state["content_length"] = _parse_length(value.decode("latin-1").strip())
                    if name not in SERVER_IDENTITY_HEADERS:
                        kept.append((key, value))
                # Identity is produced here and replaces anything the application claimed, so a route that
                # echoes a client-supplied instance cannot advertise a second value beside the real one.
                outgoing = dict(message)
                outgoing["headers"] = kept + [
                    (b"x-stackgate-instance-id", self.instance_id.encode("latin-1")),
                    (b"x-stackgate-data-revision", self.data_revision.encode("latin-1")),
                ]
                await send(outgoing)
                return
            if kind == "http.response.body":
                if state["complete"]:
                    state["unsupported_message"] = "body message after the response terminated"
                chunk = message.get("body", b"") or b""
                pending = bool(message.get("more_body", False))
                await send(message)
                # Only bytes the server accepted are observed: a chunk whose send raised never reached the
                # wire, and counting it would describe a body the client did not receive.
                state["chunks"] += 1
                state["bytes_observed"] += len(chunk)
                if not state["overflow"] and len(state["body"]) + len(chunk) <= self.max_recorded_bytes:
                    state["body"] += chunk
                else:
                    # Past the budget there is nothing to attest, and a partial body kept on disk could be
                    # mistaken for one. Count it, discard it, say so.
                    state["overflow"] = True
                    state["body"] = bytearray()
                state["more_body_pending"] = pending
                state["last_at"] = time.time()
                if not pending and not state["complete"]:
                    state["complete"] = True
                    state["completed_at"] = time.time()
                return
            state["unsupported_message"] = str(kind)
            await send(message)

        started = time.time()
        try:
            await self.app(scope, receive_wrapper, send_wrapper)
        except BaseException as error:
            state["error_type"] = type(error).__name__
            raise
        finally:
            try:
                self._finalize(identity, entry, state, started)
            except Exception as error:
                # Recording is evidence, not a second gate on the response: a broken record is reported on
                # stderr and never replaces the answer the client already got.
                self._note("observation record failed: %s" % error)

    def _refusal(self, state: dict):
        """The reason this response cannot be attested, or None when it can."""
        if state["status"] is None:
            return RESPONSE_NOT_STARTED
        if state["unsupported_message"] is not None:
            return RESPONSE_MESSAGE_UNSUPPORTED
        if state["overflow"]:
            return RESPONSE_OVER_BUDGET
        if state["encoding"] not in SUPPORTED_CONTENT_ENCODINGS:
            return CONTENT_ENCODING_UNSUPPORTED
        if not state["complete"]:
            return RESPONSE_DISCONNECTED if state["disconnected"] else RESPONSE_INCOMPLETE
        if state["error_type"] is not None:
            # The bytes did arrive, but the application raised anyway: the request is not a clean fact.
            return APPLICATION_ERROR
        if state["content_length"] is not None and state["content_length"] != state["bytes_observed"]:
            return RESPONSE_LENGTH_MISMATCH
        return None

    def _stream_facts(self, identity: dict, entry: dict, state: dict, started: float) -> dict:
        finished = state["completed_at"] or state["last_at"] or time.time()
        return {
            "schema_version": "0.1",
            "run_id": identity["run_id"],
            "check_id": identity["check_id"],
            "attempt_id": identity["attempt_id"],
            "request_id": identity["request_id"],
            "instance_id": self.instance_id,
            "data_revision": self.data_revision,
            "operation_key": entry["operation_key"],
            "status_code": state["status"],
            "media_type": state["media"],
            "content_encoding": state["encoding"],
            "started_at": _utc(started),
            "finished_at": _utc(finished),
            "bytes_observed": state["bytes_observed"],
            "chunks_seen": state["chunks"],
            "more_body_pending": bool(state["more_body_pending"]),
            "client_disconnected": bool(state["disconnected"]),
            "content_length_declared": state["content_length"],
            "error_type": state["error_type"],
            "max_recorded_bytes": self.max_recorded_bytes,
            "excluded_fields": list(EXCLUDED_RECORD_FIELDS),
        }

    def _note(self, detail: str) -> None:
        """Bookkeeping never changes the HTTP outcome; it does have to be visible when it fails."""
        sys.stderr.write("stackgate-observation: %s\n" % detail)

    def _commit(self, path: str, data: bytes):
        """One exclusive commit through the repository's own primitive; a refusal comes back as a fact."""
        try:
            helpers.write_bytes(path, data)
        except helpers.ProbeError as error:
            return error
        return None

    def _finalize(self, identity: dict, entry: dict, state: dict, started: float) -> None:
        reason = self._refusal(state)
        folder = record_directory(self.directory, identity)
        if reason is not None:
            diagnostic = self._stream_facts(identity, entry, state, started)
            diagnostic.update({"kind": KIND_DIAGNOSTIC, "reason": reason,
                               "response_started": state["status"] is not None,
                               "retained_bytes": 0, "discarded_bytes": state["bytes_observed"],
                               "body_retained": False, "recorded_at": _utc(time.time())})
            error = self._commit(os.path.join(folder, DIAGNOSTIC_FILE), _bytes(diagnostic))
            if error is not None and error.code == "ARTIFACT_EXISTS":
                self._note("diagnostic for %s already recorded; nothing was replaced" % identity["request_id"])
            elif error is not None:
                self._note("diagnostic for %s could not be committed: %s" % (identity["request_id"], error))
            return
        self._attest(identity, entry, state, started, folder)

    def _attest(self, identity: dict, entry: dict, state: dict, started: float, folder: str) -> None:
        body = bytes(state["body"])
        relative = _relative(identity["run_id"], identity["check_id"], identity["attempt_id"],
                             identity["request_id"])
        record = {
            "schema_version": "0.1",
            "run_id": identity["run_id"],
            "check_id": identity["check_id"],
            "attempt_id": identity["attempt_id"],
            "request_id": identity["request_id"],
            "instance_id": self.instance_id,
            "operation_key": entry["operation_key"],
            "status_code": int(state["status"]),
            "media_type": state["media"],
            "started_at": _utc(started),
            "finished_at": _utc(state["completed_at"] or time.time()),
            "response_bytes": len(body),
            "response_digest": _digest(body),
            "digest_input_form": "UNCOMPRESSED_UTF8_BODY_BYTES",
            "observation_path": _relative(relative, BODY_FILE),
            "excluded_fields": list(EXCLUDED_RECORD_FIELDS),
        }
        encoded = _bytes(record)
        # Body first, then the observation, then the completion index: a directory only becomes a finished
        # record when everything it needs is on disk, and none of these commits may replace a previous one.
        for path, data in ((os.path.join(folder, BODY_FILE), body),
                          (os.path.join(folder, OBSERVATION_FILE), encoded)):
            error = self._commit(path, data)
            if error is not None:
                self._refuse_commit(identity, entry, state, started, folder, error, path)
                return
        index = self._stream_facts(identity, entry, state, started)
        index.update({
            "kind": KIND_INDEX,
            "observation_path": _relative(relative, OBSERVATION_FILE),
            "body_path": _relative(relative, BODY_FILE),
            "observation_digest": _digest(encoded),
            "body_digest": _digest(body),
            "body_bytes": len(body),
            "retained_bytes": len(body),
            "discarded_bytes": 0,
            "body_retained": True,
            "committed_at": _utc(time.time()),
        })
        error = self._commit(os.path.join(folder, INDEX_FILE), _bytes(index))
        if error is not None:
            self._note("completion index for %s could not be committed: %s" % (identity["request_id"], error))

    def _refuse_commit(self, identity: dict, entry: dict, state: dict, started: float, folder: str,
                       error, path: str) -> None:
        """An identity that is already recorded stays as it was; the repeat is refused, never merged."""
        if error.code != "ARTIFACT_EXISTS":
            self._note("observation for %s could not be committed: %s" % (identity["request_id"], error))
            return
        conflict = self._stream_facts(identity, entry, state, started)
        refused = bytes(state["body"])
        conflict.update({
            "kind": KIND_CONFLICT,
            "reason": IDENTITY_CONFLICT,
            "conflicting_path": os.path.relpath(path, self.directory).replace("\\", "/"),
            "retained_bytes": 0,
            "discarded_bytes": len(refused),
            "body_retained": False,
            "refused_body_digest": _digest(refused),
            "recorded_at": _utc(time.time()),
        })
        commit = self._commit(os.path.join(folder, CONFLICT_FILE), _bytes(conflict))
        if commit is not None:
            self._note("conflict for %s already recorded or uncommittable: %s"
                       % (identity["request_id"], commit))


def _bytes(document: dict) -> bytes:
    return (json.dumps(document, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def _parse_length(raw: str):
    """A content-length that is not a plain non-negative integer is treated as absent, not as a promise."""
    if raw.isdigit():
        return int(raw)
    return None
