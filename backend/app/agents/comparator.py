"""
Production comparator: field-by-field audit with
  - per-field confidence from reconciler decisions
  - volume-tier-aware total computation
  - signed dollar_impact per check
  - review_required flag
"""

from __future__ import annotations
import math
from typing import Optional

from app.models.schemas import ContractTerm, AuditRow
from app.parsers.csv_parser import InvoiceLine
from app.parsers.structured_pricing import StructuredPricing, lookup_volume_tier_discount
from app.config import PRICE_TOLERANCE, CONFIDENCE_REVIEW_THRESHOLD

TOLERANCE = PRICE_TOLERANCE


def _status(delta: float, field: str = "") -> str:
    if abs(delta) <= TOLERANCE:
        return "PASS"
    if field == "total_amount" and abs(delta) < 1.0:
        return "WARN"
    return "FAIL"


def _explain(field: str, expected: float, actual: float, delta: float, term: ContractTerm) -> str:
    if abs(delta) <= TOLERANCE:
        return f"Correct {field}. Matches contract term from {term.source_document}."
    sign = "exceeds" if delta > 0 else "is below"
    return (
        f"Invoice {field} of {actual} {sign} the contract value of {expected} "
        f"(delta: {delta:+.4f}). "
        f"Authoritative source: {term.source_document} (precedence {term.doc_precedence}). "
        f"{term.reasoning or ''}"
    ).strip()


def _compute_expected_total(
    line: InvoiceLine,
    term: ContractTerm,
    structured_pricing: Optional[StructuredPricing],
) -> float:
    tier_disc = 0.0
    if structured_pricing:
        tier_disc = lookup_volume_tier_discount(structured_pricing, line.sku, line.quantity)
    effective_disc = term.discount_percent + tier_disc
    return round(
        line.quantity * term.unit_price * (1 - effective_disc / 100) * (1 + term.tax_percent / 100),
        2,
    )


def _dollar_impact(
    field: str,
    line: InvoiceLine,
    term: ContractTerm,
    structured_pricing: Optional[StructuredPricing],
) -> float:
    qty = line.quantity
    if field == "unit_price":
        return round((line.unit_price - term.unit_price) * qty, 2)
    if field == "discount_percent":
        invoice_net = line.unit_price * (1 - line.discount_percent / 100)
        contract_net = term.unit_price * (1 - term.discount_percent / 100)
        return round((invoice_net - contract_net) * qty, 2)
    if field == "tax_percent":
        base = line.unit_price * (1 - line.discount_percent / 100) * qty
        return round(base * (line.tax_percent - term.tax_percent) / 100, 2)
    if field == "total_amount":
        expected = _compute_expected_total(line, term, structured_pricing)
        return round(line.total_amount - expected, 2)
    return 0.0


def _get_decision_meta(
    field_decisions: dict[str, dict],
    sku: str,
    field: str,
) -> tuple[float, list[str], list[str]]:
    """Return (confidence, sources_agreeing, conflicts_str) from reconciler decisions."""
    decisions = field_decisions.get(sku, {})
    decision = decisions.get(field)
    if decision is None:
        return 0.5, [], []
    confidence = decision.confidence
    sources = decision.sources_agreeing
    conflicts = [f"{name}={v}" for name, v in (decision.conflicts or [])]
    return confidence, sources, conflicts


def compare_invoice_line(
    line: InvoiceLine,
    contract_terms: dict[str, ContractTerm],
    field_decisions: dict[str, dict],
    structured_pricing: Optional[StructuredPricing],
) -> list[AuditRow]:
    rows: list[AuditRow] = []
    sku = line.sku

    if sku not in contract_terms:
        rows.append(AuditRow(
            invoice_id=line.invoice_id, line_id=line.line_id, sku=sku,
            field_checked="sku", expected_value=0, actual_value=0, delta=0,
            status="WARN", explanation=f"SKU {sku} not found in any contract document.",
            evidence=[], confidence=0.0, review_required=True,
            dollar_impact=0.0, quantity=line.quantity,
        ))
        return rows

    term = contract_terms[sku]
    evidence = term.evidence_chunks

    def make_row(field: str, expected: float, actual: float) -> AuditRow:
        delta = round(actual - expected, 4)
        status = _status(delta, field)
        confidence, sources, conflicts = _get_decision_meta(field_decisions, sku, field)
        impact = _dollar_impact(field, line, term, structured_pricing)
        review = confidence < CONFIDENCE_REVIEW_THRESHOLD or status == "FAIL"
        return AuditRow(
            invoice_id=line.invoice_id,
            line_id=line.line_id,
            sku=sku,
            field_checked=field,
            expected_value=expected,
            actual_value=actual,
            delta=delta,
            status=status,
            explanation=_explain(field, expected, actual, delta, term),
            evidence=evidence,
            confidence=round(confidence, 2),
            review_required=review,
            sources_agreeing=sources,
            conflicts=conflicts,
            dollar_impact=impact,
            quantity=line.quantity,
        )

    rows.append(make_row("unit_price", term.unit_price, line.unit_price))
    rows.append(make_row("discount_percent", term.discount_percent, line.discount_percent))
    rows.append(make_row("tax_percent", term.tax_percent, line.tax_percent))

    # total_amount: compare invoice total against contract-correct total (volume-tier aware)
    expected_total = _compute_expected_total(line, term, structured_pricing)
    rows.append(make_row("total_amount", expected_total, line.total_amount))

    return rows


def compare_invoice(
    invoice_lines: list[InvoiceLine],
    contract_terms: dict[str, ContractTerm],
    field_decisions: Optional[dict[str, dict]] = None,
    structured_pricing: Optional[StructuredPricing] = None,
) -> list[AuditRow]:
    fd = field_decisions or {}
    all_rows: list[AuditRow] = []
    for line in invoice_lines:
        all_rows.extend(compare_invoice_line(line, contract_terms, fd, structured_pricing))
    return all_rows
