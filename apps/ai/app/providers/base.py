from abc import ABC, abstractmethod
from typing import Any


class StructuredGenerationProvider(ABC):
    @abstractmethod
    async def generate_json(
        self,
        *,
        system: str,
        prompt: str,
        schema_name: str,
    ) -> dict[str, Any]:
        raise NotImplementedError
