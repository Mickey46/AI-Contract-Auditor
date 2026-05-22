"""
Hallucination guard: verify that LLM-cited evidence excerpts actually appear
in the retrieved source chunks. Uses fuzzy token-set matching since LLMs may
paraphrase slightly even when instructed to quote verbatim.
"""

from __future__ import annotations
import re
from app.models.schemas import EvidenceChunk, Chunk
from app.config import EXCERPT_FUZZY_MATCH_RATIO


_TOKEN_RE = re.compile(r"[A-Za-z0-9$%.\-]+")


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN_RE.findall(text) if len(t) > 1}


def excerpt_overlap_ratio(excerpt: str, source_text: str) -> float:
    """
    Returns the ratio of tokens in `excerpt` that also appear in `source_text`.
    1.0 = every word of the excerpt is in the source.
    """
    ex_tokens = _tokens(excerpt)
    if not ex_tokens:
        return 0.0
    src_tokens = _tokens(source_text)
    overlap = ex_tokens & src_tokens
    return len(overlap) / len(ex_tokens)


def verify_evidence(
    evidence: list[EvidenceChunk],
    source_chunks: list[Chunk],
) -> tuple[list[EvidenceChunk], list[str]]:
    """
    Returns (verified_evidence, warnings).

    For each LLM evidence item, check the excerpt against the chunks for the
    same source_file. If overlap ratio is below threshold, mark as suspect
    (do not drop — we don't want to hide weak evidence — but warn).
    """
    warnings: list[str] = []
    verified: list[EvidenceChunk] = []

    by_file: dict[str, str] = {}
    for c in source_chunks:
        by_file[c.source_file] = by_file.get(c.source_file, "") + "\n" + c.text

    for ev in evidence:
        if not ev.excerpt:
            verified.append(ev)
            continue
        haystack = by_file.get(ev.source_file, "")
        if not haystack:
            warnings.append(
                f"Evidence cites '{ev.source_file}' but no chunks for that file were retrieved."
            )
            verified.append(ev)
            continue
        ratio = excerpt_overlap_ratio(ev.excerpt, haystack)
        if ratio < EXCERPT_FUZZY_MATCH_RATIO:
            warnings.append(
                f"Low excerpt overlap ({ratio:.0%}) in {ev.source_file}: '{ev.excerpt[:80]}...'"
            )
        verified.append(ev)

    return verified, warnings


def cross_check_value(
    field: str,
    llm_value: float,
    source_chunks: list[Chunk],
) -> bool:
    """
    Sanity check: does the LLM's numeric answer literally appear anywhere in
    the retrieved chunks? If a number isn't in any chunk, it's a hallucination.

    Tolerance: matches integer or one-decimal versions.
    """
    candidates = [
        f"{llm_value:g}",
        f"{llm_value:.1f}",
        f"{llm_value:.2f}",
        f"{int(llm_value)}" if llm_value == int(llm_value) else None,
    ]
    candidates = [c for c in candidates if c is not None]

    haystack = " ".join(c.text for c in source_chunks)
    return any(c in haystack for c in candidates)
