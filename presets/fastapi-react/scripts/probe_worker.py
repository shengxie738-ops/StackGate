"""Private one-request worker for the StackGate probe helper.

Started only by `probe_helpers.perform_request`, with `-B -E` and a filtered environment, and expected to be
terminated by that parent. The contract is deliberately narrow:

  * read one length-capped frame from stdin describing the single request the parent already authorized;
  * refuse a work order that does not describe exactly that request, before anything reaches the network;
  * drop everything the surrounding environment could still mean, then perform exactly one request with no
    proxy discovery and no credential taken from the environment;
  * answer with exactly one length-capped frame on stdout: bounded metadata plus the response body bytes;
  * write no artifact, open no other connection, and read nothing that could name a user or a secret.

The parent owns the absolute monotonic deadline. Being a separate process is what makes that deadline
enforceable instead of merely observed: a blocking read inside this process cannot be cancelled from inside
it, so the parent closes the pipes, terminates the handle it created and waits for the exit status.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import probe_helpers as helpers  # noqa: E402


def request_worker(request: dict, record: dict) -> tuple[dict, bytes]:
    """One request, one bounded answer. The behaviour itself stays in the shared helper."""
    return helpers.run_privileged(request, record)


def _checked(payload: dict) -> dict:
    """Rebuild the request from its parts and refuse anything that does not describe exactly one job.

    Type and bound checks plus the transport rules the parent applied: the URL has to be the authorized origin
    with the declared literal path, on a loopback http/https origin, with no userinfo and no ambiguity. This
    process has no policy of its own and no ability to widen one - it can only decline a work order that does
    not already satisfy the rules, which is what stops it being used as a general URL fetcher. Authorization
    itself happened in the parent before this process existed.
    """
    if not isinstance(payload, dict):
        raise helpers.ProbeError("WORKER_PROTOCOL_ERROR", "payload is not an object")
    url = payload.get("url")
    origin = payload.get("origin")
    path = payload.get("path")
    method = payload.get("method")
    headers = payload.get("headers")
    max_bytes = payload.get("max_response_bytes")
    budget_ms = payload.get("budget_ms")
    # Shape first: a work order with a field missing or of the wrong type is a broken frame, while an origin
    # that parses but is not this preset's local service is an authorization refusal. Those are different
    # classifications and the reader should be able to tell them apart.
    for name, field in (("url", url), ("origin", origin), ("path", path), ("method", method)):
        if not isinstance(field, str) or not field:
            raise helpers.ProbeError("WORKER_PROTOCOL_ERROR", name)
    if not isinstance(headers, list) or any(
            not isinstance(pair, list) or len(pair) != 2 or not all(isinstance(item, str) for item in pair)
            for pair in headers):
        raise helpers.ProbeError("WORKER_PROTOCOL_ERROR", "headers")
    if not helpers.is_positive_safe_integer(max_bytes, helpers.MAX_RESPONSE_BYTES):
        raise helpers.ProbeError("WORKER_PROTOCOL_ERROR", "max_response_bytes")
    if not helpers.is_positive_safe_integer(budget_ms, 60000):
        raise helpers.ProbeError("WORKER_PROTOCOL_ERROR", "budget_ms")
    normalized, reason = helpers.normalize_origin(origin)
    if reason:
        raise helpers.ProbeError("WORKER_ORIGIN_UNAUTHORIZED", "%s %s" % (reason, origin))
    if not normalized["loopback"]:
        # The preset probes the service it started on this machine; a route off loopback is not this
        # process's to take, whatever a hand-written frame asks for.
        raise helpers.ProbeError("WORKER_ORIGIN_UNAUTHORIZED", "not loopback: %s" % normalized["origin"])
    if method not in helpers.METHODS:
        raise helpers.ProbeError("WORKER_PROTOCOL_ERROR", "method")
    violation = helpers.path_rule_violation(path)
    if violation:
        raise helpers.ProbeError("WORKER_PATH_RULE", "%s %s" % (violation, path))
    if url not in (normalized["origin"] + path, "%s%s" % (origin, path)):
        raise helpers.ProbeError("WORKER_URL_ESCAPE", "%s is not %s + %s" % (url, normalized["origin"], path))
    return {"url": url, "method": method, "headers": headers,
            "max_response_bytes": max_bytes, "budget_ms": budget_ms}


def _emit(metadata: dict, body: bytes = b"", max_body: int = helpers.MAX_RESPONSE_BYTES) -> None:
    """Answer with exactly one frame; the exit code says what kind of answer it was."""
    sys.stdout.buffer.write(helpers.frame(metadata, body, max_body=max_body))
    sys.stdout.buffer.flush()


def main() -> int:
    record: dict = {}
    # One extra byte over the cap is read on purpose: it turns "too large" into a refusal instead of a
    # silently truncated request or an unbounded buffer.
    data = sys.stdin.buffer.read(helpers.MAX_REQUEST_FRAME_BYTES + 1)
    if len(data) > helpers.MAX_REQUEST_FRAME_BYTES:
        _emit({"ok": False, "code": "WORKER_REJECTED", "detail": "request frame over cap", "neutralized": record})
        return 64
    try:
        payload, _unused = helpers.unframe(data, max_body=0, label="parent")
        request = _checked(payload)
    except helpers.ProbeError as error:
        # A work order this process cannot account for is a configuration error: exit 64, and nothing was sent.
        _emit({"ok": False, "code": error.code, "detail": error.detail, "neutralized": record})
        return 64
    try:
        metadata, body = request_worker(request, record)
    except helpers.ProbeError as error:
        _emit({"ok": False, "code": error.code, "detail": error.detail, "neutralized": record})
        return 2
    except Exception as error:  # a crash still has to be an answer, never silence the parent must interpret
        _emit({"ok": False, "code": "WORKER_CRASHED", "detail": "%s: %s" % (type(error).__name__, error),
               "neutralized": record})
        return 3
    _emit(dict(metadata, neutralized=record), body, max_body=request["max_response_bytes"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
