"""
RAG-based reasoning-model contract term extractor.

Retrieval uses the NVIDIA-style hybrid pipeline (dense + BM25 + reranker)
via build_hybrid_retriever when a bm25_retriever is provided.
Falls back to dense-only if not available.
"""

from __future__ import annotations
import json
from typing import Optional
from openai import OpenAI
from langchain_chroma import Chroma
from langchain_community.retrievers import BM25Retriever
from app.models.schemas import ContractTerm, EvidenceChunk
from app.rag.retriever import retrieve_for_sku, retrieve_for_field
from app.config import resolve_reasoning_model, supports_temperature


EXTRACTION_SYSTEM = """You are a senior contract compliance analyst specialising in healthcare provider agreements.
You are given excerpts from multiple contract documents (PDF base contracts, Excel pricing sheets,
DOCX amendments, and email addendums) for a single service SKU.

Each excerpt is labelled with its SOURCE document, page/sheet/section, and a PRECEDENCE number:
  1 = Email Addendum   (HIGHEST authority — overrides everything)
  2 = DOCX Amendment   (overrides base contract and Excel)
  3 = Excel Sheet      (overrides PDF base contract)
  4 = PDF Contract     (base terms, lowest authority)

CRITICAL RULES — follow these exactly:
1. When two sources define the SAME field differently, ALWAYS use the value from the
   source with the LOWER precedence number.
2. DOCX amendments and email addendums are SPECIFICALLY designed to override older values.
   If an amendment says "revised from X to Y", the correct value is Y, not X.
3. For discount_percent: check ALL sources, especially amendments. If ANY amendment or
   addendum specifies a new discount for this SKU, that discount supersedes the base contract.
4. Extract the FINAL, CURRENTLY-EFFECTIVE value for each field as of the latest amendment.
5. In your reasoning, explicitly state EVERY source that mentioned each field and justify
   which one you chose and WHY it supersedes the others.
6. Return ONLY valid JSON — no markdown fences, no extra text.
"""

EXTRACTION_USER_TEMPLATE = """Extract the FINAL AUTHORITATIVE contract terms for SKU: {sku} ({description}).

The documents below are sorted with MOST AUTHORITATIVE first (lowest precedence number = highest authority).
Pay special attention to any amendments or addendums — they OVERRIDE base contract values.

=== CONTRACT DOCUMENT EXCERPTS ===
{context}

=== INSTRUCTIONS ===
For each field (unit_price, discount_percent, tax_percent):
  - List every source that mentions it
  - Identify the most authoritative source (lowest precedence number)
  - Use that value as the final answer

Return this JSON schema EXACTLY (no extra keys, no markdown):
{{
  "sku": "{sku}",
  "description": "{description}",
  "unit_price": <float — most authoritative value>,
  "discount_percent": <float — most authoritative value, 0 if none>,
  "tax_percent": <float — most authoritative value>,
  "effective_date": "<YYYY-MM-DD of most recent amendment, or null>",
  "source_document": "<filename of the most authoritative source used>",
  "doc_precedence": <int 1-4 of that source>,
  "reasoning": "<detailed explanation: for EACH field, which sources defined it and which one won and why>",
  "evidence_chunks": [
    {{
      "source_file": "<filename>",
      "page_number": <int or null>,
      "sheet_name": "<str or null>",
      "row_range": "<str or null>",
      "section": "<str or null>",
      "excerpt": "<verbatim relevant text from this source>",
      "doc_precedence": <int 1-4>,
      "superseded_by": "<filename that overrides this, or null>"
    }}
  ]
}}
"""


def _build_context(evidence_chunks: list[EvidenceChunk]) -> str:
    """Build ranked context string, deduplicating by source location."""
    seen: set[str] = set()
    parts: list[str] = []
    idx = 1
    for ev in evidence_chunks:
        key = f"{ev.source_file}:{ev.page_number}:{ev.sheet_name}:{ev.row_range}:{ev.section}"
        if key in seen:
            continue
        seen.add(key)
        parts.append(
            f"[{idx}] SOURCE: {ev.location_label} | Precedence: {ev.doc_precedence} "
            f"({'EMAIL ADDENDUM — HIGHEST AUTHORITY' if ev.doc_precedence == 1 else 'AMENDMENT — OVERRIDES BASE CONTRACT' if ev.doc_precedence == 2 else 'EXCEL PRICING SHEET' if ev.doc_precedence == 3 else 'PDF BASE CONTRACT'})\n"
            f"{ev.excerpt}"
        )
        idx += 1
    return "\n\n---\n\n".join(parts)


def extract_contract_term(
    sku: str,
    description: str,
    vectorstore: Chroma,
    openai_api_key: str,
    k: int = 6,
    bm25_retriever: Optional[BM25Retriever] = None,
) -> ContractTerm:
    """
    Extract authoritative contract terms for a SKU.

    Uses hybrid retrieval (dense + BM25 → reranker) when bm25_retriever is provided,
    otherwise falls back to dense-only similarity search.
    """
    # Per-field targeted retrieval — ensures amendment chunks surface for EACH field
    all_chunks: list[EvidenceChunk] = []
    seen_keys: set[str] = set()

    for field in ("unit_price", "discount_percent", "tax_percent"):
        field_chunks = retrieve_for_field(
            vectorstore, sku, field, k=k,
            bm25_retriever=bm25_retriever, top_n=6,
        )
        for chunk in field_chunks:
            key = f"{chunk.source_file}:{chunk.page_number}:{chunk.sheet_name}:{chunk.row_range}:{chunk.section}"
            if key not in seen_keys:
                seen_keys.add(key)
                all_chunks.append(chunk)

    # Broad SKU-level sweep to catch any remaining amendment/addendum chunks
    broad_chunks = retrieve_for_sku(
        vectorstore, sku, k=k,
        bm25_retriever=bm25_retriever, top_n=8,
    )
    for chunk in broad_chunks:
        key = f"{chunk.source_file}:{chunk.page_number}:{chunk.sheet_name}:{chunk.row_range}:{chunk.section}"
        if key not in seen_keys:
            seen_keys.add(key)
            all_chunks.append(chunk)

    # Sort: most authoritative (lowest precedence) first, then by similarity
    all_chunks.sort(key=lambda e: (e.doc_precedence, e.similarity_score or 999))

    context = _build_context(all_chunks)

    client = OpenAI(api_key=openai_api_key)
    user_msg = EXTRACTION_USER_TEMPLATE.format(
        sku=sku,
        description=description,
        context=context,
    )

    # Resolve best available reasoning model (gpt-5.5-thinking → o3 → gpt-4o)
    model = resolve_reasoning_model(openai_api_key)
    kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "response_format": {"type": "json_object"},
    }
    if supports_temperature(model):
        kwargs["temperature"] = 0
    response = client.chat.completions.create(**kwargs)

    raw = response.choices[0].message.content
    data = json.loads(raw)

    # Parse evidence_chunks from response
    ev_chunks = []
    for ev in data.get("evidence_chunks", []):
        ev_chunks.append(
            EvidenceChunk(
                source_file=ev.get("source_file", ""),
                page_number=ev.get("page_number"),
                sheet_name=ev.get("sheet_name"),
                row_range=ev.get("row_range"),
                section=ev.get("section"),
                excerpt=ev.get("excerpt", ""),
                doc_precedence=ev.get("doc_precedence", 4),
                superseded_by=ev.get("superseded_by"),
            )
        )

    # Also attach the retrieval chunks that weren't in the LLM response but were retrieved
    llm_sources = {e.source_file for e in ev_chunks}
    for chunk in all_chunks:
        if chunk.source_file not in llm_sources and chunk.doc_precedence <= 2:
            ev_chunks.append(chunk)

    return ContractTerm(
        sku=data.get("sku", sku),
        description=data.get("description", description),
        unit_price=float(data.get("unit_price", 0)),
        discount_percent=float(data.get("discount_percent", 0)),
        tax_percent=float(data.get("tax_percent", 8)),
        effective_date=data.get("effective_date"),
        source_document=data.get("source_document", ""),
        doc_precedence=int(data.get("doc_precedence", 4)),
        reasoning=data.get("reasoning", ""),
        evidence_chunks=ev_chunks,
    )
