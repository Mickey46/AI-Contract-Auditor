"""Central configuration: model selection, thresholds, fallbacks."""

from __future__ import annotations
import os
from openai import OpenAI

# Primary reasoning model (set via env or fallback chain).
# Tries gpt-5.5-thinking first, falls back to o3, then gpt-4o.
PREFERRED_REASONING_MODELS = [
    os.getenv("AUDITOR_REASONING_MODEL", "gpt-5.5-thinking"),
    "o3",
    "o4-mini",
    "gpt-4o",
]

# Fast model for QA chat (latency over reasoning depth)
QA_MODEL_CANDIDATES = [
    os.getenv("AUDITOR_QA_MODEL", "gpt-4o"),
    "gpt-4-turbo",
]

EMBEDDING_MODEL = "text-embedding-3-large"

# Comparator thresholds
PRICE_TOLERANCE = 0.01            # PASS if abs(delta) ≤ this
TOTAL_TOLERANCE_ROUNDING = 1.00   # WARN if total delta < this, FAIL if larger

# Confidence scoring
CONFIDENCE_REVIEW_THRESHOLD = 0.85  # rows below this need human review

# Hallucination guard
EXCERPT_FUZZY_MATCH_RATIO = 0.70  # excerpt must overlap source by at least this


_model_cache: dict[str, str] = {}


def _model_works(model: str, api_key: str) -> bool:
    """Cheap probe to confirm a model is available for this account.
    
    Sends a minimal request without token-limit params to stay compatible
    across SDK versions (1.x doesn't support max_completion_tokens for o-series).
    """
    if model in _model_cache:
        return _model_cache[model] == "ok"
    client = OpenAI(api_key=api_key)
    try:
        client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "reply ok"}],
        )
        _model_cache[model] = "ok"
        return True
    except Exception:
        _model_cache[model] = "fail"
        return False


def resolve_reasoning_model(api_key: str) -> str:
    """Pick the best available reasoning model for the given API key."""
    for model in PREFERRED_REASONING_MODELS:
        if _model_works(model, api_key):
            return model
    return "gpt-4o"


def resolve_qa_model(api_key: str) -> str:
    for model in QA_MODEL_CANDIDATES:
        if _model_works(model, api_key):
            return model
    return "gpt-4o"


def supports_temperature(model: str) -> bool:
    """Reasoning models (o-series, gpt-5.x-thinking) reject temperature param."""
    if model.startswith("o"):
        return False
    if "thinking" in model.lower():
        return False
    return True
