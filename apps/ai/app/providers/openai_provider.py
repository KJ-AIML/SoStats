import json
import os
from typing import Any

import httpx

from app.providers.base import StructuredGenerationProvider


class OpenAIProvider(StructuredGenerationProvider):
    def __init__(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")

        self.api_key = api_key
        self.base_url = os.getenv(
            "OPENAI_BASE_URL",
            "https://api.openai.com/v1",
        ).rstrip("/")
        self.model = os.getenv("AI_MODEL", "gpt-5.6-luna")

    @staticmethod
    def _extract_output_text(body: dict[str, Any]) -> str:
        for item in body.get("output", []):
            if item.get("type") != "message":
                continue

            for content in item.get("content", []):
                if content.get("type") == "refusal":
                    raise RuntimeError(
                        f"Model refused structured generation: {content.get('refusal', 'refused')}"
                    )
                if content.get("type") == "output_text":
                    text = content.get("text")
                    if isinstance(text, str) and text:
                        return text

        raise RuntimeError("Structured generation returned no output text")

    async def generate_json(
        self,
        *,
        system: str,
        prompt: str,
        schema_name: str,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "instructions": system,
            "input": prompt,
            "store": False,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "schema": schema,
                    "strict": True,
                }
            },
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{self.base_url}/responses",
                headers={
                    "authorization": f"Bearer {self.api_key}",
                    "content-type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            body = response.json()

        content = self._extract_output_text(body)
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise RuntimeError(
                f"{schema_name} generation returned a non-object JSON value"
            )
        return parsed
