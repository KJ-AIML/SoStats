import json

from fastapi import APIRouter, HTTPException

from app.api.schemas import AIInsightResponse, InsightRequest
from app.providers.factory import get_provider

router = APIRouter(prefix="/v1/insights", tags=["Insights"])

SYSTEM = """You are the SoStats analytics insight engine.
Use only the supplied performance evidence.
Separate observation from recommendation.
Never invent metrics.
Return concise, actionable JSON only.
"""


@router.post("/generate", response_model=AIInsightResponse)
async def generate_insights(request: InsightRequest):
    payload = {
        "metrics": [metric.model_dump() for metric in request.metrics],
        "brand_context": request.brand_context,
        "required_json_shape": {
            "insights": [
                {
                    "finding": "string grounded in supplied metrics",
                    "recommendation": "string",
                    "impact_estimate": "string; use qualitative wording when impact cannot be measured",
                }
            ],
            "summary": "string",
        },
    }

    try:
        provider = get_provider()
        result = await provider.generate_json(
            system=SYSTEM,
            prompt=json.dumps(payload, ensure_ascii=False),
            schema_name="AIInsightResponse",
        )
        return AIInsightResponse.model_validate(result)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Insight generation unavailable: {type(exc).__name__}",
        ) from exc
