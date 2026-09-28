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
import urllib.parse
import urllib.request

MAX_RESPONSE_BYTES = 1024 * 1024
DEFAULT_DEADLINE_MS = 5000
SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,127}$")
ATTEMPT_ID = re.compile(r"^attempt_[A-Za-z0-9_-]+$")
RUN_ID = re.compile(r"^run_[A-Za-z0-9_-]+$")
IDENTITY_HEADER = "X-Stackgate-Request-Id"
METHODS = ("GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE")
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]")
CONTROL_OR_DEL = re.compile(r"[\x00-\x1f\x7f]")
WHITESPACE = re.compile(r"\s")


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


def parse_operation_key(operation_key: str) -> dict:
    """Validate the operation key grammar only, matching `OperationKey` in the shared schema.

    A key can be grammatically valid and still unsupported for the first release (`api:GET /a#b`);
    that is decided by `path_rule_violation`, never by quietly editing the path into something else.
    """
    if not isinstance(operation_key, str) or ":" not in operation_key:
        raise ProbeError("OPERATION_KEY_INVALID", str(operation_key))
    service, rest = operation_key.split(":", 1)
    if " " not in rest:
        raise ProbeError("OPERATION_KEY_INVALID", operation_key)
    method, path = rest.split(" ", 1)
    if not SAFE_ID.match(service) or method not in METHODS:
        raise ProbeError("OPERATION_KEY_INVALID", operation_key)
    if not path.startswith("/") or CONTROL_OR_DEL.search(path) or WHITESPACE.search(path):
        raise ProbeError("OPERATION_KEY_INVALID", operation_key)
    return {"service_id": service, "method": method, "path": path}


def split_operation(operation_key: str) -> tuple[str, str]:
    """An operation key is `<service>:<METHOD> <path>`, e.g. `api:GET /api/performance`."""
    parsed = parse_operation_key(operation_key)
    return parsed["method"], parsed["path"]


def path_rule_violation(path: str):
    """The first release sends an exact literal path only; anything ambiguous is refused by name."""
    if not isinstance(path, str) or len(path) == 0 or path[0] != "/":
        return "PATH_INVALID"
    if CONTROL_OR_DEL.search(path) or WHITESPACE.search(path):
        return "PATH_CONTROL_CHARS_FORBIDDEN"
    if "?" in path:
        return "PATH_QUERY_FORBIDDEN"
    if "#" in path:
        return "PATH_FRAGMENT_FORBIDDEN"
    if "\\" in path:
        return "PATH_BACKSLASH_FORBIDDEN"
    if "%" in path:
        return "PATH_ENCODING_UNSUPPORTED"
    if "{" in path or "}" in path:
        return "PATH_TEMPLATE_UNSUPPORTED"
    if "//" in path:
        return "PATH_DUPLICATE_SEPARATOR_FORBIDDEN"
    if any(segment in (".", "..") for segment in path.split("/")):
        return "PATH_AMBIGUOUS_SEGMENT_FORBIDDEN"
    return None


def normalize_origin(raw):
    """Return (normalized, None) or (None, reason). Mirrors normalizeOrigin in packages/core exactly."""
    if not isinstance(raw, str) or raw == "":
        return None, "ORIGIN_EMPTY"
    if CONTROL_OR_DEL.search(raw) or WHITESPACE.search(raw):
        return None, "ORIGIN_CONTROL_CHARS"
    parts = urllib.parse.urlsplit(raw)
    scheme = (parts.scheme or "").lower()
    if not parts.netloc:
        return None, "ORIGIN_UNPARSEABLE"
    if scheme not in ("http", "https"):
        return None, "ORIGIN_SCHEME_FORBIDDEN"
    if parts.username is not None or parts.password is not None:
        return None, "ORIGIN_USERINFO_FORBIDDEN"
    host = (parts.hostname or "").lower()
    if not host:
        return None, "ORIGIN_UNPARSEABLE"
    if parts.path not in ("", "/"):
        return None, "ORIGIN_PATH_NOT_ALLOWED"
    if parts.query or parts.fragment:
        return None, "ORIGIN_QUERY_NOT_ALLOWED"
    try:
        port = parts.port
    except ValueError:
        return None, "ORIGIN_PORT_INVALID"
    if port is not None and (port < 1 or port > 65535):
        return None, "ORIGIN_PORT_INVALID"
    if port == (443 if scheme == "https" else 80):
        port = None
    serialized = "%s://%s%s" % (scheme, host, "" if port is None else ":%d" % port)
    return {"origin": serialized, "host": host, "port": port, "loopback": host in LOOPBACK_HOSTS}, None


def _same_origin(candidate, target: str) -> bool:
    """An allowlist entry that cannot be parsed simply never matches; it is not an error of its own."""
    normalized, reason = normalize_origin(candidate)
    return reason is None and normalized["origin"] == target


def is_positive_safe_integer(value, maximum: int) -> bool:
    """Positive safe integers only: NaN, infinities, fractions, booleans and strings never become a budget."""
    if isinstance(value, bool) or not isinstance(value, int):
        return False
    return 1 <= value <= maximum


def authorize_request(*, origin: str, method: str, path: str, declared_operation_key,
                      allowed_origins, allowed_methods=("GET",), deadline_ms: int = DEFAULT_DEADLINE_MS,
                      max_response_bytes: int = MAX_RESPONSE_BYTES, service_origins=None) -> dict:
    """Mirror of authorizeRequest in packages/core/src/services/http-policy.ts, including rule order."""
    resolved, reason = normalize_origin(origin)
    if reason:
        return {"allowed": False, "reason": reason}
    if not any(_same_origin(entry, resolved["origin"]) for entry in (allowed_origins or [])):
        return {"allowed": False, "reason": "ORIGIN_NOT_AUTHORIZED"}
    upper = (method or "").upper()
    if upper not in allowed_methods:
        return {"allowed": False, "reason": "METHOD_NOT_AUTHORIZED"}
    if declared_operation_key is None:
        return {"allowed": False, "reason": "DECLARATION_MISSING"}
    try:
        declared = parse_operation_key(declared_operation_key)
    except ProbeError:
        return {"allowed": False, "reason": "OPERATION_KEY_INVALID"}
    if service_origins is not None:
        binding = service_origins.get(declared["service_id"])
        if binding is None:
            return {"allowed": False, "reason": "SERVICE_ORIGIN_MISSING"}
        bound, binding_reason = normalize_origin(binding)
        if binding_reason:
            return {"allowed": False, "reason": "SERVICE_ORIGIN_UNPARSEABLE"}
        if bound["origin"] != resolved["origin"]:
            return {"allowed": False, "reason": "SERVICE_ORIGIN_MISMATCH"}
    if declared["method"] != upper:
        return {"allowed": False, "reason": "OPERATION_METHOD_MISMATCH"}
    violation = path_rule_violation(path)
    if violation:
        return {"allowed": False, "reason": violation}
    violation = path_rule_violation(declared["path"])
    if violation:
        return {"allowed": False, "reason": violation}
    if path != declared["path"]:
        return {"allowed": False, "reason": "OPERATION_PATH_MISMATCH"}
    if not is_positive_safe_integer(max_response_bytes, MAX_RESPONSE_BYTES):
        return {"allowed": False, "reason": "RESPONSE_BUDGET_OUT_OF_RANGE"}
    if not is_positive_safe_integer(deadline_ms, 60000):
        return {"allowed": False, "reason": "DEADLINE_OUT_OF_RANGE"}
    return {"allowed": True, "reason": None}


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        raise urllib.error.HTTPError(newurl, code, "redirect refused by policy", headers, fp)


def perform_request(*, origin: str, operation_key: str, allowed_origins: list[str],
                    identity: dict, deadline_ms: int = DEFAULT_DEADLINE_MS,
                    max_response_bytes: int = MAX_RESPONSE_BYTES,
                    service_origins: dict | None = None) -> dict:
    """Execute exactly one declared GET and return the raw facts of that attempt.

    Nothing reaches the network until `authorize_request` has agreed, field by field, that the caller's
    origin, method and path are the ones the confirmed declaration names. The URL is then built from the
    declaration itself, so a caller cannot supply a second, different target alongside it.
    """
    # The caller never supplies a path of its own: the wire path can only be the declared one, so a
    # second, different target cannot be smuggled in beside the declaration. An unparseable key still
    # reaches authorize_request in the same rule position as the TypeScript side.
    try:
        requested_path = parse_operation_key(operation_key)["path"]
    except ProbeError:
        requested_path = ""
    decision = authorize_request(origin=origin, method="GET", path=requested_path,
                                declared_operation_key=operation_key, allowed_origins=allowed_origins,
                                deadline_ms=deadline_ms, max_response_bytes=max_response_bytes,
                                service_origins=service_origins)
    if not decision["allowed"]:
        raise ProbeError(decision["reason"], origin if decision["reason"].startswith("ORIGIN") else operation_key)
    validate_identity(identity)
    declared = parse_operation_key(operation_key)
    method, path = declared["method"], declared["path"]

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
        # The literal URL handed to the opener. A listener records what it actually received; this only
        # proves what the helper intended to address, so the two can be compared instead of assumed equal.
        "request_target": request.full_url,
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
