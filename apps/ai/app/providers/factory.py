import os

from app.providers.base import StructuredGenerationProvider
from app.providers.openai_provider import OpenAIProvider


def get_provider() -> StructuredGenerationProvider:
    provider = os.getenv("AI_PROVIDER", "openai").lower()
    if provider == "openai":
        return OpenAIProvider()
    raise RuntimeError(f"Unsupported AI_PROVIDER: {provider}")
