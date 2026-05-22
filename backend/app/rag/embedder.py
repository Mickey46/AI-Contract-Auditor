"""Embed chunks using OpenAI text-embedding-3-large and store in ChromaDB."""

from __future__ import annotations
import os
import chromadb
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document as LCDocument
from app.models.schemas import Chunk
from app.config import EMBEDDING_MODEL

CHROMA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "chroma_db")


def _embeddings(openai_api_key: str) -> OpenAIEmbeddings:
    """Return an OpenAIEmbeddings instance using the configured model."""
    return OpenAIEmbeddings(model=EMBEDDING_MODEL, openai_api_key=openai_api_key)


def get_vectorstore(collection_name: str, openai_api_key: str) -> Chroma:
    return Chroma(
        collection_name=collection_name,
        embedding_function=_embeddings(openai_api_key),
        persist_directory=CHROMA_DIR,
    )


def embed_chunks(chunks: list[Chunk], collection_name: str, openai_api_key: str) -> Chroma:
    """Convert Chunk objects to LangChain Documents and upsert into ChromaDB."""
    docs: list[LCDocument] = []
    ids: list[str] = []

    for i, chunk in enumerate(chunks):
        metadata: dict = {
            "source_file": chunk.source_file,
            "source_type": chunk.source_type,
            "doc_precedence": chunk.doc_precedence,
            "chunk_index": chunk.chunk_index,
        }
        if chunk.page_number is not None:
            metadata["page_number"] = chunk.page_number
        if chunk.sheet_name:
            metadata["sheet_name"] = chunk.sheet_name
        if chunk.row_range:
            metadata["row_range"] = chunk.row_range
        if chunk.section:
            metadata["section"] = chunk.section

        docs.append(LCDocument(page_content=chunk.text, metadata=metadata))
        ids.append(f"{collection_name}_{i}")

    vectorstore = Chroma.from_documents(
        documents=docs,
        embedding=_embeddings(openai_api_key),
        collection_name=collection_name,
        persist_directory=CHROMA_DIR,
        ids=ids,
    )
    return vectorstore


def delete_collection(collection_name: str) -> None:
    """Remove a collection from ChromaDB (cleanup after job)."""
    client = chromadb.PersistentClient(path=CHROMA_DIR)
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass
