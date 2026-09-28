import json

from fastapi import APIRouter, HTTPException

from app.api.schemas import AIInsightResponse, InsightRequest
from app.providers.factory import get_provider

router = APIRouter(prefix="/v1/insights", tags=["Insights"])

SYSTEM = """You are the SoStats analytics insight engine.
Use only the supplied performance evidence. Never invent metrics, ids, dates, channels, or outcomes.
Separate observation from recommendation.

For every insight:
- evidence must contain concrete observations supported by the payload.
- use numeric language only when the supplied values support it.
- confidence reflects evidence strength, not persuasion.
- choose at most one action.

Allowed actions:
1. create_campaign: use when the evidence supports creating more content around a demonstrated pattern.
2. repurpose_content: source_content_id MUST be one of content_performance.content_item_id.
3. reschedule_publication: schedule_id MUST be one of upcoming_schedules.schedule_id and suggested_at must be an ISO timestamp. Only use this when the supplied performance evidence supports a timing change; otherwise choose another action.
4. none: use when evidence is too weak for a safe domain action.

target_platforms must be a subset of available_channels.
Do not claim that a recommendation will cause a guaranteed metric improvement.
"""


@router.post("/generate", response_model=AIInsightResponse)
async def generate_insights(request: InsightRequest):
    payload = {
        "metrics": [metric.model_dump() for metric in request.metrics],
        "content_performance": [
            item.model_dump() for item in request.content_performance
        ],
        "upcoming_schedules": [
            item.model_dump() for item in request.upcoming_schedules
        ],
        "available_channels": request.available_channels,
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
