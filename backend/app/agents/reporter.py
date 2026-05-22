"""Assemble the final AuditReport from audit rows."""

from __future__ import annotations
from app.models.schemas import AuditRow, AuditReport


def build_report(
    job_id: str,
    invoice_file: str,
    contract_files: list[str],
    rows: list[AuditRow],
) -> AuditReport:
    pass_count = sum(1 for r in rows if r.status == "PASS")
    fail_count = sum(1 for r in rows if r.status == "FAIL")
    warn_count = sum(1 for r in rows if r.status == "WARN")

    unique_lines = len({(r.invoice_id, r.line_id, r.sku) for r in rows})

    return AuditReport(
        job_id=job_id,
        invoice_file=invoice_file,
        contract_files=contract_files,
        total_lines=unique_lines,
        pass_count=pass_count,
        fail_count=fail_count,
        warn_count=warn_count,
        rows=rows,
    )
