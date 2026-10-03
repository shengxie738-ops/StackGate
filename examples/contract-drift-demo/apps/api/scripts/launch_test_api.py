"""Test-only launcher: the demo API wrapped in the StackGate observation middleware.

This is the only place the middleware is installed. `app.main:create_app` stays observation-free, so a normal
`python -m uvicorn app.main:app` run neither records anything nor gains a route that reads evidence back. The
launcher owns everything the app is handed:

* the state directory (created here, under the caller's explicit absolute path, observations beneath it);
* `instance_id` and `data_revision`, minted from `uuid4` at process start - they are never read from the
  request, an argument or an environment variable;
* the loopback socket: the bind address is the literal `127.0.0.1`, and the port is the one the OS gave the
  socket this process opened.

It then writes one start record - pid, process creation identity, input hash, instance, data revision, origin,
the watched operations and the routes actually served - and commits it exclusively, so a second launcher in
the same state directory is a conflict rather than an overwrite.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import sys
import time
import uuid
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
PRESET_SCRIPTS = API_ROOT.parents[3] / "presets" / "fastapi-react" / "scripts"
for entry in (str(API_ROOT), str(PRESET_SCRIPTS)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import probe_helpers as helpers  # noqa: E402
import stackgate_observation as observation  # noqa: E402

USAGE_EXIT = 64
TOOL_EXIT = 3
STATE_DIRECTORY = "STACKGATE_STATE_DIR"
ALLOWED_RUN_IDS = "STACKGATE_ALLOWED_RUN_IDS"
INPUT_HASH = "STACKGATE_INPUT_HASH"
START_RECORD = "launcher.json"
OBSERVATION_ROOT = "observations"
LOOPBACK_HOST = "127.0.0.1"


class LaunchError(Exception):
    pass


def fail(message: str) -> int:
    print("launch_test_api: %s" % message, file=sys.stderr)
    return USAGE_EXIT


def _hex64(value: str):
    return value if len(value) == 64 and value == value.lower() and all(c in "0123456789abcdef" for c in value) else None


def mint_instance() -> str:
    return "instance_%s" % uuid.uuid4().hex[:16]


def mint_revision() -> str:
    return "revision_%s" % uuid.uuid4().hex[:16]


def read_configuration(env: dict) -> dict:
    """Every launch parameter is explicit, absolute and loopback-only, or the launcher refuses to exist."""
    raw_directory = (env.get(STATE_DIRECTORY) or "").strip()
    if not raw_directory:
        raise LaunchError("%s is required: the launcher owns the state directory it hands to the app"
                          % STATE_DIRECTORY)
    if not os.path.isabs(raw_directory):
        raise LaunchError("%s must be an absolute path" % STATE_DIRECTORY)

    raw_runs = [item for item in (env.get(ALLOWED_RUN_IDS) or "").split(",") if item.strip()]
    if not raw_runs:
        raise LaunchError("%s must name at least one run identifier explicitly" % ALLOWED_RUN_IDS)
    runs = [item.strip() for item in raw_runs]
    for run_id in runs:
        if not observation.RUN_ID.match(run_id):
            raise LaunchError("%s must be a comma-separated list of run identifiers, got %r"
                              % (ALLOWED_RUN_IDS, run_id))

    input_hash = _hex64((env.get(INPUT_HASH) or "").strip())
    if input_hash is None:
        raise LaunchError("%s must be the bare 64 hex digest of the confirmed candidate input" % INPUT_HASH)

    return {"state_directory": raw_directory, "allowed_run_ids": runs, "input_hash": input_hash}


def source_digests() -> dict:
    """The bytes this process actually loaded, so the start record binds an input the reader can re-hash."""
    watched = {
        "scripts/launch_test_api.py": Path(__file__).resolve(),
        "app/main.py": API_ROOT / "app" / "main.py",
        "app/models.py": API_ROOT / "app" / "models.py",
        "presets/fastapi-react/scripts/stackgate_observation.py": PRESET_SCRIPTS / "stackgate_observation.py",
        "presets/fastapi-react/scripts/probe_helpers.py": PRESET_SCRIPTS / "probe_helpers.py",
    }
    digests = {}
    for name, path in watched.items():
        try:
            digests[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as error:
            raise LaunchError("launch input %s could not be read: %s" % (name, error)) from error
    return digests


def process_creation_identity() -> dict:
    """How old this process is, measured by the operating system, not by a clock we could have set.

    Windows answers from `kernel32.GetProcessTimes` on the current-process handle; Linux from
    `/proc/self/stat`. Anything else is reported as unsupported instead of being dressed up with the launch
    wall clock, which a reader could not distinguish from a forged timestamp.
    """
    fact = {"pid": os.getpid(), "status": "unsupported", "mechanism": None,
            "creation_identity": None, "created_at": None, "clock": None}
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            creation = wintypes.FILETIME()
            exit_time = wintypes.FILETIME()
            kernel = wintypes.FILETIME()
            user = wintypes.FILETIME()
            handle = kernel32.GetCurrentProcess()
            ok = kernel32.GetProcessTimes(ctypes.c_void_p(handle), ctypes.byref(creation),
                                          ctypes.byref(exit_time), ctypes.byref(kernel), ctypes.byref(user))
            if ok:
                ticks = (creation.dwHighDateTime << 32) | creation.dwLowDateTime
                # FILETIME counts 100 ns intervals since 1601-01-01; 11644473600 s is the Unix epoch offset.
                seconds = ticks / 1e7 - 11644473600.0
                fact.update({"status": "observed", "mechanism": "kernel32.GetProcessTimes on the current process",
                             "creation_identity": str(ticks), "created_at": _utc(seconds),
                             "clock": "100 ns intervals since 1601-01-01"})
        except Exception as error:  # a platform that will not say is a fact, not a reason to guess
            fact["error"] = type(error).__name__
        return fact
    if sys.platform.startswith("linux"):
        try:
            fields = Path("/proc/self/stat").read_text(encoding="utf-8").rsplit(")", 1)[1].split()
            ticks = int(fields[19])
            clock_ticks = os.sysconf("SC_CLK_TCK")
            boot = 0.0
            for line in Path("/proc/stat").read_text(encoding="utf-8").splitlines():
                if line.startswith("btime "):
                    boot = float(line.split()[1])
            seconds = boot + ticks / clock_ticks
            fact.update({"status": "observed", "mechanism": "/proc/self/stat starttime with /proc/stat btime",
                         "creation_identity": str(ticks), "created_at": _utc(seconds),
                         "clock": "scheduler ticks since boot, resolved against btime"})
        except (OSError, IndexError, ValueError) as error:
            fact["error"] = type(error).__name__
        return fact
    return fact


def _utc(value: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(value)) + ".%03dZ" % int(value * 1000 % 1000)


def prepare_state_directory(state_directory: str) -> Path:
    """Create the state root and the observation root this launcher owns; never reuse someone else's."""
    root = Path(state_directory)
    if root.exists():
        if not root.is_dir() or root.is_symlink():
            raise LaunchError("state directory %s is not a directory this process can own" % root)
        if any(root.iterdir()):
            existing = (root / START_RECORD).exists()
            raise LaunchError("state directory %s is not empty%s"
                              % (root, "; a launcher record from another process is already there" if existing else ""))
    else:
        os.mkdir(root)
    observations = root / OBSERVATION_ROOT
    os.mkdir(observations)
    return root


def served_routes(app) -> list[str]:
    """What this process will answer, read from the route table rather than asserted."""
    return sorted({getattr(route, "path", "") for route in app.routes if getattr(route, "path", "")})


def build_app(root: Path, config: dict, instance_id: str, data_revision: str) -> tuple[object, dict]:
    from app.main import create_app  # the demo's real application, wrapped, never copied

    inner = create_app()
    wrapped = observation.StackGateObservationMiddleware(
        inner, directory=str(root / OBSERVATION_ROOT), instance_id=instance_id,
        allowed_run_ids=config["allowed_run_ids"], data_revision=data_revision,
        operations=observation.OBSERVED_OPERATIONS, max_recorded_bytes=observation.MAX_RECORDED_BYTES)
    return wrapped, {"served_routes": served_routes(inner),
                    "observed_operations": [dict(entry) for entry in observation.OBSERVED_OPERATIONS]}


def open_loopback_socket(port: int) -> tuple[socket.socket, int]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((LOOPBACK_HOST, port))
    sock.listen(128)
    return sock, sock.getsockname()[1]


def start_record(config: dict, instance_id: str, data_revision: str, root: Path, port: int,
                 facts: dict, creation: dict) -> dict:
    return {
        "schema_version": "0.1",
        "kind": "stackgate-test-api-launch",
        "phase": "started",
        "pid": os.getpid(),
        "process_creation": creation,
        # The identity the observation records will carry, minted here and nowhere else.
        "instance_id": instance_id,
        "data_revision": data_revision,
        "input_hash": config["input_hash"],
        "allowed_run_ids": list(config["allowed_run_ids"]),
        "host": LOOPBACK_HOST,
        "port": port,
        "origin": "http://%s:%d" % (LOOPBACK_HOST, port),
        "state_directory": str(root),
        "observation_directory": OBSERVATION_ROOT,
        "observed_operations": facts["observed_operations"],
        "served_routes": facts["served_routes"],
        # A public evidence-reading route would be a route serving these files; the route table says there is
        # none, and this field is that observed fact rather than a promise.
        "evidence_routes": [path for path in facts["served_routes"]
                            if any(word in path.lower() for word in ("observ", "evidence", "record"))],
        "source_digests": config["source_digests"],
        "started_at": _utc(time.time()),
        "reaped_by": "the process handle the caller created; this launcher only ever stops itself",
        "max_recorded_bytes": observation.MAX_RECORDED_BYTES,
    }


def main(argv: list[str] | None = None, env: dict | None = None) -> int:
    parser = argparse.ArgumentParser(prog="launch_test_api.py",
                                     description="test-only, loopback-only API launcher with observation")
    parser.add_argument("--port", type=int, default=0, help="0 asks the operating system for a free port")
    parser.add_argument("--host", default=LOOPBACK_HOST, help="fixed: this launcher only ever binds 127.0.0.1")
    arguments = parser.parse_args(argv)
    environment = dict(os.environ if env is None else env)
    if arguments.host != LOOPBACK_HOST:
        # The bind address is not a caller preference: a public test API would publish synthetic evidence
        # about a service nobody authorized.
        return fail("--host must be %s; this launcher never binds a public interface" % LOOPBACK_HOST)
    if arguments.port < 0 or arguments.port > 65535:
        return fail("--port must be 0 (ask the OS) or a number between 1 and 65535")
    try:
        config = read_configuration(environment)
        config["source_digests"] = source_digests()
        root = prepare_state_directory(config["state_directory"])
    except LaunchError as error:
        return fail(str(error))

    instance_id = mint_instance()
    data_revision = mint_revision()
    creation = process_creation_identity()
    sock, port = open_loopback_socket(arguments.port)
    try:
        app, facts = build_app(root, config, instance_id, data_revision)
    except Exception as error:
        sock.close()
        print("launch_test_api: application could not be wrapped: %s: %s"
              % (type(error).__name__, error), file=sys.stderr)
        return TOOL_EXIT
    record = start_record(config, instance_id, data_revision, root, port, facts, creation)
    try:
        helpers.write_json(os.path.join(str(root), START_RECORD), record)
    except helpers.ProbeError as error:
        sock.close()
        print("launch_test_api: start record could not be committed: %s" % error, file=sys.stderr)
        return TOOL_EXIT
    # The ready line is what a caller waits for: it carries the port the OS gave and the record the caller
    # authenticates against, so nothing here has to be guessed from a log line.
    print(json.dumps({"status": "ready", "pid": os.getpid(), "origin": record["origin"],
                      "port": port, "instance_id": instance_id, "data_revision": data_revision,
                      "start_record": os.path.join(str(root), START_RECORD).replace("\\", "/"),
                      "creation_identity_status": creation["status"]}, separators=(",", ":")), flush=True)
    try:
        import uvicorn

        server = uvicorn.Server(uvicorn.Config(app, host=LOOPBACK_HOST, port=port, log_level="warning",
                                               access_log=False, lifespan="on"))
        server.run(sockets=[sock])
    except Exception as error:  # a server that cannot start must not look like a clean exit
        print("launch_test_api: server failed: %s: %s" % (type(error).__name__, error), file=sys.stderr)
        return TOOL_EXIT
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
