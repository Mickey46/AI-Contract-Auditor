"""
Reconciler: combine structured Excel parser + regex extractor + LLM extractor.
Produces a final ContractTerm with a confidence score per field.

Confidence rules:
  - 1.00  : structured Excel + regex + LLM all agree
  - 0.95  : structured Excel + regex agree, LLM didn't see it
  - 0.92  : regex + LLM agree (no structured source)
  - 0.85  : LLM only, but value found verbatim in retrieved chunks
  - 0.65  : LLM only, value not literally in chunks (likely paraphrased)
  - 0.50  : structured Excel only (LLM/regex silent)
  - 0.40  : conflict between sources — flagged for review
"""

from __future__ import annotations
import math
from datetime import date
from typing import Optional
from app.models.schemas import ContractTerm, EvidenceChunk, Chunk
from app.agents.regex_extractor import RegexFinding, authoritative_value
from app.agents.hallucination_guard import cross_check_value
from app.parsers.structured_pricing import (
    StructuredPricing,
    BasePriceRecord,
    DiscountRecord,
    authoritative_discount,
)


PRECEDENCE_NAMES = {
    1: "Email Addendum",
    2: "DOCX Amendment",
    3: "Excel Sheet",
    4: "PDF Contract",
}


class FieldDecision:
    def __init__(
        self,
        field: str,
        value: float,
        confidence: float,
        rationale: str,
        sources_agreeing: list[str],
        conflicts: list[tuple[str, float]],
    ):
        self.field = field
        self.value = value
        self.confidence = confidence
        self.rationale = rationale
        self.sources_agreeing = sources_agreeing
        self.conflicts = conflicts


def _equal(a: float, b: float, tol: float = 0.01) -> bool:
    return math.isclose(a, b, abs_tol=tol)


def reconcile_field(
    field: str,
    llm_value: Optional[float],
    llm_precedence: int,
    regex_finding: Optional[RegexFinding],
    structured_value: Optional[float],
    structured_source: Optional[str],
    retrieved_chunks: list[Chunk],
) -> FieldDecision:
    """
    Cross-check three sources for a single field and compute confidence.
    Priority is precedence-aware (lower number = higher authority):
      1 = email addendum, 2 = DOCX amendment, 3 = Excel, 4 = PDF.
    The highest-priority source that provides a value wins.
    Structured Excel is treated as precedence 3 (same as Excel sheet).
    """
    # Build candidate pool: (precedence, name, value)
    candidates: list[tuple[int, str, float]] = []
    if structured_value is not None:
        candidates.append((3, "structured_excel", structured_value))
    if regex_finding is not None:
        candidates.append((regex_finding.precedence, "regex", regex_finding.value))
    if llm_value is not None:
        candidates.append((llm_precedence, "llm", llm_value))

    if not candidates:
        return FieldDecision(
            field=field,
            value=0.0,
            confidence=0.0,
            rationale=f"No source produced a value for {field}.",
            sources_agreeing=[],
            conflicts=[],
        )

    # Authoritative = highest priority (lowest precedence number)
    candidates_sorted = sorted(candidates, key=lambda x: x[0])
    chosen_prec, chosen_source, chosen_value = candidates_sorted[0]

    sources_agreeing: list[str] = []
    conflicts: list[tuple[str, float]] = []
    for prec, name, val in candidates:
        if _equal(val, chosen_value):
            sources_agreeing.append(name)
        else:
            conflicts.append((name, val))

    has_struct = structured_value is not None
    has_regex = regex_finding is not None
    has_llm = llm_value is not None
    no_conflicts = len(conflicts) == 0

    rationale_parts: list[str] = []
    confidence = 0.0

    if has_struct and has_regex and has_llm and no_conflicts:
        confidence = 1.00
        rationale_parts.append("All three sources (structured Excel, regex, LLM) agree.")
    elif has_struct and has_regex and no_conflicts:
        confidence = 0.95
        rationale_parts.append("Structured Excel and regex agree.")
    elif has_regex and has_llm and no_conflicts:
        confidence = 0.92
        rationale_parts.append("Regex and LLM agree.")
    elif has_llm and no_conflicts and cross_check_value(field, llm_value, retrieved_chunks):
        confidence = 0.85
        rationale_parts.append("LLM value verified verbatim in source chunks.")
    elif has_struct and no_conflicts:
        confidence = 0.75
        rationale_parts.append("Structured Excel only (LLM/regex silent).")
    elif has_llm:
        confidence = 0.55
        rationale_parts.append("LLM only; value not literally in chunks.")

    # Only penalise for conflicts where the competing source has EQUAL OR HIGHER priority
    real_conflicts = [(n, v) for prec, n, v in candidates if not _equal(v, chosen_value) and prec <= chosen_prec]
    ambiguous_conflicts = [(n, v) for prec, n, v in candidates if not _equal(v, chosen_value) and prec > chosen_prec]

    if real_conflicts:
        confidence = min(confidence, 0.40)
        for name, val in real_conflicts:
            rationale_parts.append(
                f"REAL CONFLICT: {name} returned {val} vs chosen={chosen_value}."
            )
    elif ambiguous_conflicts:
        # Lower-priority source disagrees (expected, e.g. Excel vs DOCX amendment)
        # Boost confidence for precedence overrides by LLM from high-priority doc
        if chosen_prec <= 2:
            confidence = max(confidence, 0.80)
        for name, val in ambiguous_conflicts:
            rationale_parts.append(
                f"Lower-priority source {name}={val} overridden by {chosen_source}={chosen_value} (prec {chosen_prec})."
            )

    rationale_parts.insert(0, f"[auth={chosen_source}, prec={chosen_prec}]")

    return FieldDecision(
        field=field,
        value=chosen_value,
        confidence=round(confidence, 2),
        rationale=" ".join(rationale_parts),
        sources_agreeing=sources_agreeing,
        conflicts=conflicts,
    )


def reconcile_term(
    sku: str,
    description: str,
    llm_term: ContractTerm,
    regex_findings: list[RegexFinding],
    structured_pricing: Optional[StructuredPricing],
    invoice_date: Optional[date],
    retrieved_chunks: list[Chunk],
) -> tuple[ContractTerm, dict[str, FieldDecision]]:
    """Run reconciliation across all three extraction sources."""
    # Pull structured values
    base_record: Optional[BasePriceRecord] = None
    auth_discount: Optional[DiscountRecord] = None
    if structured_pricing:
        base_record = structured_pricing.base_prices.get(sku)
        auth_discount = authoritative_discount(structured_pricing, sku, invoice_date)

    # Pull regex findings per field
    rx_price = authoritative_value(regex_findings, sku, "unit_price")
    rx_disc = authoritative_value(regex_findings, sku, "discount_percent")
    rx_tax = authoritative_value(regex_findings, sku, "tax_percent")

    # Reconcile each field
    decisions: dict[str, FieldDecision] = {}

    llm_prec = llm_term.doc_precedence if llm_term.doc_precedence else 4

    decisions["unit_price"] = reconcile_field(
        field="unit_price",
        llm_value=llm_term.unit_price,
        llm_precedence=llm_prec,
        regex_finding=rx_price,
        structured_value=base_record.unit_price if base_record else None,
        structured_source=base_record.source_file if base_record else None,
        retrieved_chunks=retrieved_chunks,
    )

    # For discount, use the amendment-aware authoritative discount as structured value
    structured_disc = (
        auth_discount.discount_percent
        if auth_discount
        else (base_record.discount_percent if base_record else None)
    )
    # Override structured discount precedence: if from amendment, treat as prec 2; email → 1
    if auth_discount:
        if "email" in (auth_discount.discount_type or "").lower():
            disc_prec = 1
        elif "amendment" in (auth_discount.discount_type or "").lower():
            disc_prec = 2
        else:
            disc_prec = 3
    else:
        disc_prec = 3

    decisions["discount_percent"] = reconcile_field(
        field="discount_percent",
        llm_value=llm_term.discount_percent,
        llm_precedence=llm_prec,
        regex_finding=rx_disc,
        # Use auth_discount as a structured source with correct precedence
        structured_value=structured_disc,
        structured_source=(
            auth_discount.source_document if auth_discount
            else (base_record.source_file if base_record else None)
        ),
        retrieved_chunks=retrieved_chunks,
    )
    # Override precedence for discount field's structured_excel to reflect amendment doc
    if structured_disc is not None and auth_discount:
        # Rebuild candidates with correct precedence for the auth_discount source
        disc_candidates: list[tuple[int, str, float]] = []
        disc_candidates.append((disc_prec, "structured_excel", structured_disc))
        if rx_disc:
            disc_candidates.append((rx_disc.precedence, "regex", rx_disc.value))
        if llm_term.discount_percent is not None:
            disc_candidates.append((llm_prec, "llm", llm_term.discount_percent))

        disc_sorted = sorted(disc_candidates, key=lambda x: x[0])
        best_disc_prec, best_disc_src, best_disc_val = disc_sorted[0]
        decisions["discount_percent"].value = best_disc_val
        decisions["discount_percent"].sources_agreeing = [
            n for p, n, v in disc_candidates if _equal(v, best_disc_val)
        ]
        # Only flag real conflicts: same or higher priority disagreeing
        real_disc_conflicts = [
            (n, v) for p, n, v in disc_candidates
            if not _equal(v, best_disc_val) and p <= best_disc_prec
        ]
        decisions["discount_percent"].conflicts = real_disc_conflicts
        if not real_disc_conflicts:
            # High-priority sources agree — boost confidence
            n_agreeing = len(decisions["discount_percent"].sources_agreeing)
            decisions["discount_percent"].confidence = max(
                decisions["discount_percent"].confidence,
                0.95 if n_agreeing >= 2 else 0.85,
            )

    # Tax rate is defined in Excel pricing tables and rarely changes via amendment.
    # LLMs frequently hallucinate tax values from nearby discount percentages.
    # Force LLM precedence to 4 (lowest) for tax so structured Excel always wins
    # unless regex explicitly confirms a tax change in the documents.
    decisions["tax_percent"] = reconcile_field(
        field="tax_percent",
        llm_value=llm_term.tax_percent,
        llm_precedence=4,  # Excel (prec=3) always overrides LLM for tax
        regex_finding=rx_tax,
        structured_value=base_record.tax_percent if base_record else None,
        structured_source=base_record.source_file if base_record else None,
        retrieved_chunks=retrieved_chunks,
    )

    # Build the reconciled term — chosen values from decisions
    final_source = llm_term.source_document
    final_precedence = llm_term.doc_precedence
    if auth_discount:
        final_source = auth_discount.source_document or final_source
        # If discount source is an amendment, surface its precedence
        if "amendment" in (auth_discount.discount_type or "").lower():
            final_precedence = min(final_precedence, 2)
        if "email" in (auth_discount.discount_type or "").lower():
            final_precedence = min(final_precedence, 1)

    reasoning = " | ".join(
        f"{f}: {d.rationale}" for f, d in decisions.items()
    )

    reconciled = ContractTerm(
        sku=sku,
        description=description,
        unit_price=decisions["unit_price"].value,
        discount_percent=decisions["discount_percent"].value,
        tax_percent=decisions["tax_percent"].value,
        effective_date=llm_term.effective_date,
        source_document=final_source,
        doc_precedence=final_precedence,
        reasoning=reasoning,
        evidence_chunks=llm_term.evidence_chunks,
    )

    return reconciled, decisions
