"""Parse invoice CSV into structured line items."""

from __future__ import annotations
import csv
from dataclasses import dataclass
from typing import Optional


@dataclass
class InvoiceLine:
    invoice_id: str
    invoice_date: str
    sku: str
    description: str
    quantity: float
    unit_price: float
    discount_percent: float
    tax_percent: float
    total_amount: float
    line_id: int = 0


def parse_invoice(file_path: str) -> list[InvoiceLine]:
    lines: list[InvoiceLine] = []
    with open(file_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, start=1):
            lines.append(
                InvoiceLine(
                    invoice_id=row["invoice_id"].strip(),
                    invoice_date=row["invoice_date"].strip(),
                    sku=row["sku"].strip(),
                    description=row["description"].strip(),
                    quantity=float(row["quantity"]),
                    unit_price=float(row["unit_price"]),
                    discount_percent=float(row["discount_percent"]),
                    tax_percent=float(row["tax_percent"]),
                    total_amount=float(row["total_amount"]),
                    line_id=idx,
                )
            )
    return lines
