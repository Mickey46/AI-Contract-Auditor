from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


class Chunk(BaseModel):
    text: str
    source_file: str
    source_type: str  # pdf | excel | docx | email
    page_number: Optional[int] = None
    sheet_name: Optional[str] = None
    row_range: Optional[str] = None
    section: Optional[str] = None
    chunk_index: int = 0
    doc_precedence: int = 4  # 1=email > 2=docx > 3=excel > 4=pdf


class EvidenceChunk(BaseModel):
    source_file: str
    page_number: Optional[int] = None
    sheet_name: Optional[str] = None
    row_range: Optional[str] = None
    section: Optional[str] = None
    excerpt: str
    doc_precedence: int
    superseded_by: Optional[str] = None
    similarity_score: Optional[float] = None

    @property
    def location_label(self) -> str:
        parts = [self.source_file]
        if self.sheet_name:
            parts.append(self.sheet_name)
            if self.row_range:
                parts.append(f"Row {self.row_range}")
        elif self.page_number is not None:
            parts.append(f"Page {self.page_number}")
        elif self.section:
            parts.append(self.section)
        return " — ".join(parts)


class ContractTerm(BaseModel):
    sku: str
    description: str
    unit_price: float
    discount_percent: float
    tax_percent: float
    effective_date: Optional[str] = None
    source_document: str
    doc_precedence: int
    reasoning: Optional[str] = None
    evidence_chunks: list[EvidenceChunk] = Field(default_factory=list)
    superseded_by: Optional[str] = None


class AuditRow(BaseModel):
    """The exact spec output: invoice_id, line_id, sku, field_checked, expected, actual, delta, status, explanation, evidence."""
    invoice_id: str
    line_id: int
    sku: str
    field_checked: str
    expected_value: float
    actual_value: float
    delta: float
    status: str  # PASS | FAIL | WARN
    explanation: str
    evidence: list[EvidenceChunk] = Field(default_factory=list)


class AuditReport(BaseModel):
    model_config = {"protected_namespaces": ()}

    job_id: str
    invoice_file: str
    contract_files: list[str]
    total_lines: int
    pass_count: int
    fail_count: int
    warn_count: int
    rows: list[AuditRow]
    model_used: Optional[str] = None


class QASource(BaseModel):
    source_file: str
    page_number: Optional[int] = None
    sheet_name: Optional[str] = None
    row_range: Optional[str] = None
    section: Optional[str] = None
    excerpt: str

    @property
    def location_label(self) -> str:
        parts = [self.source_file]
        if self.sheet_name:
            parts.append(self.sheet_name)
            if self.row_range:
                parts.append(f"Row {self.row_range}")
        elif self.page_number is not None:
            parts.append(f"Page {self.page_number}")
        elif self.section:
            parts.append(self.section)
        return " — ".join(parts)


class QAResponse(BaseModel):
    question: str
    answer: str
    sources: list[QASource]


class JobStatus(BaseModel):
    job_id: str
    status: str  # pending | running | done | error
    message: Optional[str] = None
    report: Optional[AuditReport] = None
