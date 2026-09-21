"""Export this application's own OpenAPI document into the current attempt directory.

The runner injects STACKGATE_OUTPUT_DIR pointing at a fresh directory owned by one run/check/attempt.
The export executes application code, so it only runs under an authorized command; it never searches the
repository for a previous contract, never creates its output directory and never replaces bytes that are
already there.
"""

import json
import os
import sys
from pathlib import Path

ARTIFACT_NAME = "candidate-openapi.json"
USAGE_EXIT = 64
TOOL_EXIT = 3


def fail(message: str, code: int) -> int:
    print(f"export_openapi: {message}", file=sys.stderr)
    return code


def resolve_output() -> Path:
    raw = os.environ.get("STACKGATE_OUTPUT_DIR", "").strip()
    if not raw:
        raise ValueError("STACKGATE_OUTPUT_DIR is not set; the export needs this attempt's output directory")
    if not os.path.isabs(raw):
        raise ValueError("STACKGATE_OUTPUT_DIR must be an absolute path")
    directory = Path(raw)
    if directory.is_symlink():
        raise ValueError("STACKGATE_OUTPUT_DIR must not be a link")
    if not directory.is_dir():
        raise ValueError("STACKGATE_OUTPUT_DIR must be an existing directory created by the runner")
    return directory


def main() -> int:
    try:
        directory = resolve_output()
    except ValueError as error:
        return fail(str(error), USAGE_EXIT)
    destination = directory / ARTIFACT_NAME
    if destination.exists():
        return fail("candidate contract already exists for this attempt; refusing to overwrite evidence", USAGE_EXIT)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    try:
        from app.main import app

        payload = json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        json.loads(payload)
    except Exception as error:  # any import or export failure must surface, never look compatible
        return fail(f"application contract export failed: {type(error).__name__}: {error}", TOOL_EXIT)
    with destination.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)
    print(ARTIFACT_NAME)
    return 0


if __name__ == "__main__":
    sys.exit(main())
