"""Resolve conflicts across contract terms from multiple documents."""

from __future__ import annotations
from app.models.schemas import ContractTerm


def normalize_terms(terms: list[ContractTerm]) -> dict[str, ContractTerm]:
    """
    Given a list of extracted ContractTerms (possibly multiple per SKU from different docs),
    return a map of SKU → single authoritative ContractTerm.

    Precedence: lower doc_precedence number wins.
    1 = email addendum (highest authority)
    2 = DOCX amendment
    3 = Excel pricing sheet
    4 = PDF base contract (lowest authority)
    """
    by_sku: dict[str, list[ContractTerm]] = {}
    for term in terms:
        by_sku.setdefault(term.sku, []).append(term)

    resolved: dict[str, ContractTerm] = {}
    for sku, candidates in by_sku.items():
        # Sort by precedence (most authoritative first)
        candidates.sort(key=lambda t: t.doc_precedence)
        winner = candidates[0]

        # Mark losers as superseded
        for loser in candidates[1:]:
            for ev in loser.evidence_chunks:
                ev.superseded_by = winner.source_document

        # Collect all evidence chunks
        all_evidence = []
        for c in candidates:
            all_evidence.extend(c.evidence_chunks)

        winner.evidence_chunks = all_evidence
        resolved[sku] = winner

    return resolved
