"""
Deterministic regex-based extractor — used as a ground-truth cross-check
against the LLM extractor. Walks all chunks and looks for known amendment patterns:

  - "unit price for SKU CP-001 is REVISED from $5.50 to $5.00"
  - "discount ... CP-001 ... 5% → 10%"
  - "5% discount on SKU DM-004"

Returns a partial ContractTerm with whatever fields it can find with high confidence.
The reconciler then compares this to the LLM's answer.
"""

from __future__ import annotations
import re
from typing import Optional
from app.models.schemas import Chunk, EvidenceChunk


# ── Pattern library ────────────────────────────────────────────────────────────

# "unit price for SKU CP-001 is REVISED from $5.50 to $5.00"
# "CP-001 unit price is revised to $5.00"
# Note: "to" is required and the new price MUST contain a decimal to avoid partial matches.
PRICE_REVISION_RE = re.compile(
    r"(?:(?:SKU\s+)?(?P<sku>[A-Z]{2}-\d{3})\b.{0,80}?unit\s+price.{0,60}?"
    r"(?:revised|changed|updated|amended).{0,60}?to\s+\$?(?P<new>\d+\.\d+))"
    r"|(?:unit\s+price.{0,60}?(?:for\s+SKU\s+)?(?P<sku2>[A-Z]{2}-\d{3})\b.{0,60}?"
    r"(?:revised|changed|updated|amended).{0,60}?to\s+\$?(?P<new2>\d+\.\d+))",
    re.IGNORECASE | re.DOTALL,
)

# "5% → 10%" or "5% to 10%" with SKU nearby
DISCOUNT_REVISION_RE = re.compile(
    r"(?P<sku>[A-Z]{2}-\d{3}).{0,150}?"
    r"(?:discount|%).{0,150}?"
    r"(?:from\s+)?(?P<old>\d+)\s*%\s*"
    r"(?:to|→|->|new)\s*"
    r"(?P<new>\d+)\s*%",
    re.IGNORECASE | re.DOTALL,
)

# "5% discount on SKU DM-004" or "DM-004 ... 5% discount"
NEW_DISCOUNT_RE = re.compile(
    r"(?P<num1>\d+)\s*%\s*discount\s+on\s+(?:SKU\s+)?(?P<sku1>[A-Z]{2}-\d{3})"
    r"|(?P<sku2>[A-Z]{2}-\d{3}).{0,80}?(?P<num2>\d+)\s*%\s*discount",
    re.IGNORECASE | re.DOTALL,
)

# Excel/PDF table row: "CP-001 | Claims Processing | $5.50 | 5% | 8%"
TABLE_ROW_RE = re.compile(
    r"(?P<sku>[A-Z]{2}-\d{3})\s*\|\s*(?P<desc>[^|]+?)\s*\|.*?"
    r"\$?(?P<price>\d+\.?\d*)\s*\|\s*(?P<discount>\d+)\s*%?\s*\|\s*(?P<tax>\d+)\s*%?",
    re.IGNORECASE,
)


# ── Result records ─────────────────────────────────────────────────────────────


class RegexFinding:
    def __init__(
        self,
        sku: str,
        field: str,
        value: float,
        source_chunk: Chunk,
        snippet: str,
        precedence: int,
        confidence: float,
    ):
        self.sku = sku
        self.field = field
        self.value = value
        self.source_chunk = source_chunk
        self.snippet = snippet
        self.precedence = precedence
        self.confidence = confidence

    def __repr__(self):
        return (
            f"RegexFinding({self.sku} {self.field}={self.value} "
            f"prec={self.precedence} conf={self.confidence:.2f} src={self.source_chunk.source_file})"
        )


# ── Main entry point ───────────────────────────────────────────────────────────


def extract_findings(chunks: list[Chunk]) -> list[RegexFinding]:
    """Walk all chunks, return every regex-matched field value with metadata."""
    findings: list[RegexFinding] = []

    for chunk in chunks:
        text = chunk.text

        # Price revision (highest confidence — explicit "revised" language)
        for m in PRICE_REVISION_RE.finditer(text):
            sku = m.group("sku") or m.group("sku2")
            new_v = m.group("new") or m.group("new2")
            if sku and new_v:
                findings.append(
                    RegexFinding(
                        sku=sku,
                        field="unit_price",
                        value=float(new_v),
                        source_chunk=chunk,
                        snippet=_window(text, m.start(), m.end()),
                        precedence=chunk.doc_precedence,
                        confidence=0.95,
                    )
                )

        # Discount revision (X% to Y%)
        for m in DISCOUNT_REVISION_RE.finditer(text):
            sku = m.group("sku")
            new_v = m.group("new")
            if sku and new_v:
                findings.append(
                    RegexFinding(
                        sku=sku,
                        field="discount_percent",
                        value=float(new_v),
                        source_chunk=chunk,
                        snippet=_window(text, m.start(), m.end()),
                        precedence=chunk.doc_precedence,
                        confidence=0.95,
                    )
                )

        # New discount (no prior, just "X% discount on SKU")
        for m in NEW_DISCOUNT_RE.finditer(text):
            sku = m.group("sku1") or m.group("sku2")
            num = m.group("num1") or m.group("num2")
            if sku and num:
                findings.append(
                    RegexFinding(
                        sku=sku,
                        field="discount_percent",
                        value=float(num),
                        source_chunk=chunk,
                        snippet=_window(text, m.start(), m.end()),
                        precedence=chunk.doc_precedence,
                        confidence=0.85,
                    )
                )

        # Table row (lower confidence — generic format)
        for m in TABLE_ROW_RE.finditer(text):
            sku = m.group("sku")
            price_val = float(m.group("price"))
            disc_val = float(m.group("discount"))
            tax_val = float(m.group("tax"))
            snippet = _window(text, m.start(), m.end())

            # Skip rows from Volume Tier tables (price=0 or tax>20 indicates a tier table)
            if price_val <= 0.0 or tax_val > 20:
                continue

            findings.append(RegexFinding(
                sku=sku, field="unit_price", value=price_val,
                source_chunk=chunk, snippet=snippet,
                precedence=chunk.doc_precedence, confidence=0.75,
            ))
            # Only add discount if it looks like a real discount (not a volume tier extra %)
            if 0 <= disc_val <= 50:
                findings.append(RegexFinding(
                    sku=sku, field="discount_percent", value=disc_val,
                    source_chunk=chunk, snippet=snippet,
                    precedence=chunk.doc_precedence, confidence=0.75,
                ))
            findings.append(RegexFinding(
                sku=sku, field="tax_percent", value=tax_val,
                source_chunk=chunk, snippet=snippet,
                precedence=chunk.doc_precedence, confidence=0.75,
            ))

    return findings


def authoritative_value(
    findings: list[RegexFinding], sku: str, field: str
) -> Optional[RegexFinding]:
    """Pick the most authoritative finding (lowest precedence number) for a SKU+field."""
    matches = [f for f in findings if f.sku == sku and f.field == field]
    if not matches:
        return None
    matches.sort(key=lambda f: (f.precedence, -f.confidence))
    return matches[0]


def _window(text: str, start: int, end: int, padding: int = 80) -> str:
    s = max(0, start - padding)
    e = min(len(text), end + padding)
    return text[s:e].strip()
