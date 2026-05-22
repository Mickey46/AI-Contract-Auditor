"""
NVIDIA-inspired hybrid RAG retriever.

Architecture (two-stage):
  Stage 1 — Wide recall: Dense (Chroma, k=40) + Sparse (BM25, k=40), merged via RRF.
  Stage 2 — Precision:   Reranker (NVIDIARerank if NVIDIA_API_KEY set, else
                         CrossEncoderReranker from sentence-transformers, else
                         precedence+score sort only) → top_n=6.

This mirrors the NVIDIA RAG Blueprint pattern:
  query → [dense | sparse] → EnsembleRetriever (RRF) → ContextualCompressionRetriever → top-N
"""

from __future__ import annotations
import os
from typing import Optional

from langchain_chroma import Chroma
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document as LCDocument
from langchain.retrievers import EnsembleRetriever
from langchain.retrievers.contextual_compression import ContextualCompressionRetriever

from app.models.schemas import EvidenceChunk


# ── Query templates (kept for backward compatibility with extractor) ────────

SKU_DESCRIPTIONS = {
    "CP-001": "claims processing transaction fee",
    "AP-002": "appeals processing premium service",
    "EL-003": "eligibility checks lookup service",
    "DM-004": "data migration project fee",
}

FIELD_QUERY_TEMPLATES = {
    "unit_price": "unit price cost per transaction revised amended price for SKU {sku} {desc}",
    "discount_percent": "discount percentage revised amended reduction override new discount for SKU {sku} {desc}",
    "tax_percent": "tax rate percentage applicable for SKU {sku} {desc}",
    "total_amount": "total billing amount calculation for SKU {sku} {desc}",
}


# ── Reranker factory ────────────────────────────────────────────────────────

def _reranker_name() -> str:
    """Return a display name for the active reranker (shown in UI)."""
    if os.getenv("NVIDIA_API_KEY"):
        return "NVIDIA NeMo Reranker"
    try:
        import sentence_transformers  # noqa: F401
        return "CrossEncoder (ms-marco-MiniLM)"
    except ImportError:
        return "RRF (no neural reranker)"


def _build_reranker(top_n: int = 6):
    """Build the best available reranker. Returns None if neither is installed."""
    nvidia_key = os.getenv("NVIDIA_API_KEY")

    if nvidia_key:
        try:
            from langchain_nvidia_ai_endpoints import NVIDIARerank
            return NVIDIARerank(
                model="nvidia/nv-rerankqa-mistral-4b-v3",
                top_n=top_n,
                nvidia_api_key=nvidia_key,
            )
        except Exception:
            pass  # fall through to cross-encoder

    try:
        from langchain.retrievers.document_compressors import CrossEncoderReranker
        from langchain_community.cross_encoders import HuggingFaceCrossEncoder
        cross_encoder = HuggingFaceCrossEncoder(model_name="cross-encoder/ms-marco-MiniLM-L-6-v2")
        return CrossEncoderReranker(model=cross_encoder, top_n=top_n)
    except Exception:
        return None


# ── Public API ──────────────────────────────────────────────────────────────

def build_hybrid_retriever(
    vectorstore: Chroma,
    bm25_retriever: Optional[BM25Retriever],
    top_n: int = 6,
    dense_k: int = 40,
) -> ContextualCompressionRetriever | EnsembleRetriever | object:
    """
    Build the two-stage hybrid retriever.

    Stage 1: EnsembleRetriever (Chroma dense k=40 + BM25 k=40, RRF fusion).
    Stage 2: ContextualCompressionRetriever with NVIDIARerank or CrossEncoderReranker.
             Falls back to raw EnsembleRetriever if no reranker available.
    """
    # Dense retriever — Chroma similarity
    dense_retriever = vectorstore.as_retriever(search_kwargs={"k": dense_k})

    if bm25_retriever is not None:
        # BM25 k must match or be set here
        bm25_retriever.k = dense_k
        # EnsembleRetriever uses Reciprocal Rank Fusion (RRF)
        ensemble = EnsembleRetriever(
            retrievers=[dense_retriever, bm25_retriever],
            weights=[0.6, 0.4],  # slightly favour dense for semantic docs
        )
    else:
        ensemble = dense_retriever  # type: ignore[assignment]

    reranker = _build_reranker(top_n=top_n)
    if reranker is not None:
        return ContextualCompressionRetriever(
            base_compressor=reranker,
            base_retriever=ensemble,
        )

    return ensemble


def docs_to_evidence(docs: list[LCDocument]) -> list[EvidenceChunk]:
    """Convert LangChain Documents (from retriever) → EvidenceChunk objects."""
    evidence: list[EvidenceChunk] = []
    for doc in docs:
        m = doc.metadata
        evidence.append(
            EvidenceChunk(
                source_file=m.get("source_file", ""),
                page_number=m.get("page_number"),
                sheet_name=m.get("sheet_name"),
                row_range=m.get("row_range"),
                section=m.get("section"),
                excerpt=doc.page_content[:400],
                doc_precedence=m.get("doc_precedence", 4),
                similarity_score=None,  # reranker scores not exposed as similarity
            )
        )
    # Authority sort: lower precedence number = more authoritative source first
    evidence.sort(key=lambda e: e.doc_precedence)
    return evidence


# ── Convenience wrappers (used by extractor for per-field queries) ───────────

def retrieve_for_field(
    vectorstore: Chroma,
    sku: str,
    field: str,
    k: int = 5,
    bm25_retriever: Optional[BM25Retriever] = None,
    top_n: int = 6,
) -> list[EvidenceChunk]:
    """Targeted hybrid retrieval for a specific field of a SKU."""
    desc = SKU_DESCRIPTIONS.get(sku, sku)
    template = FIELD_QUERY_TEMPLATES.get(field, f"{field} for SKU {{sku}} {{desc}}")
    query = template.format(sku=sku, desc=desc)

    if bm25_retriever is not None:
        retriever = build_hybrid_retriever(vectorstore, bm25_retriever, top_n=top_n)
        docs = retriever.invoke(query)
    else:
        # Dense-only fallback
        docs = vectorstore.similarity_search(query, k=k)

    return docs_to_evidence(docs)


def retrieve_for_sku(
    vectorstore: Chroma,
    sku: str,
    k: int = 8,
    bm25_retriever: Optional[BM25Retriever] = None,
    top_n: int = 8,
) -> list[EvidenceChunk]:
    """Broad hybrid retrieval for all amendment/pricing terms for a SKU."""
    desc = SKU_DESCRIPTIONS.get(sku, sku)
    query = f"pricing discount tax amendment revised terms override for SKU {sku} {desc}"

    if bm25_retriever is not None:
        retriever = build_hybrid_retriever(vectorstore, bm25_retriever, top_n=top_n)
        docs = retriever.invoke(query)
    else:
        docs = vectorstore.similarity_search(query, k=k)

    return docs_to_evidence(docs)


def get_retrieval_info() -> dict:
    """Return metadata about the active retrieval strategy for UI display."""
    return {
        "strategy": "Hybrid (Dense + BM25)",
        "dense_k": 40,
        "sparse_k": 40,
        "reranker": _reranker_name(),
        "top_n": 6,
    }
