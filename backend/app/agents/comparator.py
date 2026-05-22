"""
Compare invoice lines against extracted contract terms.

For each invoice line we emit four audit rows (one per spec field):
  unit_price, discount_percent, tax_percent, total_amount
"""

from __future__ import annotations

from app.models.schemas import ContractTerm, AuditRow
from app.parsers.csv_parser import InvoiceLine
from app.config import PRICE_TOLERANCE

# WARN if total_amount is off by less than this (likely rounding); FAIL if larger.
TOTAL_ROUNDING_TOLERANCE = 1.0


def _status(delta: float, field: str) -> str:
    if abs(delta) <= PRICE_TOLERANCE:
        return "PASS"
    if field == "total_amount" and abs(delta) < TOTAL_ROUNDING_TOLERANCE:
        return "WARN"
    return "FAIL"


def _explain(field: str, expected: float, actual: float, delta: float, term: ContractTerm) -> str:
    if abs(delta) <= PRICE_TOLERANCE:
        return f"Correct {field}. Matches contract value from {term.source_document}."
    direction = "exceeds" if delta > 0 else "is below"
    base = (
        f"Invoice {field} {actual} {direction} the contract value {expected} "
        f"(delta {delta:+.4f}). Authoritative source: {term.source_document} "
        f"(precedence {term.doc_precedence})."
    )
    if term.reasoning:
        base += f" {term.reasoning}"
    return base


def _expected_total(line: InvoiceLine, term: ContractTerm) -> float:
    return round(
        line.quantity
        * term.unit_price
        * (1 - term.discount_percent / 100)
        * (1 + term.tax_percent / 100),
        2,
    )


def compare_invoice_line(line: InvoiceLine, term: ContractTerm | None) -> list[AuditRow]:
    if term is None:
        return [
            AuditRow(
                invoice_id=line.invoice_id,
                line_id=line.line_id,
                sku=line.sku,
                field_checked="sku",
                expected_value=0,
                actual_value=0,
                delta=0,
                status="WARN",
                explanation=f"SKU {line.sku} not found in any contract document.",
                evidence=[],
            )
        ]

    evidence = term.evidence_chunks
    rows: list[AuditRow] = []

    def make_row(field: str, expected: float, actual: float) -> AuditRow:
        delta = round(actual - expected, 4)
        return AuditRow(
            invoice_id=line.invoice_id,
            line_id=line.line_id,
            sku=line.sku,
            field_checked=field,
            expected_value=expected,
            actual_value=actual,
            delta=delta,
            status=_status(delta, field),
            explanation=_explain(field, expected, actual, delta, term),
            evidence=evidence,
        )

    rows.append(make_row("unit_price", term.unit_price, line.unit_price))
    rows.append(make_row("discount_percent", term.discount_percent, line.discount_percent))
    rows.append(make_row("tax_percent", term.tax_percent, line.tax_percent))
    rows.append(make_row("total_amount", _expected_total(line, term), line.total_amount))
    return rows


def compare_invoice(
    invoice_lines: list[InvoiceLine],
    contract_terms: dict[str, ContractTerm],
) -> list[AuditRow]:
    all_rows: list[AuditRow] = []
    for line in invoice_lines:
        term = contract_terms.get(line.sku)
        all_rows.extend(compare_invoice_line(line, term))
    return all_rows
