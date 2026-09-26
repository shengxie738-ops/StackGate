"""Bounded HTTP probe helpers for the FastAPI/React preset.

Stdlib only. The helper never evaluates response content, never follows redirects, never reads
credentials from the environment, and refuses any operation that is not declared and authorized.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import time
import urllib.error
import urllib.request

MAX_RESPONSE_BYTES = 1024 * 1024
DEFAULT_DEADLINE_MS = 5000
SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,127}$")
ATTEMPT_ID = re.compile(r"^attempt_[A-Za-z0-9_-]+$")
RUN_ID = re.compile(r"^run_[A-Za-z0-9_-]+$")
ORIGIN = re.compile(r"^https?://(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$")
IDENTITY_HEADER = "X-Stackgate-Request-Id"


class ProbeError(Exception):
    """Carries a machine-readable reason so the collector can classify failures precisely."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def _utc(value: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(value)) + ".%03dZ" % int(value * 1000 % 1000)


def validate_identity(identity: dict) -> None:
    if not RUN_ID.match(str(identity.get("run_id", ""))):
        raise ProbeError("IDENTITY_INVALID", "run_id")
    if not SAFE_ID.match(str(identity.get("check_id", ""))):
        raise ProbeError("IDENTITY_INVALID", "check_id")
    if not ATTEMPT_ID.match(str(identity.get("attempt_id", ""))):
        raise ProbeError("IDENTITY_INVALID", "attempt_id")
    if not SAFE_ID.match(str(identity.get("request_id", ""))):
        raise ProbeError("IDENTITY_INVALID", "request_id")


def split_operation(operation_key: str) -> tuple[str, str]:
    """An operation key is `<service>:<METHOD> <path>`, e.g. `api:GET /api/performance`."""
    if ":" not in operation_key:
        raise ProbeError("OPERATION_KEY_INVALID", operation_key)
    service, rest = operation_key.split(":", 1)
    parts = rest.split(" ", 1)
    if len(parts) != 2 or not parts[1].startswith("/"):
        raise ProbeError("OPERATION_KEY_INVALID", operation_key)
    return parts[0], parts[1]


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        raise urllib.error.HTTPError(newurl, code, "redirect refused by policy", headers, fp)


def perform_request(*, origin: str, operation_key: str, allowed_origins: list[str],
                    identity: dict, deadline_ms: int = DEFAULT_DEADLINE_MS,
                    max_response_bytes: int = MAX_RESPONSE_BYTES) -> dict:
    """Execute exactly one declared GET and return the raw facts of that attempt."""
    if not ORIGIN.match(origin):
        raise ProbeError("ORIGIN_INVALID", origin)
    if origin not in allowed_origins:
        raise ProbeError("ORIGIN_NOT_AUTHORIZED", origin)
    if max_response_bytes < 1 or max_response_bytes > MAX_RESPONSE_BYTES:
        raise ProbeError("RESPONSE_BUDGET_OUT_OF_RANGE", str(max_response_bytes))
    if deadline_ms < 1 or deadline_ms > 60000:
        raise ProbeError("DEADLINE_OUT_OF_RANGE", str(deadline_ms))
    validate_identity(identity)
    method, path = split_operation(operation_key)
    if method != "GET":
        raise ProbeError("METHOD_NOT_AUTHORIZED", method)
    if "?" in path or any(ord(char) < 0x20 or ord(char) == 0x7F for char in path):
        raise ProbeError("PATH_INVALID", path)

    opener = urllib.request.build_opener(_RejectRedirects())
    request = urllib.request.Request(origin + path, method="GET")
    request.add_header("Accept", "application/json")
    request.add_header(IDENTITY_HEADER, identity["request_id"])
    request.add_header("X-Stackgate-Run-Id", identity["run_id"])
    request.add_header("X-Stackgate-Check-Id", identity["check_id"])
    request.add_header("X-Stackgate-Attempt-Id", identity["attempt_id"])

    started = time.time()
    started_at = _utc(started)
    deadline = started + deadline_ms / 1000.0
    try:
        with opener.open(request, timeout=max(0.05, deadline - time.time())) as response:
            body = _read_bounded(response, max_response_bytes)
            payload = {
                "status_code": int(response.status),
                "media_type": response.headers.get("Content-Type", "").split(";")[0].strip(),
                "body": body,
                "instance_id": (response.headers.get("X-Stackgate-Instance-Id") or "").strip(),
                "observed_request_id": (response.headers.get(IDENTITY_HEADER) or "").strip(),
            }
    except urllib.error.HTTPError as error:
        if error.code in (301, 302, 303, 307, 308):
            raise ProbeError("REDIRECT_REFUSED", str(error.code)) from error
        body = _read_bounded(error, max_response_bytes)
        payload = {
            "status_code": int(error.code),
            "media_type": (error.headers.get("Content-Type", "") if error.headers else "").split(";")[0].strip(),
            "body": body,
            "instance_id": (error.headers.get("X-Stackgate-Instance-Id", "") if error.headers else "").strip(),
            "observed_request_id": (error.headers.get(IDENTITY_HEADER, "") if error.headers else "").strip(),
        }
    except urllib.error.URLError as error:
        raise ProbeError("CONNECT_FAILED", str(error.reason)) from error
    except socket.timeout as error:
        raise ProbeError("DEADLINE_EXCEEDED", str(deadline_ms)) from error
    payload.update({
        "started_at": started_at,
        "finished_at": _utc(time.time()),
        "response_digest": "sha256:" + hashlib.sha256(payload["body"]).hexdigest(),
        "request_id": identity["request_id"],
        "operation_key": operation_key,
    })
    return payload


def _read_bounded(source, max_bytes: int) -> bytes:
    read = getattr(source, "read", None)
    if read is None:
        return b""
    collected = bytearray()
    while True:
        chunk = read(65536)
        if not chunk:
            break
        collected.extend(chunk)
        if len(collected) > max_bytes:
            raise ProbeError("RESPONSE_OVER_BUDGET", str(len(collected)))
    return bytes(collected)


def resolve_pointer(document, pointer: str):
    """RFC 6901 resolution. Returns (found, value)."""
    if not pointer.startswith("/"):
        raise ProbeError("POINTER_INVALID", pointer)
    current = document
    for raw in pointer[1:].split("/"):
        token = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            if not token.isdigit() or int(token) >= len(current):
                return False, None
            current = current[int(token)]
        elif isinstance(current, dict):
            if token not in current:
                return False, None
            current = current[token]
        else:
            return False, None
    return True, current


def evaluate_assertion(document, assertion: dict) -> bool:
    found, value = resolve_pointer(document, assertion["pointer"])
    operator = assertion["operator"]
    if operator == "exists":
        return found
    if not found:
        return False
    expected = assertion.get("expected")
    if operator == "type":
        kinds = {"string": str, "number": (int, float), "boolean": bool, "null": type(None)}
        kind = kinds.get(expected)
        if kind is None:
            raise ProbeError("OPERATOR_EXPECTED_INVALID", expected)
        if expected == "number":
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        if expected == "boolean":
            return isinstance(value, bool)
        return isinstance(value, kind)
    if operator == "equals":
        if isinstance(value, bool) or isinstance(expected, bool):
            return value is expected
        return value == expected
    numeric = {"number_lt": lambda a, b: a < b, "number_lte": lambda a, b: a <= b,
               "number_gt": lambda a, b: a > b, "number_gte": lambda a, b: a >= b}
    compare = numeric.get(operator)
    if compare is None:
        raise ProbeError("OPERATOR_UNSUPPORTED", operator)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isinstance(expected, (int, float)):
        return False
    return bool(compare(value, expected))


def write_json(path: str, value) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".partial"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
    os.replace(temporary, path)
