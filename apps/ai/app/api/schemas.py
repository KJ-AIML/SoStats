from typing import Literal

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
    platform: str = Field(..., description="Platform (e.g., LinkedIn)")
    metric_type: str = Field(..., description="Type of metric (e.g., impressions, reactions)")
    value: float = Field(..., description="Observed metric value")
    period: str = Field(..., description="Observed time period")


class ContentPerformanceEvidence(BaseModel):
    content_item_id: int
    title: str
    platform: str
    published_at: str | None = None
    metrics: dict[str, float] = Field(default_factory=dict)


class UpcomingScheduleEvidence(BaseModel):
    schedule_id: int
    content_item_id: int
    title: str
    platform: str
    scheduled_at: str


class InsightRequest(BaseModel):
    metrics: list[AnalyticsMetrics]
    content_performance: list[ContentPerformanceEvidence] = Field(default_factory=list)
    upcoming_schedules: list[UpcomingScheduleEvidence] = Field(default_factory=list)
    available_channels: list[str] = Field(default_factory=list)
    brand_context: str | None = Field(None, description="Optional brand context")


class InsightAction(BaseModel):
    type: Literal[
        "create_campaign",
        "repurpose_content",
        "reschedule_publication",
        "none",
    ] = "none"
    campaign_goal: str | None = None
    audience: str | None = None
    source_content_id: int | None = None
    target_platforms: list[str] = Field(default_factory=list)
    schedule_id: int | None = None
    suggested_at: str | None = None


class ActionableInsight(BaseModel):
    finding: str = Field(..., description="Observation supported by supplied evidence")
    evidence: list[str] = Field(
        default_factory=list,
        description="Short concrete evidence statements tied to supplied metrics/content/schedules",
    )
    recommendation: str = Field(..., description="Actionable recommendation based on the finding")
    impact_estimate: str = Field(
        ...,
        description="Qualitative impact unless the supplied evidence supports a number",
    )
    confidence: Literal["low", "medium", "high"] = "medium"
    action: InsightAction = Field(default_factory=InsightAction)


class AIInsightResponse(BaseModel):
    insights: list[ActionableInsight]
    summary: str = Field(..., description="Overall summary of the evidence-backed insights")


class KnowledgeProcessRequest(BaseModel):
    media_type: str
    content: str | None = None
    content_base64: str | None = None


class KnowledgeChunkEmbedding(BaseModel):
    index: int
    content: str
    embedding: list[float]


class KnowledgeProcessResponse(BaseModel):
    text_length: int
    chunk_count: int
    embedding_model: str
    dimensions: int
    chunks: list[KnowledgeChunkEmbedding]


class KnowledgeQueryEmbeddingRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)


class KnowledgeQueryEmbeddingResponse(BaseModel):
    embedding_model: str
    dimensions: int
    embedding: list[float]
