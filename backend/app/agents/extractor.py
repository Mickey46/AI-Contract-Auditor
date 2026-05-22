"""
LLM contract-term extractor over RAG-retrieved chunks.

For each invoice SKU we:
  1. Pull the top-K chunks from ChromaDB across the relevant fields
  2. Stuff them into a single prompt with source labels
  3. Ask the LLM for the authoritative unit_price / discount_percent / tax_percent
     plus citations back to the source chunks
"""

from __future__ import annotations
import json

from openai import OpenAI
from langchain_chroma import Chroma

from app.models.schemas import ContractTerm, EvidenceChunk
from app.rag.retriever import retrieve_for_field, retrieve_for_sku
from app.config import resolve_reasoning_model, supports_temperature


EXTRACTION_SYSTEM = """You are a contract compliance analyst.
You are given excerpts from one or more vendor contract documents (PDFs, Excel pricing
sheets, DOCX amendments, email addendums) for a single product or service SKU.

Each excerpt is labelled with its SOURCE document, page/sheet/section, and a PRECEDENCE number:
  1 = Email Addendum   (highest authority — overrides everything below)
  2 = DOCX Amendment   (overrides base contract and Excel)
  3 = Excel Sheet      (overrides base PDF contract)
  4 = PDF Contract     (base terms, lowest authority)

Rules:
1. When two sources define the same field differently, use the value from the source with
   the lower precedence number.
2. Amendments and addendums explicitly override older terms. If an amendment says
   "revised from X to Y", the correct value is Y.
3. Extract the FINAL, currently-effective value for each field.
4. In your reasoning, list every source that mentioned each field and explain which one won.
5. Return ONLY valid JSON — no markdown fences, no extra text.
"""

EXTRACTION_USER_TEMPLATE = """Extract the final authoritative contract terms for SKU: {sku} ({description}).

Excerpts are sorted with the most authoritative first.

=== CONTRACT EXCERPTS ===
{context}

Return this JSON schema EXACTLY (no extra keys, no markdown):
{{
  "sku": "{sku}",
  "description": "{description}",
  "unit_price": <float>,
  "discount_percent": <float, 0 if none>,
  "tax_percent": <float>,
  "effective_date": "<YYYY-MM-DD or null>",
  "source_document": "<filename of the most authoritative source>",
  "doc_precedence": <int 1-4>,
  "reasoning": "<for each field, which sources defined it and which one won>",
  "evidence_chunks": [
    {{
      "source_file": "<filename>",
      "page_number": <int or null>,
      "sheet_name": "<str or null>",
      "row_range": "<str or null>",
      "section": "<str or null>",
      "excerpt": "<verbatim relevant text>",
      "doc_precedence": <int 1-4>,
      "superseded_by": "<filename that overrides this, or null>"
    }}
  ]
}}
"""

PRECEDENCE_LABEL = {
    1: "EMAIL ADDENDUM (highest authority)",
    2: "AMENDMENT (overrides base contract)",
    3: "EXCEL PRICING SHEET",
    4: "PDF BASE CONTRACT",
}


def _build_context(evidence_chunks: list[EvidenceChunk]) -> str:
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
            f"({PRECEDENCE_LABEL.get(ev.doc_precedence, 'UNKNOWN')})\n"
            f"{ev.excerpt}"
        )
        idx += 1
    return "\n\n---\n\n".join(parts)


def extract_contract_term(
    sku: str,
    description: str,
    vectorstore: Chroma,
    openai_api_key: str,
    k: int = 8,
) -> ContractTerm:
    """Retrieve top-K chunks for a SKU and ask the LLM for the authoritative terms."""
    all_chunks: list[EvidenceChunk] = []
    seen_keys: set[str] = set()

    def _add(chunks: list[EvidenceChunk]) -> None:
        for chunk in chunks:
            key = f"{chunk.source_file}:{chunk.page_number}:{chunk.sheet_name}:{chunk.row_range}:{chunk.section}"
            if key not in seen_keys:
                seen_keys.add(key)
                all_chunks.append(chunk)

    for field in ("unit_price", "discount_percent", "tax_percent"):
        _add(retrieve_for_field(vectorstore, sku, description, field, k=k))
    _add(retrieve_for_sku(vectorstore, sku, description, k=k))

    all_chunks.sort(key=lambda e: (e.doc_precedence, e.similarity_score or 999))
    context = _build_context(all_chunks)

    client = OpenAI(api_key=openai_api_key)
    user_msg = EXTRACTION_USER_TEMPLATE.format(sku=sku, description=description, context=context)
    model = resolve_reasoning_model(openai_api_key)

    kwargs: dict = {
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
    data = json.loads(response.choices[0].message.content or "{}")

    ev_chunks: list[EvidenceChunk] = []
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

    # Attach any high-authority retrieved chunks the LLM didn't echo back so the
    # evidence drawer always has something to show.
    llm_sources = {e.source_file for e in ev_chunks}
    for chunk in all_chunks:
        if chunk.source_file not in llm_sources and chunk.doc_precedence <= 2:
            ev_chunks.append(chunk)

    return ContractTerm(
        sku=data.get("sku", sku),
        description=data.get("description", description),
        unit_price=float(data.get("unit_price", 0) or 0),
        discount_percent=float(data.get("discount_percent", 0) or 0),
        tax_percent=float(data.get("tax_percent", 0) or 0),
        effective_date=data.get("effective_date"),
        source_document=data.get("source_document", ""),
        doc_precedence=int(data.get("doc_precedence", 4) or 4),
        reasoning=data.get("reasoning", ""),
        evidence_chunks=ev_chunks,
    )
