from fastapi import APIRouter

from app.api.schemas import IngestRequest
from app.rag.embedder import create_embeddings, parse_and_chunk

router = APIRouter(prefix="/v1/embeddings", tags=["Knowledge"])


@router.post("/index")
async def index_knowledge(request: IngestRequest):
    """
    Endpoint to ingest knowledge sources, chunk them, create embeddings,
    and simulate storing them in a vector database.
    """
    results = []

    for source in request.sources:
        # Mocking the processing of the source content
        chunks = parse_and_chunk(source.content, chunk_size=50)
        embeddings = create_embeddings(chunks)

        # In a real scenario, we would store `chunks` and `embeddings` in a vector DB here
        results.append({
            "source_type": source.source_type,
            "chunks_processed": len(chunks),
            "embeddings_created": len(embeddings)
        })

    return {
        "status": "success",
        "brand_id": request.brand_id,
        "processed_sources": results
    }
