from fastapi import APIRouter

from app.api.schemas import CampaignBrief, CampaignPlan, ContentIdea, ScheduleSuggestion

router = APIRouter(prefix="/v1/campaigns", tags=["campaigns"])

@router.post("/plan", response_model=CampaignPlan)
async def generate_campaign_plan(brief: CampaignBrief):
    # Dummy logic to simulate structured generation
    return CampaignPlan(
        title=f"Campaign for {brief.goal}",
        objective=brief.goal,
        audience=brief.audience,
        channels=brief.channels if brief.channels else ["Instagram", "Twitter"],
        contentPillars=["Product Features", "Customer Success", "Behind the Scenes"],
        contentIdeas=[
            ContentIdea(
                idea="Product Teaser",
                description="A short teaser showing the new feature in action.",
                format="Video"
            ),
            ContentIdea(
                idea="Customer Quote",
                description="A carousel of 3 testimonials from happy customers.",
                format="Carousel"
            )
        ],
        scheduleSuggestions=[
            ScheduleSuggestion(
                channel="Instagram",
                frequency="3 times a week",
                bestTimes=["09:00 AM", "12:00 PM", "06:00 PM"]
            )
        ]
    )
