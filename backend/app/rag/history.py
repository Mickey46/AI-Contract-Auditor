"""
Persist completed audit reports to data/history/ as JSON + CSV.

Files written per job:
  data/history/{job_id}.json  — full AuditReport (for re-loading)
  data/history/{job_id}.csv   — audit rows in spec format (for download)
  data/history/{job_id}.meta  — lightweight summary line for fast listing
"""

from __future__ import annotations
import csv
import io
import json
import os
from datetime import datetime, timezone

from app.models.schemas import AuditReport

# Resolve absolute path so it works regardless of CWD
_HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "..", "data", "history"))
os.makedirs(HISTORY_DIR, exist_ok=True)


def _json_path(job_id: str) -> str:
    return os.path.join(HISTORY_DIR, f"{job_id}.json")


def _csv_path(job_id: str) -> str:
    return os.path.join(HISTORY_DIR, f"{job_id}.csv")


def save_report(report: AuditReport) -> None:
    """Write .json and .csv for a completed audit job."""
    # Full report JSON
    with open(_json_path(report.job_id), "w") as f:
        json.dump(report.model_dump(), f, default=str)

    # CSV — same format as the download endpoint
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "invoice_id", "line_id", "sku", "field_checked",
        "expected_value", "actual_value", "delta", "status",
        "explanation", "evidence",
    ])
    for row in report.rows:
        evidence_str = "; ".join(ev.location_label for ev in row.evidence[:2])
        writer.writerow([
            row.invoice_id, row.line_id, row.sku, row.field_checked,
            row.expected_value, row.actual_value, row.delta, row.status,
            row.explanation, evidence_str,
        ])
    with open(_csv_path(report.job_id), "w", newline="") as f:
        f.write(buf.getvalue())


def load_report(job_id: str) -> "AuditReport | None":
    """Load a persisted report from disk. Returns None if not found."""
    path = _json_path(job_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            data = json.load(f)
        return AuditReport.model_validate(data)
    except Exception:
        return None


def get_csv_path(job_id: str) -> "str | None":
    """Return path to pre-saved CSV if it exists, else None."""
    path = _csv_path(job_id)
    return path if os.path.exists(path) else None


def list_reports() -> list[dict]:
    """
    Scan HISTORY_DIR for *.json files and return lightweight summaries,
    sorted newest-first by file modification time.
    """
    summaries: list[dict] = []
    try:
        files = [f for f in os.listdir(HISTORY_DIR) if f.endswith(".json")]
    except OSError:
        return []

    for fname in files:
        job_id = fname[:-5]  # strip .json
        path = os.path.join(HISTORY_DIR, fname)
        try:
            mtime = os.path.getmtime(path)
            completed_at = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
            with open(path) as f:
                data = json.load(f)
            summaries.append({
                "job_id":       job_id,
                "invoice_file": data.get("invoice_file", ""),
                "contract_files": data.get("contract_files", []),
                "pass_count":   data.get("pass_count", 0),
                "fail_count":   data.get("fail_count", 0),
                "warn_count":   data.get("warn_count", 0),
                "total_lines":  data.get("total_lines", 0),
                "model_used":   data.get("model_used"),
                "completed_at": completed_at,
            })
        except Exception:
            continue

    summaries.sort(key=lambda s: s["completed_at"], reverse=True)
    return summaries
