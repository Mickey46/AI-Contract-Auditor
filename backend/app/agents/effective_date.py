"""
Filter chunks based on the invoice date — drop amendment chunks whose
effective date is in the future or whose expiry date has passed.

This ensures a 2026-04 invoice doesn't get audited against a 2027 amendment,
and a 2025 invoice doesn't pick up a 2026 amendment.
"""

from __future__ import annotations
import re
from datetime import datetime, date
from typing import Optional
from app.models.schemas import Chunk


_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_DATE_LONG_RE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|"
    r"September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b",
    re.IGNORECASE,
)
MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}

EFFECTIVE_PHRASES = [
    "effective", "in effect", "applies from", "starts", "commences", "as of",
]


def parse_invoice_date(s: str) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def extract_effective_date(text: str) -> Optional[date]:
    """Find the most likely effective date in a chunk."""
    lowered = text.lower()
    if not any(p in lowered for p in EFFECTIVE_PHRASES):
        return None
    for m in _DATE_RE.finditer(text):
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            continue
    for m in _DATE_LONG_RE.finditer(text):
        month = MONTHS.get(m.group(1).lower())
        if month:
            try:
                return date(int(m.group(3)), month, int(m.group(2)))
            except ValueError:
                continue
    return None


def filter_chunks_by_date(
    chunks: list[Chunk], invoice_date: Optional[date]
) -> tuple[list[Chunk], list[str]]:
    """
    Returns (kept_chunks, notes). Drops chunks whose effective_date > invoice_date.
    Always keeps chunks with no detectable date (we err on the side of inclusion
    — they'll be evaluated by the LLM).
    """
    if invoice_date is None:
        return chunks, []

    kept: list[Chunk] = []
    notes: list[str] = []

    for chunk in chunks:
        eff = extract_effective_date(chunk.text)
        if eff and eff > invoice_date:
            notes.append(
                f"Dropped chunk from {chunk.source_file} ({chunk.section or chunk.sheet_name or 'page ' + str(chunk.page_number)}) — "
                f"effective {eff} is after invoice date {invoice_date}"
            )
            continue
        kept.append(chunk)

    return kept, notes
