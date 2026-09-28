import json

from fastapi import APIRouter, HTTPException

from app.api.schemas import AIInsightResponse, InsightRequest
from app.providers.factory import get_provider

router = APIRouter(prefix="/v1/insights", tags=["Insights"])

SYSTEM = """You are the SoStats analytics insight engine.
Use only the supplied performance evidence.
Separate observation from recommendation.
Never invent metrics.
When the evidence does not justify a numeric impact estimate, use qualitative wording.
"""


@router.post("/generate", response_model=AIInsightResponse)
async def generate_insights(request: InsightRequest):
    payload = {
        "metrics": [metric.model_dump() for metric in request.metrics],
        "brand_context": request.brand_context,
    }

    try:
        provider = get_provider()
        result = await provider.generate_json(
            system=SYSTEM,
            prompt=json.dumps(payload, ensure_ascii=False),
            schema_name="AIInsightResponse",
            schema=AIInsightResponse.model_json_schema(),
        )
        return AIInsightResponse.model_validate(result)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Insight generation unavailable: {type(exc).__name__}",
        ) from exc
