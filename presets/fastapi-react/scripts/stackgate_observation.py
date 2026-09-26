"""Test-only ASGI observation middleware for the FastAPI/React preset.

It records independent facts about requests that actually reached this process. It is not a
signature and not a security boundary: it only proves what this instance observed while running the
declared inputs. Disabled unless an explicit test launcher constructs it.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time

SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,127}$")
ATTEMPT_ID = re.compile(r"^attempt_[A-Za-z0-9_-]+$")
RUN_ID = re.compile(r"^run_[A-Za-z0-9_-]+$")
EXCLUDED_FIELDS = ("authorization", "cookie", "set-cookie")
MAX_RECORDED_BYTES = 1024 * 1024


class ObservationError(Exception):
    pass


def _utc(value: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(value)) + ".%03dZ" % int(value * 1000 % 1000)


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
        self.app = app
        self.directory = directory
        self.instance_id = instance_id
        self.allowed_run_ids = {str(item) for item in allowed_run_ids}
        self.data_revision = data_revision
        self.operations = operations if operations is not None else OBSERVED_OPERATIONS
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
        run_id = headers.get("x-stackgate-run-id", "")
        check_id = headers.get("x-stackgate-check-id", "")
        attempt_id = headers.get("x-stackgate-attempt-id", "")
        request_id = headers.get("x-stackgate-request-id", "")
        if entry is None or run_id not in self.allowed_run_ids:
            await self.app(scope, receive, send)
            return
        if not (SAFE_ID.match(check_id) and ATTEMPT_ID.match(attempt_id) and SAFE_ID.match(request_id) and SAFE_ID.match(run_id)):
            await self.app(scope, receive, send)
            return

        state = {"status": None, "media": "", "body": bytearray(), "overflow": False, "sent_at": None}

        async def send_wrapper(message) -> None:
            if message["type"] == "http.response.start":
                state["status"] = int(message["status"])
                for key, value in message.get("headers", []) or []:
                    if key.decode("latin-1").lower() == "content-type":
                        state["media"] = value.decode("latin-1").split(";")[0].strip()
                # The instance identity is produced here, never copied from a client header.
                message = dict(message)
                message["headers"] = list(message.get("headers", []) or []) + [
                    (b"x-stackgate-instance-id", self.instance_id.encode("latin-1")),
                    (b"x-stackgate-data-revision", self.data_revision.encode("latin-1")),
                ]
            elif message["type"] == "http.response.body":
                chunk = message.get("body", b"") or b""
                if len(state["body"]) + len(chunk) <= self.max_recorded_bytes:
                    state["body"] += chunk
                else:
                    state["overflow"] = True
                state["sent_at"] = time.time()
            await send(message)

        started = time.time()
        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            self._record({
                "run_id": run_id, "check_id": check_id, "attempt_id": attempt_id, "request_id": request_id,
                "operation_key": entry["operation_key"], "status_code": state["status"],
                "media_type": state["media"], "body": bytes(state["body"]), "overflow": state["overflow"],
                "started_at": _utc(started), "finished_at": _utc(state["sent_at"] or time.time()),
            })

    def _record(self, facts) -> None:
        if facts["status_code"] is None:
            return
        if facts["overflow"]:
            # Without the complete response bytes there is nothing to attest; record no observation and
            # let the collector report the missing fact instead of storing a partial digest.
            return
        target_dir = os.path.join(self.directory, facts["run_id"], facts["attempt_id"])
        os.makedirs(target_dir, exist_ok=True)
        record = {
            "schema_version": "0.1",
            "run_id": facts["run_id"],
            "check_id": facts["check_id"],
            "attempt_id": facts["attempt_id"],
            "request_id": facts["request_id"],
            "instance_id": self.instance_id,
            "operation_key": facts["operation_key"],
            "status_code": int(facts["status_code"]),
            "media_type": facts["media_type"],
            "started_at": facts["started_at"],
            "finished_at": facts["finished_at"],
            "response_bytes": len(facts["body"]),
            "response_digest": hashlib.sha256(facts["body"]).hexdigest(),
            "digest_input_form": "UNCOMPRESSED_UTF8_BODY_BYTES",
            "observation_path": os.path.relpath(os.path.join(target_dir, f"{facts['request_id']}.bin"), self.directory).replace("\\", "/"),
            "excluded_fields": ["Authorization", "Cookie", "Set-Cookie"],
        }
        with open(os.path.join(target_dir, f"{facts['request_id']}.bin"), "wb") as handle:
            handle.write(facts["body"])
        temporary = os.path.join(target_dir, f"{facts['request_id']}.json.partial")
        with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(record, handle, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, os.path.join(target_dir, f"{facts['request_id']}.json"))
