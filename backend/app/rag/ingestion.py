"""Orchestrate document ingestion: detect format, parse, return chunks."""

from __future__ import annotations
import os
from app.models.schemas import Chunk
from app.parsers.pdf_parser import parse_pdf
from app.parsers.excel_parser import parse_excel
from app.parsers.docx_parser import parse_docx
from app.parsers.email_parser import parse_email


def ingest_documents(file_paths: list[str]) -> list[Chunk]:
    all_chunks: list[Chunk] = []
    for path in file_paths:
        ext = os.path.splitext(path)[1].lower()
        if ext == ".pdf":
            chunks = parse_pdf(path)
        elif ext in (".xlsx", ".xls"):
            chunks = parse_excel(path)
        elif ext == ".docx":
            chunks = parse_docx(path)
        elif ext == ".eml":
            chunks = parse_email(path)
        else:
            continue
        all_chunks.extend(chunks)
    return all_chunks
