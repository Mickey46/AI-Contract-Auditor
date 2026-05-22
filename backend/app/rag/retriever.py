"""
Dense top-K retrieval over ChromaDB.

Vendor-agnostic: SKU descriptions come from the invoice CSV, not a hardcoded dict.
"""

from __future__ import annotations

from langchain_chroma import Chroma
from langchain_core.documents import Document as LCDocument

from app.models.schemas import EvidenceChunk


FIELD_QUERY_TEMPLATES = {
    "unit_price": "unit price cost per transaction revised amended price for SKU {sku} {desc}",
    "discount_percent": "discount percentage revised amended reduction override for SKU {sku} {desc}",
    "tax_percent": "tax rate percentage applicable for SKU {sku} {desc}",
    "total_amount": "total billing amount calculation for SKU {sku} {desc}",
}


def _docs_to_evidence(results: list[tuple[LCDocument, float]]) -> list[EvidenceChunk]:
    evidence: list[EvidenceChunk] = []
    for doc, score in results:
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
                similarity_score=round(float(score), 4),
            )
        )
    evidence.sort(key=lambda e: (e.doc_precedence, e.similarity_score or 999))
    return evidence


def retrieve_for_field(
    vectorstore: Chroma,
    sku: str,
    sku_description: str,
    field: str,
    k: int = 8,
) -> list[EvidenceChunk]:
    """Targeted dense retrieval for one field of one SKU."""
    template = FIELD_QUERY_TEMPLATES.get(field, f"{field} for SKU {{sku}} {{desc}}")
    query = template.format(sku=sku, desc=sku_description)
    results = vectorstore.similarity_search_with_score(query, k=k)
    return _docs_to_evidence(results)


def retrieve_for_sku(
    vectorstore: Chroma,
    sku: str,
    sku_description: str,
    k: int = 8,
) -> list[EvidenceChunk]:
    """Broad dense retrieval for any pricing/amendment terms tied to a SKU."""
    query = f"pricing discount tax amendment revised terms override for SKU {sku} {sku_description}"
    results = vectorstore.similarity_search_with_score(query, k=k)
    return _docs_to_evidence(results)
