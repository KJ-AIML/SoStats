from pydantic import BaseModel, Field  # type: ignore


class BrandProfile(BaseModel):
    voice: str = Field(..., description="The tone and voice of the brand (e.g., professional, friendly)")
    audience: str = Field(..., description="Target audience description")
    products: list[str] = Field(default_factory=list, description="List of key products or services")
    pillars: list[str] = Field(default_factory=list, description="Content pillars or core values")


class BrandContextResponse(BaseModel):
    brand_id: str = Field(..., description="Unique identifier for the brand")
    profile: BrandProfile
    assembled_context: str = Field(..., description="The fully assembled context string for LLM injection")


class CampaignBrief(BaseModel):
    goal: str = Field(..., description="Campaign goal or objective")
    audience: str = Field(..., description="Target audience for the campaign")
    channels: list[str] = Field(default_factory=list, description="List of channels to use (e.g., Instagram, Twitter)")
    tone: str = Field(..., description="Tone of voice for the campaign")
    brand_context: str | None = Field(None, description="Optional brand context for the campaign")


class ContentIdea(BaseModel):
    idea: str
    description: str
    format: str = Field(..., description="Format of the content (e.g., Video, Carousel, Text post)")


class ScheduleSuggestion(BaseModel):
    channel: str
    frequency: str
    bestTimes: list[str]


class CampaignPlan(BaseModel):
    title: str
    objective: str
    audience: str
    channels: list[str]
    contentPillars: list[str]
    contentIdeas: list[ContentIdea]
    scheduleSuggestions: list[ScheduleSuggestion]


class AnalyticsMetrics(BaseModel):
    platform: str = Field(..., description="Platform (e.g., Instagram, TikTok)")
    metric_type: str = Field(..., description="Type of metric (e.g., engagement, reach)")
    value: float = Field(..., description="Value of the metric")
    period: str = Field(..., description="Time period (e.g., Last 30 days)")


class InsightRequest(BaseModel):
    metrics: list[AnalyticsMetrics]
    brand_context: str | None = Field(None, description="Optional brand context")


class ActionableInsight(BaseModel):
    finding: str = Field(..., description="The main finding from the data")
    recommendation: str = Field(..., description="Actionable recommendation based on the finding")
    impact_estimate: str = Field(..., description="Estimated impact of taking action")


class AIInsightResponse(BaseModel):
    insights: list[ActionableInsight]
    summary: str = Field(..., description="Overall summary of the insights")


class KnowledgeSource(BaseModel):
    source_type: str = Field(..., description="Type of source (e.g., url, document, text)")
    content: str = Field(..., description="The actual content or URL")
    metadata: dict = Field(default_factory=dict, description="Optional metadata")


class IngestRequest(BaseModel):
    sources: list[KnowledgeSource]
    brand_id: str | None = Field(None, description="Optional brand ID to associate with the knowledge")
