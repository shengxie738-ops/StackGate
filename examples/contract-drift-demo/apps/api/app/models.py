"""Synthetic response models for the StackGate contract-drift demo.

The single business field mirrors tests/fixtures/contracts/target.json. Values are fixed synthesis,
so no market feed, account or credential is ever reachable from this sample.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict

TOTAL_RETURN = 0.1234


class Performance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_return: float


class PerformancePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    performance: Performance


class PerformanceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: PerformancePayload


def inline_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Project this model's JSON schema to a single self-contained document.

    The confirmed target contract states the response inline, and the contract comparison is
    representation-sensitive on purpose, so the exported candidate must not express the same rules as
    component references. Substitution is depth bounded because these models must stay acyclic.
    """
    document = model.model_json_schema()
    definitions = document.pop("$defs", {})

    def resolve(value: Any, depth: int = 0) -> Any:
        if depth > 32:
            raise ValueError("Schema substitution exceeded its depth bound")
        if isinstance(value, dict):
            reference = value.get("$ref")
            if isinstance(reference, str) and reference.startswith("#/$defs/"):
                name = reference.removeprefix("#/$defs/")
                if name not in definitions:
                    raise KeyError(f"Unknown schema definition {name}")
                return resolve(definitions[name], depth + 1)
            return {key: resolve(item, depth + 1) for key, item in value.items()}
        if isinstance(value, list):
            return [resolve(item, depth + 1) for item in value]
        return value

    return resolve(document)
