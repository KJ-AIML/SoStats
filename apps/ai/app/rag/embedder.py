import random


def parse_and_chunk(text: str, chunk_size: int = 100) -> list[str]:
    """
    Mock function to parse and chunk text into smaller pieces.
    """
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
    return chunks

def create_embeddings(chunks: list[str]) -> list[list[float]]:
    """
    Mock function to create vector embeddings for a list of text chunks.
    Returns a list of dummy embedding vectors (lists of floats).
    """
    embeddings = []
    for _ in chunks:
        # Mock embedding of size 1536 (common for OpenAI models)
        embedding = [random.uniform(-1.0, 1.0) for _ in range(1536)]
        embeddings.append(embedding)
    return embeddings
