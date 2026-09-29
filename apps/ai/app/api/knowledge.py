import os

from fastapi import APIRouter, HTTPException

from app.api.schemas import (
    KnowledgeChunkEmbedding,
    KnowledgeProcessRequest,
    KnowledgeProcessResponse,
    KnowledgeQueryEmbeddingRequest,
    KnowledgeQueryEmbeddingResponse,
)
from app.providers.factory import get_provider
from app.rag.embedder import chunk_text, extract_text

router = APIRouter(prefix="/v1/knowledge", tags=["Knowledge"])


@router.post("/process", response_model=KnowledgeProcessResponse)
async def process_knowledge(request: KnowledgeProcessRequest):
    try:
        text = extract_text(
            media_type=request.media_type,
            content=request.content,
            content_base64=request.content_base64,
        )
        chunks = chunk_text(text)
        if not chunks:
            raise ValueError("Knowledge source did not contain extractable text")

        provider = get_provider()
        embeddings = await provider.embed_texts(chunks)
        model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        dimensions = int(os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536"))

        return KnowledgeProcessResponse(
            text_length=len(text),
            chunk_count=len(chunks),
            embedding_model=model,
            dimensions=dimensions,
            chunks=[
                KnowledgeChunkEmbedding(
                    index=index,
                    content=chunk,
                    embedding=embedding,
                )
                for index, (chunk, embedding) in enumerate(
                    zip(chunks, embeddings, strict=True)
                )
            ],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Knowledge processing unavailable: {type(exc).__name__}",
        ) from exc


@router.post("/embed-query", response_model=KnowledgeQueryEmbeddingResponse)
async def embed_query(request: KnowledgeQueryEmbeddingRequest):
    try:
        provider = get_provider()
        embeddings = await provider.embed_texts([request.query.strip()])
        if len(embeddings) != 1:
            raise RuntimeError("Query embedding was not returned")
        return KnowledgeQueryEmbeddingResponse(
            embedding_model=os.getenv(
                "OPENAI_EMBEDDING_MODEL",
                "text-embedding-3-small",
            ),
            dimensions=int(
                os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536")
            ),
            embedding=embeddings[0],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Knowledge query embedding unavailable: {type(exc).__name__}",
        ) from exc
