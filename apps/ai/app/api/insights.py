from fastapi import APIRouter

from app.api.schemas import ActionableInsight, AIInsightResponse, InsightRequest

router = APIRouter(prefix="/v1/insights", tags=["Insights"])


@router.post("/generate", response_model=AIInsightResponse)
def generate_insights(request: InsightRequest):
    # Dummy logic to mock insights based on input metrics

    insights = []

    # We can create generic mocked insights
    if request.metrics:
        # E.g. finding based on the first metric
        first_metric = request.metrics[0]
        insights.append(
            ActionableInsight(
                finding=f"{first_metric.platform} {first_metric.metric_type} is at {first_metric.value} for {first_metric.period}.",
                recommendation=f"Increase short-form video content on {first_metric.platform} to capitalize on current trends.",
                impact_estimate="Expected +15% engagement lift"
            )
        )

    # Add a fixed mocked insight
    insights.append(
        ActionableInsight(
            finding="Short-form video performs 2.3x better than static image posts across all platforms.",
            recommendation="Reallocate 30% of static image production budget to Reels and TikToks.",
            impact_estimate="Expected +45% reach and +20% conversion rate"
        )
    )

    return AIInsightResponse(
        insights=insights,
        summary="Video content is outperforming static assets. Focus on short-form video across top platforms to maximize engagement and ROI."
    )
