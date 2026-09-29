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
        self.embedding_model = os.getenv(
            "OPENAI_EMBEDDING_MODEL",
            "text-embedding-3-small",
        )
        self.embedding_dimensions = int(
            os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536")
        )

    @property
    def headers(self) -> dict[str, str]:
        return {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }

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
                headers=self.headers,
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

    async def embed_texts(
        self,
        texts: list[str],
    ) -> list[list[float]]:
        if not texts:
            return []
        if len(texts) > 100:
            raise ValueError("Embedding batch cannot exceed 100 chunks")

        payload = {
            "model": self.embedding_model,
            "input": texts,
            "dimensions": self.embedding_dimensions,
            "encoding_format": "float",
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()
            body = response.json()

        rows = body.get("data")
        if not isinstance(rows, list) or len(rows) != len(texts):
            raise RuntimeError("Embedding response length did not match input")

        ordered = sorted(rows, key=lambda row: int(row.get("index", 0)))
        embeddings: list[list[float]] = []
        for row in ordered:
            embedding = row.get("embedding")
            if (
                not isinstance(embedding, list)
                or len(embedding) != self.embedding_dimensions
            ):
                raise RuntimeError("Embedding response dimensions are invalid")
            embeddings.append([float(value) for value in embedding])

        return embeddings
