"""Parse PDF files into page-aware chunks with metadata."""

from __future__ import annotations
import pdfplumber
from app.models.schemas import Chunk


def parse_pdf(file_path: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    filename = file_path.split("/")[-1]

    with pdfplumber.open(file_path) as pdf:
        for page_num, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""

            # Also extract table data as text rows
            for table in page.extract_tables():
                for row in table:
                    row_text = " | ".join(str(c) if c else "" for c in row)
                    text += f"\n{row_text}"

            text = text.strip()
            if not text:
                continue

            # Split large pages into sub-chunks (~500 chars with 50 overlap)
            sub_chunks = _split_text(text, chunk_size=500, overlap=50)
            for idx, sub in enumerate(sub_chunks):
                chunks.append(
                    Chunk(
                        text=sub,
                        source_file=filename,
                        source_type="pdf",
                        page_number=page_num,
                        chunk_index=idx,
                        doc_precedence=4,
                    )
                )

    return chunks


def _split_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start += chunk_size - overlap

    return chunks
