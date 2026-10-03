"""Bounded HTTP probe helpers for the FastAPI/React preset.

Stdlib only. The helper never evaluates response content, never follows redirects, refuses any operation that
is not declared and authorized, and refuses any route it did not choose: `ProxyHandler({})` means neither an
environment variable nor a system proxy setting can send the declared request somewhere else.

The deadline is absolute. It is computed from a monotonic clock when the request starts and it covers process
start, name resolution, connect, response headers and response body. Because a blocking read cannot be
interrupted from inside the same process, the request itself runs in a private one-shot worker
(`probe_worker.py`) that the parent may terminate; the parent then waits for the handle it created and refuses
to report success until that wait proves the worker is gone. The outer Runner timeout stays a second line of
defense rather than a substitute for this deadline.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import socket
import struct
import subprocess
import sys
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
# The frame is [4-byte metadata length][metadata JSON][4-byte body length][body]. Every length is checked
# against a cap before it is trusted, so a confused worker cannot make the parent allocate freely.
FRAME_HEADER_BYTES = 4
MAX_METADATA_BYTES = 64 * 1024
MAX_REQUEST_FRAME_BYTES = 16 * 1024
MAX_FRAME_BYTES = 2 * FRAME_HEADER_BYTES + MAX_METADATA_BYTES + MAX_RESPONSE_BYTES
WORKER_SCRIPT = "probe_worker.py"
# Only what the interpreter needs. No proxy variable and nothing that could name a credential is forwarded.
WORKER_ENV_ALLOWLIST = ("SYSTEMROOT", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "SYSTEMDRIVE", "TEMP", "TMP", "TMPDIR")
# Inside the worker the same rule is applied a second time: whatever the parent handed over is filtered again,
# so an active virtual environment or a proxy in the caller's environment cannot decide what the one request
# imports or where it goes. Nothing here is a value - only names are ever compared or reported.
WORKER_NEUTRAL_ENV_ALLOWLIST = ("SYSTEMROOT", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "SYSTEMDRIVE",
                                "TEMP", "TMP", "TMPDIR", "HOME", "LANG", "LC_ALL", "TZ")
# Anything that could name a proxy, a credential or an interpreter choice is not allowed to survive into the
# process that performs the request.
PRIVILEGE_BEARING_NAME = re.compile(
    r"proxy|credential|token|secret|password|authorization|cookie|api[-_]?key|python|virtual|-_?env", re.IGNORECASE)
# Both reclamation points wait on the handle this process created - `subprocess.wait`, reached through
# `communicate()`, and after a deadline through `kill()` plus a bounded final wait. That wait is platform
# independent: on Windows it is a wait on the process handle, on POSIX a waitpid on the child. It is not
# `taskkill`, not a name match and not a signal sent to a process group.
REAP_MECHANISM = "subprocess.wait on the handle this process created"
REAP_TIMEOUT_SECONDS = 5.0
# How long the parent waits for the output pipes to reach end of file after the handle has already reported
# an exit. A child that started its own interpreter would keep the write end open, so this is bounded: the
# parent must never trade the request deadline for an unbounded cleanup wait.
PIPE_DRAIN_TIMEOUT_SECONDS = 2.0
# The templates that ship this helper never compress a response; anything else is refused rather than decoded
# and then reported as if it were the bytes that arrived on the wire.
SUPPORTED_CONTENT_ENCODINGS = ("", "identity")
# The unified classification every caller and every branch shares: a request outcome is always one of these,
# whether it arrived as an exception, an HTTP error status or a malformed worker answer.
REQUEST_ERROR_CODES = ("DEADLINE_EXCEEDED", "CONNECT_FAILED", "RESPONSE_OVER_BUDGET", "REDIRECT_REFUSED",
                       "CONTENT_ENCODING_UNSUPPORTED", "WORKER_PROTOCOL_ERROR", "WORKER_NOT_RECLAIMED",
                       "WORKER_SPAWN_FAILED", "WORKER_CRASHED", "WORKER_IDENTITY_MISMATCH",
                       "FRAME_OVER_BUDGET")
# A worker that declines its work order says so with one of these; nothing was sent when it does.
REFUSAL_ERROR_CODES = ("WORKER_REJECTED", "WORKER_ORIGIN_UNAUTHORIZED", "WORKER_URL_ESCAPE", "WORKER_PATH_RULE",
                       "WORKER_NOT_PROVEN")


class ProbeError(Exception):
    """Carries a machine-readable reason so the collector can classify failures precisely.

    `facts` carries what actually happened around the failure - for a request failure, the fate of the private
    worker - without changing the positional `code`/`detail` contract the callers already rely on.
    """

    def __init__(self, code: str, detail: str = "", facts: dict | None = None) -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail
        self.facts = dict(facts) if facts else {}



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


def frame(metadata: dict, body: bytes = b"", max_body: int = MAX_RESPONSE_BYTES) -> bytes:
    """Serialize one bounded message. A frame that would exceed its cap is refused, never truncated."""
    encoded = json.dumps(metadata, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(encoded) > MAX_METADATA_BYTES:
        raise ProbeError("FRAME_OVER_BUDGET", "metadata %d" % len(encoded))
    if len(body) > max_body:
        raise ProbeError("FRAME_OVER_BUDGET", "body %d" % len(body))
    return (struct.pack(">I", len(encoded)) + encoded
            + struct.pack(">I", len(body)) + body)


def _read_one_frame(data: bytes, offset: int, *, max_body: int, label: str) -> tuple[dict, bytes, int]:
    header = FRAME_HEADER_BYTES
    if len(data) < offset + header:
        raise ProbeError("FRAME_TRUNCATED", "header")
    metadata_length = struct.unpack(">I", data[offset:offset + header])[0]
    if metadata_length > MAX_METADATA_BYTES:
        raise ProbeError("WORKER_PROTOCOL_ERROR", "%s metadata %d" % (label, metadata_length))
    body_field = offset + header + metadata_length
    if len(data) < body_field + header:
        raise ProbeError("FRAME_TRUNCATED", "metadata")
    try:
        metadata = json.loads(data[offset + header:body_field].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProbeError("WORKER_PROTOCOL_ERROR", "%s metadata: %s" % (label, error)) from error
    if not isinstance(metadata, dict):
        raise ProbeError("WORKER_PROTOCOL_ERROR", "%s metadata is not an object" % label)
    body_length = struct.unpack(">I", data[body_field:body_field + header])[0]
    if body_length > max_body:
        # A body length the reader was never granted is the sender breaking the protocol. It is not the
        # upstream condition RESPONSE_OVER_BUDGET, which only a real read past the budget may report.
        raise ProbeError("WORKER_PROTOCOL_ERROR", "%s body %d over cap %d" % (label, body_length, max_body))
    end = body_field + header + body_length
    if len(data) < end:
        raise ProbeError("FRAME_TRUNCATED", "body")
    return metadata, data[body_field + header:end], end


def unframe(data: bytes, *, max_body: int = MAX_RESPONSE_BYTES, label: str = "worker") -> tuple[dict, bytes]:
    """Parse exactly one frame from a buffer that must hold nothing else."""
    if len(data) > MAX_FRAME_BYTES:
        raise ProbeError("WORKER_PROTOCOL_ERROR", "%s output %d bytes" % (label, len(data)))
    if not data:
        raise ProbeError("WORKER_PROTOCOL_ERROR", "%s sent no frame" % label)
    try:
        metadata, body, end = _read_one_frame(data, 0, max_body=max_body, label=label)
    except ProbeError as error:
        if error.code == "FRAME_TRUNCATED":
            raise ProbeError("WORKER_PROTOCOL_ERROR", "%s %s" % (label, error.detail)) from error
        raise
    if end != len(data):
        raise ProbeError("WORKER_PROTOCOL_ERROR", "%s trailing bytes" % label)
    return metadata, body


def _worker_environment() -> dict:
    """The worker's environment: an allowlist, so nothing inherited can carry a proxy or a credential."""
    allowed = {name.upper() for name in WORKER_ENV_ALLOWLIST}
    resolved: dict[str, str] = {}
    for key, value in os.environ.items():
        name = key.upper()
        if name in allowed and value:
            resolved[name] = value
    return resolved


def _worker_executable() -> str:
    """The interpreter for the one request, preferring the real binary over a virtual-environment launcher.

    A venv's `python.exe` can be a stub that starts the base interpreter as its own child, which would leave
    the handle we wait on pointing at something other than the process holding the socket. `sys._base_executable`
    is the interpreter that stub re-executes, so waiting on it is waiting on the reader itself. Measured on this
    machine: from inside the venv stub the base path yields one process whose pid the interpreter reports as its
    own, while the stub path yields two.
    """
    base = str(getattr(sys, "_base_executable", "") or "")
    if base and os.path.isfile(base):
        return base
    return sys.executable


def _neutralize_environment() -> list:
    """Drop every variable the worker was not given a reason to have. Returns the names removed.

    An active virtual environment works through `*_HOME`, `*_PATH` and `*_PREVIEW` style variables and through
    the interpreter that was started; a proxy or a credential arrives the same way. Removing them here is the
    second layer - the parent already built a deliberately small environment - and the removal list is what the
    caller reports, so "nothing was inherited" is something a reader can check rather than take on faith.
    """
    keep = {name.upper() for name in WORKER_NEUTRAL_ENV_ALLOWLIST}
    removed = []
    for name in sorted(os.environ, key=str.upper):
        if name.upper() in keep:
            continue
        removed.append(name.lower())
        try:
            del os.environ[name]
        except KeyError:  # another thread, or a platform that will not forget it
            pass
    return removed


def _neutralize_privileges(facts: dict) -> None:
    """What this process can still do, recorded honestly instead of claimed uniformly.

    `umask` exists on both platforms. Supplementary-group release does not: on Windows there is no
    `os.getgroups`, and POSIX-only calls are reported as unsupported rather than pretended with.
    """
    try:
        os.umask(0o077)
        facts["umask_set"] = True
    except OSError as error:
        facts["umask_set"] = False
        facts["umask_error"] = str(error)
    release = getattr(os, "getgroups", None)
    if release is None:
        facts["groups_release"] = "unsupported"
        return
    try:
        groups = release()
        setgroups = getattr(os, "setgroups", None)
        if setgroups is None:
            facts["groups_release"] = "unsupported"
            return
        setgroups([] if not groups else groups[:0])
        facts["groups_release"] = "released" if not release() else "partial"
    except OSError as error:
        # A non-root process cannot drop groups it was not given; that is recorded, not hidden.
        facts["groups_release"] = "refused"
        facts["groups_error"] = str(error)


def run_privileged(request: dict, facts: dict) -> tuple[dict, bytes]:
    """Perform the one request from a process that kept nothing, recording what it dropped first.

    The request does not start until the neutralisation reported here has happened; the record is what lets a
    reader see that it did.
    """
    _neutralize_privileges(facts)
    facts["removed_environment_variables"] = _neutralize_environment()
    facts["environment_variables"] = sorted(name.lower() for name in os.environ)
    return execute_request(request)


def _launch_proofs(script: str, executable: str, environment: dict, request_frame: bytes) -> dict:
    """Everything that must hold before a private worker exists at all.

    If one of these is false, no process is created to find out what happens: the failure is reported with the
    proof that is missing rather than as a cleanup claim about a worker that never ran.
    """
    return {
        "worker_script_present": os.path.isfile(script),
        "interpreter_present": os.path.isfile(executable),
        "request_frame_within_cap": len(request_frame) <= MAX_REQUEST_FRAME_BYTES,
        "environment_within_allowlist": all(name.upper() in WORKER_ENV_ALLOWLIST for name in environment),
        "environment_present": bool(environment),
    }


def _env_projection() -> dict:
    """What this process can still be influenced by, as names only.

    An active virtual environment selects itself through `*_HOME`, `*_PATH` and `*_PREVIEW` variables, a proxy
    through `*_proxy`, a credential through anything that names one. A reader of the artifact can check the
    projection is empty instead of trusting a sentence in a docstring; no value is ever recorded.
    """
    names = sorted(name.lower() for name in os.environ)
    return {
        "environment_names": names,
        "environment_interpretable": [name for name in names if PRIVILEGE_BEARING_NAME.search(name)],
        "prefix": sys.prefix,
        "base_prefix": sys.base_prefix,
    }


def _terminate_and_reap(process: subprocess.Popen, facts: dict) -> None:
    """Terminate only the process this call created, then prove it is gone.

    Two independent checks, in the order that cannot hang. `wait()` is the deterministic one: it is a wait on
    the handle this process created, on Windows for a process handle and on POSIX for the child pid, and it
    stops the moment the kernel records the exit. The pipe drain is the reachability one: end of file arrives
    only when every holder of the write end has let go, so it is what shows a launcher whose real interpreter
    kept running - it would still hold the socket the request reads through. Neither is assumed; if either
    fails this is a tool/resource error rather than a cleanup that was taken on faith.
    """
    facts["killed"] = True
    try:
        process.stdin.close()
    except OSError:
        pass  # the request frame already reached end of file
    try:
        process.kill()
    except OSError as error:  # already gone, or the handle refuses the request; either way we still wait
        facts["kill_error"] = str(error)
    started = time.monotonic()
    try:
        process.wait(timeout=REAP_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        facts["reap_ms"] = int((time.monotonic() - started) * 1000)
        facts["worker_exit_code"] = process.poll()
        facts["pipes_closed"] = False
        facts["reclaimed"] = False
        raise ProbeError("WORKER_NOT_RECLAIMED", "pid %s never reported an exit status" % process.pid, facts)
    facts["reap_ms"] = int((time.monotonic() - started) * 1000)
    facts["worker_exit_code"] = process.poll()
    facts["handle_reaped"] = True
    closed = True
    try:
        process.communicate(timeout=PIPE_DRAIN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        closed = False
    facts["pipes_closed"] = closed
    facts["reap_mechanism"] = REAP_MECHANISM
    # Both halves have to hold before anything is called reclaimed.
    facts["reclaimed"] = closed
    if not closed:
        raise ProbeError("WORKER_NOT_RECLAIMED",
                         "pid %s exited but something still holds its output pipes" % process.pid, facts)


def _run_worker(payload: dict, *, deadline_ms: int, deadline_at: float, facts: dict) -> tuple[dict, bytes]:
    """Ask the private worker for exactly one request and hold the absolute monotonic deadline over it."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), WORKER_SCRIPT)
    request_frame = frame(payload, max_body=MAX_REQUEST_FRAME_BYTES)
    executable = _worker_executable()
    environment = _worker_environment()
    facts["worker_executable"] = executable
    proofs = _launch_proofs(script, executable, environment, request_frame)
    facts["launch_proofs"] = proofs
    if not all(proofs.values()):
        # Something about this launch cannot be proven beforehand, so no process is started to find out.
        raise ProbeError("WORKER_NOT_PROVEN", json.dumps(proofs, sort_keys=True), facts)
    try:
        process = subprocess.Popen([executable, "-B", "-E", script], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=os.path.dirname(script),
                                   env=environment, close_fds=True)
    except OSError as error:
        raise ProbeError("WORKER_SPAWN_FAILED", str(error), facts) from error
    facts["worker_pid"] = process.pid
    facts["spawned"] = True
    try:
        # The worker is given the budget that is left, never the whole deadline again: this call and the
        # socket timeouts inside the child share one absolute reference taken before the child existed.
        stdout, stderr = process.communicate(input=request_frame,
                                             timeout=max(0.001, deadline_at - time.monotonic()))
    except subprocess.TimeoutExpired:
        try:
            _terminate_and_reap(process, facts)
        except ProbeError as unclean:
            unclean.facts["deadline_ms"] = deadline_ms
            raise
        facts["deadline_ms"] = deadline_ms
        raise ProbeError("DEADLINE_EXCEEDED", str(deadline_ms), facts) from None
    facts["worker_exit_code"] = process.poll()
    facts["handle_reaped"] = process.returncode is not None
    # `communicate()` only returns once both pipes reached end of file, so the pipe half of the proof is
    # already satisfied here; the exit status still has to come from the handle we created.
    facts["pipes_closed"] = True
    facts["killed"] = False
    facts["deadline_ms"] = deadline_ms
    facts["worker_stderr"] = _text(stderr)[:200]
    facts["reclaimed"] = facts["handle_reaped"]
    if not facts["reclaimed"]:
        # communicate() returned but the handle will not report an exit status: nothing can be claimed about
        # this worker being finished, so this is a tool/resource failure.
        raise ProbeError("WORKER_NOT_RECLAIMED", str(process.pid), facts)
    facts["reap_mechanism"] = REAP_MECHANISM
    if time.monotonic() > deadline_at:
        # An answer that arrives after the absolute deadline is not an answer inside budget.
        raise ProbeError("DEADLINE_EXCEEDED", str(deadline_ms), facts)
    if not stdout:
        raise ProbeError("WORKER_PROTOCOL_ERROR", "empty answer, exit %s: %s"
                         % (process.returncode, _text(stderr)[:200]), facts)
    metadata, body = unframe(stdout, max_body=payload["max_response_bytes"])
    if metadata.get("ok") is not True:
        code = str(metadata.get("code") or "WORKER_PROTOCOL_ERROR")
        if code not in REQUEST_ERROR_CODES + REFUSAL_ERROR_CODES:
            code = "WORKER_PROTOCOL_ERROR"
        facts["worker_neutralized"] = metadata.get("neutralized")
        raise ProbeError(code, str(metadata.get("detail") or ""), facts)
    # The reader must be the process this parent created and may terminate. A pid that does not match - a
    # launcher stub that re-executed into another interpreter, say - makes every claim about cancellation
    # meaningless, so it is refused here rather than recorded as a detail.
    reader = metadata.get("reader_pid")
    if reader != process.pid:
        facts["worker_reader_pid"] = reader
        raise ProbeError("WORKER_IDENTITY_MISMATCH", "reader %s is not the spawned %s" % (reader, process.pid), facts)
    facts["worker_reader_pid"] = reader
    facts["worker_prefix"] = metadata.get("prefix")
    facts["worker_base_prefix"] = metadata.get("base_prefix")
    facts["worker_environment_names"] = metadata.get("environment_names")
    facts["worker_environment_interpretable"] = metadata.get("environment_interpretable")
    facts["worker_neutralized"] = metadata.get("neutralized")
    return metadata, body


def _text(data) -> str:
    if isinstance(data, bytes):
        return data.decode("utf-8", "replace")
    return "" if data is None else str(data)


def perform_request(*, origin: str, operation_key: str, allowed_origins: list[str],
                    identity: dict, deadline_ms: int = DEFAULT_DEADLINE_MS,
                    max_response_bytes: int = MAX_RESPONSE_BYTES,
                    service_origins: dict | None = None) -> dict:
    """Execute exactly one declared GET and return the raw facts of that attempt.

    Nothing reaches the network until `authorize_request` has agreed, field by field, that the caller's
    origin, method and path are the ones the confirmed declaration names. The URL is then built from the
    declaration itself, so a caller cannot supply a second, different target alongside it.

    The request is performed by a private worker process under one absolute monotonic `deadline_ms` that
    covers process start, name resolution, connect, headers and body. Every fact the caller already read is
    still returned; `worker` is added next to them.
    """
    facts: dict = {"worker_pid": None, "spawned": False, "killed": False, "reclaimed": False,
                   "handle_reaped": False, "pipes_closed": False, "worker_exit_code": None,
                   "reap_mechanism": None, "worker_executable": None, "launch_proofs": None,
                   "deadline_ms": deadline_ms}
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
        raise ProbeError(decision["reason"],
                         origin if decision["reason"].startswith("ORIGIN") else operation_key, facts)
    validate_identity(identity)
    declared = parse_operation_key(operation_key)
    method, path = declared["method"], declared["path"]
    target = origin + path
    # The same five headers, in the same order, as the request the preset emitted before the worker existed:
    # reordering them would change the wire bytes a listener compares against the declaration. They travel as
    # pairs because a frame encodes objects with sorted keys.
    headers = [
        ["Accept", "application/json"],
        [IDENTITY_HEADER, identity["request_id"]],
        ["X-Stackgate-Run-Id", identity["run_id"]],
        ["X-Stackgate-Check-Id", identity["check_id"]],
        ["X-Stackgate-Attempt-Id", identity["attempt_id"]],
    ]
    payload = {"url": target, "origin": origin, "path": path, "method": method, "headers": headers,
               "max_response_bytes": max_response_bytes, "budget_ms": deadline_ms}

    started = time.time()
    started_at = _utc(started)
    # One monotonic reference for the whole request, taken before the worker exists: everything after this
    # point, start-up included, has to fit inside it.
    clock = time.monotonic()
    deadline_at = clock + deadline_ms / 1000.0
    try:
        metadata, body = _run_worker(payload, deadline_ms=deadline_ms, deadline_at=deadline_at, facts=facts)
    except ProbeError as error:
        error.facts.setdefault("deadline_ms", deadline_ms)
        error.facts.setdefault("elapsed_ms", int((time.monotonic() - clock) * 1000))
        raise
    facts["elapsed_ms"] = int((time.monotonic() - clock) * 1000)
    if metadata.get("request_target") != target:
        raise ProbeError("WORKER_IDENTITY_MISMATCH", str(metadata.get("request_target")), facts)
    digest = "sha256:" + hashlib.sha256(body).hexdigest()
    if metadata.get("response_digest") not in (None, digest):
        raise ProbeError("WORKER_IDENTITY_MISMATCH", "response digest", facts)
    payload_out = {
        "status_code": int(metadata["status_code"]),
        "media_type": str(metadata["media_type"]),
        "body": body,
        "instance_id": str(metadata["instance_id"]),
        "observed_request_id": str(metadata["observed_request_id"]),
        "started_at": started_at,
        "finished_at": _utc(time.time()),
        "response_digest": digest,
        "request_id": identity["request_id"],
        "operation_key": operation_key,
        # The literal URL handed to the opener. A listener records what it actually received; this only
        # proves what the helper intended to address, so the two can be compared instead of assumed equal.
        "request_target": str(metadata["request_target"]),
        "deadline_ms": deadline_ms,
        "response_bytes": len(body),
        "worker": facts,
    }
    return payload_out


def _read_bounded(source, max_bytes: int, deadline: float | None = None) -> bytes:
    """Read at most `max_bytes`, asking for no more than the remaining budget plus one byte.

    This bounds how much a single read can bring in and how many bytes can be collected; the absolute wall
    clock bound is the parent's, which terminates the worker. Checking the clock here is a second layer, not
    the mechanism.
    """
    read = getattr(source, "read", None)
    if read is None:
        return b""
    collected = bytearray()
    while True:
        if deadline is not None and time.monotonic() >= deadline:
            raise ProbeError("DEADLINE_EXCEEDED", "body read")
        remaining = max_bytes - len(collected) + 1
        chunk = read(min(65536, remaining))
        if not chunk:
            break
        collected.extend(chunk)
        if len(collected) > max_bytes:
            raise ProbeError("RESPONSE_OVER_BUDGET", str(len(collected)))
    return bytes(collected)


def _headers_of(source_headers, identity_header: str) -> dict:
    """The four response facts a collector can compare with the request that was actually sent."""
    def header(name: str) -> str:
        if source_headers is None:
            return ""
        return (source_headers.get(name) or "").strip()

    return {
        "media_type": header("Content-Type").split(";")[0].strip(),
        "instance_id": header("X-Stackgate-Instance-Id"),
        "observed_request_id": header(identity_header),
    }


def _refuse_encoding(headers) -> str:
    """The templates never compress a response, so an encoding we would have to decode is refused by name.

    Decompressing and then hashing the result would report bytes that never existed on the wire.
    """
    encoding = ((headers.get("Content-Encoding") if headers is not None else None) or "").strip().lower()
    if encoding not in SUPPORTED_CONTENT_ENCODINGS:
        raise ProbeError("CONTENT_ENCODING_UNSUPPORTED", encoding)
    return encoding


def execute_request(payload: dict) -> tuple[dict, bytes]:
    """Perform the single request the parent already authorized. Only the private worker calls this.

    `ProxyHandler({})` is the reason this exists separately from the parent: `build_opener` otherwise installs
    the default proxy handler, which discovers `http_proxy`/`https_proxy` and the system proxy configuration
    and would send the declared request - with any proxy credential the environment names - to an address no
    declaration ever mentioned. The budget is the one the parent computed from its monotonic clock, so the
    socket timeout and every read get what is left of it, never a fresh copy.
    """
    max_bytes = payload["max_response_bytes"]
    deadline = time.monotonic() + payload["budget_ms"] / 1000.0
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _RejectRedirects())
    request = urllib.request.Request(payload["url"], method=payload["method"])
    for name, value in payload["headers"]:
        request.add_header(name, value)
    try:
        with opener.open(request, timeout=max(0.001, deadline - time.monotonic())) as response:
            _refuse_encoding(response.headers)
            body = _read_bounded(response, max_bytes, deadline)
            facts = _headers_of(response.headers, IDENTITY_HEADER)
            status = int(response.status)
    except urllib.error.HTTPError as error:
        if error.code in (301, 302, 303, 307, 308):
            raise ProbeError("REDIRECT_REFUSED", str(error.code)) from error
        _refuse_encoding(error.headers)
        body = _read_bounded(error, max_bytes, deadline)
        facts = _headers_of(error.headers, IDENTITY_HEADER)
        status = int(error.code)
    except urllib.error.URLError as error:
        # A route that was refused and a route that ran out of budget are different failures; the default
        # proxy used to hide the second inside the first.
        if isinstance(getattr(error, "reason", None), (socket.timeout, TimeoutError)):
            raise ProbeError("DEADLINE_EXCEEDED", str(payload["budget_ms"])) from error
        raise ProbeError("CONNECT_FAILED", str(error.reason)) from error
    except socket.timeout as error:
        raise ProbeError("DEADLINE_EXCEEDED", str(payload["budget_ms"])) from error
    metadata = {
        "ok": True,
        "status_code": status,
        "media_type": facts["media_type"],
        "instance_id": facts["instance_id"],
        "observed_request_id": facts["observed_request_id"],
        # What this process actually handed to the opener. The parent compares it with the URL it authorized
        # before spawning, so a worker that drifted to another route is a failure rather than a fact.
        "request_target": request.full_url,
        "response_digest": "sha256:" + hashlib.sha256(body).hexdigest(),
        # The reader identifies itself: the parent compares this pid with the handle it is allowed to
        # terminate, so "we killed the process that was reading" is a checked fact and not a guess about
        # whether this interpreter re-executed into some other process. The projection says the same thing
        # about imports and privileges: variable names only, never their values.
        "reader_pid": os.getpid(),
    }
    metadata.update(_env_projection())
    return metadata, body



# --- JSON Pointer, own-field and finite-number semantics -----------------------------------------------
# This block is the Python half of one contract, described in
# `tests/fixtures/v2-regressions/assertions.json` and enforced case by case in
# `tests/contract/probe-assertions-parity.test.ts`. It mirrors `packages/core/src/services/probe-assertions.ts`:
# same grammar, same reason codes, same refusals. A dict has no inherited members to trip over, but the pointer
# grammar, the finite-number rule and the reason codes used to differ, and a probe that disagrees with the core
# about what a response contains is worse than a probe that fails.

CANONICAL_INDEX = re.compile(r"^(?:0|[1-9][0-9]*)$")
MAX_JSON_DEPTH = 64
MAX_JSON_BYTES = MAX_RESPONSE_BYTES
# Integers above this are rounded by JavaScript and kept exactly by Python, so the same bytes would give two
# documents. Refusing is the only answer that does not pick a winner.
MAX_LOSSLESS_INTEGER = 2 ** 53 - 1
# `parse_json_response` refusals, identical to `JsonResponseReason` in TypeScript.
JSON_REFUSAL_CODES = ("RESPONSE_BODY_OVER_BUDGET", "RESPONSE_BODY_NOT_UTF8", "RESPONSE_BODY_NOT_JSON",
                      "JSON_DUPLICATE_KEY", "JSON_NESTING_OVER_LIMIT", "JSON_NUMBER_NOT_FINITE",
                      "JSON_NUMBER_NOT_LOSSLESS")
POINTER_REASONS = ("POINTER_INVALID", "POINTER_ESCAPE_INVALID", "POINTER_INDEX_INVALID", "POINTER_NOT_FOUND")
TYPE_KINDS = ("string", "number", "boolean", "null")


def parse_pointer(pointer):
    """Split an RFC 6901 pointer into its decoded tokens, or refuse it by name.

    Two decisions are made here and nowhere else: the whole-document pointer `""` is not accepted, because a
    declaration pointer has to start with `/`, and an empty segment is the empty key, so `/` addresses `""` and
    `//x` addresses `""` then `x`. A `~` that is not `~0` or `~1` is refused before any token reaches the
    document - a malformed pointer is never evaluated as if it were a key.
    """
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise ProbeError("POINTER_INVALID", str(pointer))
    tokens = []
    for segment in pointer[1:].split("/"):
        token = ""
        index = 0
        while index < len(segment):
            character = segment[index]
            if character != "~":
                token += character
                index += 1
                continue
            escape = segment[index + 1] if index + 1 < len(segment) else ""
            if escape == "0":
                token += "~"
                index += 2
                continue
            if escape == "1":
                token += "/"
                index += 2
                continue
            raise ProbeError("POINTER_ESCAPE_INVALID", pointer)
        tokens.append(token)
    return tokens


def _resolve_tokens(document, tokens):
    """Own members only. Returns (found, value), or raises for a pointer the document cannot be indexed by."""
    current = document
    for token in tokens:
        if isinstance(current, list):
            # An array position is canonical decimal only: `01` and `-` are malformed, while a canonical index
            # past the end is simply absent. Against an object the same token is a key, so the key "01" reads.
            if not CANONICAL_INDEX.match(token):
                raise ProbeError("POINTER_INDEX_INVALID", token)
            index = int(token)
            if index >= len(current):
                return False, None
            current = current[index]
            continue
        if isinstance(current, dict):
            if token not in current:
                return False, None
            current = current[token]
            continue
        return False, None
    return True, current


def resolve_pointer(document, pointer: str):
    """RFC 6901 resolution. Returns (found, value). A malformed pointer raises `ProbeError` with its reason."""
    return _resolve_tokens(document, parse_pointer(pointer))


def _json_type(value) -> str:
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
    return "unsupported"


def _is_scalar(value) -> bool:
    return _json_type(value) in ("null", "boolean", "number", "string")


def _is_finite_number(value) -> bool:
    """A bool is never a number and a non-finite float never is either; a string is never converted."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    # `math.isfinite` on a huge int would raise OverflowError; an int is always finite here.
    return True if isinstance(value, int) else math.isfinite(value)


def assertion_outcome(document, assertion: dict) -> dict:
    """The same deterministic evaluation the core performs, with the same reason codes.

    Restricted: no expression, no user code, no model judgement. A missing path and a malformed pointer are
    reported differently, because "the response does not have it" and "the assertion cannot be read" are not
    the same finding.
    """
    assertion_id = assertion.get("assertion_id")
    operator = assertion.get("operator")
    expected = assertion.get("expected")
    try:
        found, value = resolve_pointer(document, assertion["pointer"])
    except ProbeError as error:
        if error.code in POINTER_REASONS:
            return {"assertion_id": assertion_id, "passed": False, "reason": error.code}
        raise
    if operator == "exists":
        return {"assertion_id": assertion_id, "passed": found,
                "reason": None if found else "POINTER_NOT_FOUND"}
    if not found:
        return {"assertion_id": assertion_id, "passed": False, "reason": "POINTER_NOT_FOUND"}
    if operator == "type":
        # The kind has to be named as one of the four strings. A missing `expected`, a JSON null or a number is
        # not the `null` kind: it is an unusable assertion.
        if not isinstance(expected, str) or expected not in TYPE_KINDS:
            return {"assertion_id": assertion_id, "passed": False, "reason": "TYPE_EXPECTED_UNKNOWN"}
        passed = _json_type(value) == expected if expected != "number" else _is_finite_number(value)
        return {"assertion_id": assertion_id, "passed": bool(passed),
                "reason": None if passed else "TYPE_MISMATCH"}
    if operator == "equals":
        # One JSON type only, scalars only: 0 never equals false, null never equals false, and an array or
        # object is not declarable and is not compared structurally.
        passed = (_is_scalar(value) and _is_scalar(expected) and _json_type(value) == _json_type(expected)
                  and value == expected)
        return {"assertion_id": assertion_id, "passed": bool(passed),
                "reason": None if passed else "VALUE_MISMATCH"}
    comparisons = {"number_lt": lambda a, b: a < b, "number_lte": lambda a, b: a <= b,
                   "number_gt": lambda a, b: a > b, "number_gte": lambda a, b: a >= b}
    compare = comparisons.get(operator)
    if compare is None:
        return {"assertion_id": assertion_id, "passed": False, "reason": "OPERATOR_UNSUPPORTED"}
    if not _is_finite_number(value) or not _is_finite_number(expected):
        return {"assertion_id": assertion_id, "passed": False, "reason": "NUMBER_OPERAND_REQUIRED"}
    passed = bool(compare(value, expected))
    return {"assertion_id": assertion_id, "passed": passed,
            "reason": None if passed else "NUMBER_COMPARISON_FAILED"}


def evaluate_assertion(document, assertion: dict) -> bool:
    """The boolean answer `assertion_outcome` gives, kept as the public shape the sample probe already calls."""
    return bool(assertion_outcome(document, assertion)["passed"])


def _refuse_constant(name: str) -> float:
    """`NaN`, `Infinity` and `-Infinity` are not JSON literals; json.loads is lenient about them by default."""
    raise ProbeError("RESPONSE_BODY_NOT_JSON", name)


def _unique_pairs(pairs):
    """Repeated member names are refused, the way the repository's strict document boundary refuses them."""
    seen = set()
    for key, value in pairs:
        if key in seen:
            raise ProbeError("JSON_DUPLICATE_KEY", key)
        seen.add(key)
    return dict(pairs)


def find_refused_number(value, max_depth: int = MAX_JSON_DEPTH):
    """The first number in `value` the two languages cannot agree about, or None. See the TypeScript twin."""
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if depth > max_depth:
            return "JSON_NESTING_OVER_LIMIT"
        kind = _json_type(item)
        if kind in ("array", "object"):
            children = item if kind == "array" else list(item.values())
            for child in children:
                stack.append((child, depth + 1))
            continue
        if kind != "number" or isinstance(item, bool):
            continue
        if isinstance(item, float) and not math.isfinite(item):
            return "JSON_NUMBER_NOT_FINITE"
        if abs(item) > MAX_LOSSLESS_INTEGER:
            return "JSON_NUMBER_NOT_LOSSLESS"
    return None


def parse_json_response(data, *, max_bytes: int = MAX_JSON_BYTES, max_depth: int = MAX_JSON_DEPTH):
    """Read one response body as JSON, strictly and within bounds. Raises `ProbeError` with the refusal code.

    The byte budget and the UTF-8 decode say what the transport gave. `json.loads` decides the JSON grammar,
    with `parse_constant` closing the one leniency Python's decoder has that JSON does not have, and
    `object_pairs_hook` closing the other: repeated member names, which a plain decode would silently resolve to
    the last value. `find_refused_number` then refuses any number that is not finite or not exactly
    representable, so `1e400` cannot arrive as an infinity. A JSON `null`, scalar or array root parses: that is
    a fact about the body, never "not JSON".
    """
    raw = bytes(data)
    if len(raw) > max_bytes:
        raise ProbeError("RESPONSE_BODY_OVER_BUDGET", "%d of %d bytes" % (len(raw), max_bytes))
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ProbeError("RESPONSE_BODY_NOT_UTF8", str(error)) from error
    try:
        value = json.loads(text, parse_constant=_refuse_constant, object_pairs_hook=_unique_pairs)
    except RecursionError as error:
        raise ProbeError("JSON_NESTING_OVER_LIMIT", str(error)) from error
    except json.JSONDecodeError as error:
        raise ProbeError("RESPONSE_BODY_NOT_JSON", error.msg) from error
    refusal = find_refused_number(value, max_depth)
    if refusal:
        raise ProbeError(refusal, text[:80])
    return value


def _commit(path: str, data: bytes) -> None:
    """Put `data` at `path` without ever replacing bytes that are already there.

    The partial file is flushed and synced, then linked into place: `os.link` fails with `FileExistsError` when
    the target exists, which is the exclusive commit an evidence chain needs. A filesystem without hard links
    falls back to an exclusive create - the no-replace rule survives there, only the atomicity does not.
    """
    directory = os.path.dirname(path)
    try:
        if directory:
            os.makedirs(directory, exist_ok=True)
    except OSError as error:
        # The artifact root could not be resolved at all - a parent that is a file, an unmapped drive. That is
        # a storage failure, distinct from a launch parameter that was never usable in the first place.
        raise ProbeError("ARTIFACT_COMMIT_FAILED", "%s: %s" % (path, error)) from error
    temporary = "%s.partial.%d" % (path, os.getpid())
    try:
        with open(temporary, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
            return
        except FileExistsError as error:
            raise ProbeError("ARTIFACT_EXISTS", path) from error
        except OSError as error:
            # ERROR_FILE_EXISTS (80) is the other way a volume reports the same rule. Anything else - a
            # filesystem with no hard links at all - falls through to the exclusive create below.
            if getattr(error, "winerror", None) == 80:
                raise ProbeError("ARTIFACT_EXISTS", path) from error
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        except FileExistsError as error:
            raise ProbeError("ARTIFACT_EXISTS", path) from error
        except OSError as error:
            raise ProbeError("ARTIFACT_COMMIT_FAILED", "%s: %s" % (path, error)) from error
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except ProbeError:
        raise
    except OSError as error:
        raise ProbeError("ARTIFACT_COMMIT_FAILED", "%s: %s" % (path, error)) from error
    finally:
        try:
            os.unlink(temporary)
        except OSError:
            pass


def write_bytes(path: str, data: bytes) -> None:
    """Record raw response bytes as they arrived; a previous attempt's file is never replaced."""
    _commit(path, bytes(data))


def write_json(path: str, value) -> None:
    """Commit one diagnostic document exclusively, preserving any bytes an earlier attempt left behind."""
    encoded = (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    _commit(path, encoded)

