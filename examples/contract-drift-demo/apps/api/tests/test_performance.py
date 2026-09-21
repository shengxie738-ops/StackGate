"""Runnable checks for the demo API: it starts, answers and exports without a StackGate process.

From the ``apps/api`` directory: ``python -m pytest``.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.models import TOTAL_RETURN, PerformanceResponse, inline_schema


def test_performance_returns_a_json_number() -> None:
    with TestClient(app) as client:
        response = client.get("/api/performance")
    assert response.status_code == 200
    body = response.json()
    value = body["data"]["performance"]["total_return"]
    assert isinstance(value, float)
    assert not isinstance(value, bool)
    assert value == TOTAL_RETURN == 0.1234


def test_health_reports_readiness_only() -> None:
    with TestClient(app) as client:
        health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ready"}
    assert list(app.openapi()["paths"]) == ["/api/performance"]


def declared_schema() -> dict:
    operation = app.openapi()["paths"]["/api/performance"]["get"]
    assert operation["operationId"] == "getPerformance"
    assert list(operation["responses"]) == ["200"]
    return operation["responses"]["200"]["content"]["application/json"]["schema"]


def test_exported_contract_describes_the_confirmed_response_shape() -> None:
    schema = declared_schema()
    assert "$ref" not in schema
    assert schema["required"] == ["data"]
    assert schema["additionalProperties"] is False
    total_return = schema["properties"]["data"]["properties"]["performance"]["properties"]["total_return"]
    assert total_return["type"] == "number"


def test_declared_contract_is_derived_from_the_response_model() -> None:
    assert declared_schema() == inline_schema(PerformanceResponse)


def test_unknown_route_is_not_served() -> None:
    with TestClient(app) as client:
        response = client.get("/api/performance/extra")
    assert response.status_code == 404
