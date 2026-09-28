"""Reproduce V2-F05 (total deadline and implicit proxy) against either the committed or the working copy.

One script, two sources, so the RED and the GREEN come from the same code path:

    python tests/support/v2_f05_reverify.py head       # the bytes recorded as the audit baseline
    python tests/support/v2_f05_reverify.py worktree   # the files as they stand now

Exit code 1 means the defect is still observable, which is what `head` must report. Only loopback sockets
are used, and proxy variables are set in this process only and removed again; nothing here reads or edits
the user's own proxy configuration. The working-tree mode imports the helper from its real directory so
the private worker script resolves exactly the way the product entry point resolves it.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BODY = json.dumps({"data": {"performance": {"total_return": 0.1234, "period": "2026-Q3"},
                            "padding": "v2r03slowdrip" * 40}}).encode() + b"\n"
IDENTITY = {"run_id": "run_v2r03_reverify", "check_id": "runtime_probe",
            "attempt_id": "attempt_v2r03_reverify_1", "request_id": "request_v2r03_reverify_1"}
COMMITTED_REV = "51fc0cc"


def load_helper(mode: str, staging: Path):
    if mode == "worktree":
        sys.path.insert(0, str(REPO / "presets" / "fastapi-react" / "scripts"))
        import probe_helpers as helpers
        return helpers
    if mode != "head":
        raise SystemExit("usage: python tests/support/v2_f05_reverify.py head|worktree")
    source = subprocess.run(["git", "-C", str(REPO), "show",
                             f"{COMMITTED_REV}:presets/fastapi-react/scripts/probe_helpers.py"],
                            capture_output=True, check=True).stdout
    target = staging / "probe_helpers_head.py"
    target.write_bytes(source)
    sys.path.insert(0, str(staging))
    import probe_helpers_head as head_helpers  # noqa: E402
    return head_helpers


def serve(handler):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(4)
    hits: list[str] = []

    def loop():
        while True:
            try:
                conn, _ = sock.accept()
            except OSError:
                return
            threading.Thread(target=lambda: handler(conn, hits), daemon=True).start()
    threading.Thread(target=loop, daemon=True).start()
    return sock, f"http://127.0.0.1:{sock.getsockname()[1]}", hits


def drip(conn, hits):
    with conn:
        hits.append(conn.recv(65536).split(b"\r\n")[0].decode(errors="replace"))
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n")
        for byte in BODY:
            try:
                conn.sendall(bytes([byte]))
            except OSError:
                return
            time.sleep(0.02)


def respond(conn, hits):
    with conn:
        hits.append(conn.recv(65536).split(b"\r\n")[0].decode(errors="replace"))
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n" % len(BODY))
        conn.sendall(BODY)


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) == 2 else ""
    if mode not in ("head", "worktree"):
        print("usage: python tests/support/v2_f05_reverify.py head|worktree", file=sys.stderr)
        return 64
    staging = Path(tempfile.mkdtemp(prefix="stackgate-v2f05-"))
    helpers = load_helper(mode, staging)
    failures: list[str] = []

    target_sock, target, target_hits = serve(drip)
    started = time.monotonic()
    try:
        record = helpers.perform_request(origin=target, operation_key="api:GET /api/performance",
                                         allowed_origins=[target], identity=IDENTITY, deadline_ms=100)
        elapsed = time.monotonic() - started
        print(f"[{mode}] drip: completed after {elapsed * 1000:.1f} ms on a 100 ms deadline "
              f"(status={record['status_code']}, bytes={len(record['body'])})")
        failures.append("TOTAL_DEADLINE_NOT_ABSOLUTE")
    except helpers.ProbeError as error:
        elapsed = time.monotonic() - started
        print(f"[{mode}] drip: refused after {elapsed * 1000:.1f} ms with {error.code}")
        if mode == "worktree":
            if error.code != "DEADLINE_EXCEEDED":
                failures.append("UNEXPECTED_CODE:" + error.code)
            if elapsed > 2.0:
                failures.append("REFUSAL_NOT_BOUNDED")
    target_sock.close()

    proxy_sock, proxy, proxy_hits = serve(respond)
    second_sock, second, second_hits = serve(respond)
    os.environ["http_proxy"] = proxy
    os.environ["https_proxy"] = proxy
    try:
        helpers.perform_request(origin=second, operation_key="api:GET /api/performance",
                                allowed_origins=[second], identity=IDENTITY, deadline_ms=2000)
    except helpers.ProbeError as error:
        print(f"[{mode}] proxy: refused with {error.code}")
    finally:
        del os.environ["http_proxy"]
        del os.environ["https_proxy"]
    print(f"[{mode}] proxy: authorized target hits={len(second_hits)} unapproved proxy hits={len(proxy_hits)}")
    if proxy_hits:
        failures.append("IMPLICIT_PROXY_CHANGED_ROUTE")
    if len(second_hits) != 1:
        failures.append("AUTHORIZED_TARGET_NOT_USED")
    second_sock.close()
    proxy_sock.close()

    verdict = ",".join(failures) if failures else "none"
    print(f"V2F05_STILL_PRESENT={verdict}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
