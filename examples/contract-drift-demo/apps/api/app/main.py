"""Real FastAPI application behind the demo's confirmed target contract.

`create_app` is exported so the later observation, probe and Compose tasks can wrap these same routes
instead of keeping a second copy of the service.

The response schema is declared from the Pydantic model rather than left as a component reference because
the confirmed target contract states it inline and the behavioral contract comparison is deliberately
representation-sensitive. The payload is still constructed through the model, so what is served and what
is exported come from one definition.
"""

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

from .models import TOTAL_RETURN, Performance, PerformancePayload, PerformanceResponse, inline_schema

RESPONSE_DESCRIPTION = "Synthetic total return; no financial account or production data"


def create_app() -> FastAPI:
    app = FastAPI(title="StackGate synthetic performance fixture", version="0.1.0")

    @app.get(
        "/api/performance",
        operation_id="getPerformance",
        response_model=None,
        responses={
            200: {
                "description": RESPONSE_DESCRIPTION,
                "content": {"application/json": {"schema": inline_schema(PerformanceResponse)}},
            }
        },
    )
    def get_performance() -> Response:
        payload = PerformanceResponse(data=PerformancePayload(performance=Performance(total_return=TOTAL_RETURN)))
        return JSONResponse(content=payload.model_dump())

    # Readiness only. It is deliberately absent from the exported business contract.
    @app.get("/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ready"}

    return app


app = create_app()
