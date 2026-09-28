import json

from fastapi import APIRouter, HTTPException

from app.api.schemas import CampaignBrief, CampaignPlan
from app.providers.factory import get_provider

router = APIRouter(prefix="/v1/campaigns", tags=["campaigns"])

SYSTEM = """You are SoStats Campaign Planner.
Create practical, platform-aware social campaigns for a real brand.
Return only valid JSON matching the requested schema.
Do not invent claims, statistics, testimonials, or customer results.
Keep content ideas distinct enough to become separate posts.
"""


@router.post("/plan", response_model=CampaignPlan)
async def generate_campaign_plan(brief: CampaignBrief):
    prompt = {
        "goal": brief.goal,
        "audience": brief.audience,
        "channels": brief.channels,
        "tone": brief.tone,
        "brand_context": brief.brand_context,
        "required_json_shape": {
            "title": "string",
            "objective": "string",
            "audience": "string",
            "channels": ["string"],
            "contentPillars": ["string"],
            "contentIdeas": [
                {
                    "idea": "string",
                    "description": "string",
                    "format": "string",
                }
            ],
            "scheduleSuggestions": [
                {
                    "channel": "string",
                    "frequency": "string",
                    "bestTimes": ["string"],
                }
            ],
        },
    }

    try:
        provider = get_provider()
        result = await provider.generate_json(
            system=SYSTEM,
            prompt=json.dumps(prompt, ensure_ascii=False),
            schema_name="CampaignPlan",
        )
        return CampaignPlan.model_validate(result)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Campaign generation unavailable: {type(exc).__name__}",
        ) from exc
