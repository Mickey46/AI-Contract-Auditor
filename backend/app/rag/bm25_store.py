"""BM25 sparse retriever — built per job alongside ChromaDB for hybrid retrieval."""

from __future__ import annotations
import os
import pickle
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document as LCDocument
from app.models.schemas import Chunk

BM25_DIR = "/tmp/contract_auditor_bm25"


def _chunks_to_docs(chunks: list[Chunk]) -> list[LCDocument]:
    docs: list[LCDocument] = []
    for chunk in chunks:
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
    return docs


def build_bm25(chunks: list[Chunk], job_id: str) -> BM25Retriever:
    """Build a BM25 index from chunks and persist it for this job."""
    docs = _chunks_to_docs(chunks)
    retriever = BM25Retriever.from_documents(docs, k=40)

    os.makedirs(BM25_DIR, exist_ok=True)
    store_path = os.path.join(BM25_DIR, f"{job_id}.pkl")
    with open(store_path, "wb") as f:
        pickle.dump(retriever, f)

    return retriever


def load_bm25(job_id: str) -> BM25Retriever | None:
    """Load a persisted BM25 retriever for a job. Returns None if not found."""
    store_path = os.path.join(BM25_DIR, f"{job_id}.pkl")
    if not os.path.exists(store_path):
        return None
    with open(store_path, "rb") as f:
        return pickle.load(f)
