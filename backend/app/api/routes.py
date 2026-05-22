"""FastAPI routes: /api/audit, /api/ask, /api/audit/{job_id}, override, log, download"""

from __future__ import annotations
import asyncio
import csv
import io
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.models.schemas import AuditReport, JobStatus, OverrideRequest, QAResponse
from app.rag.ingestion import ingest_documents
from app.rag.embedder import embed_chunks
from app.rag.bm25_store import build_bm25
from app.parsers.csv_parser import parse_invoice
from app.parsers.structured_pricing import parse_structured_pricing, StructuredPricing
from app.agents.extractor import extract_contract_term
from app.agents.comparator import compare_invoice
from app.agents.reporter import build_report
from app.agents.regex_extractor import extract_findings
from app.agents.effective_date import parse_invoice_date, filter_chunks_by_date
from app.agents.reconciler import reconcile_term
from app.agents.hallucination_guard import verify_evidence
from app.config import resolve_reasoning_model
from app.chains.qa_chain import run_qa

router = APIRouter()

_jobs: dict[str, JobStatus] = {}
_vectorstores: dict[str, object] = {}
_bm25_stores: dict[str, object] = {}

UPLOAD_DIR = "/tmp/contract_auditor_uploads"
AUDIT_LOG_DIR = Path("/tmp/contract_auditor_logs")
os.makedirs(UPLOAD_DIR, exist_ok=True)
AUDIT_LOG_DIR.mkdir(exist_ok=True)

SKU_MAP = {
    "CP-001": "Claims Processing",
    "AP-002": "Appeals Processing",
    "EL-003": "Eligibility Checks",
    "DM-004": "Data Migration",
}


async def _run_audit_job(
    job_id: str,
    contract_paths: list[str],
    invoice_path: str,
    openai_api_key: str,
    contract_filenames: list[str],
    invoice_filename: str,
) -> None:
    try:
        _jobs[job_id] = JobStatus(job_id=job_id, status="running", message="Parsing invoice...")

        # ── Step 1: Parse invoice ─────────────────────────────────────────────
        invoice_lines = parse_invoice(invoice_path)
        invoice_date = parse_invoice_date(invoice_lines[0].invoice_date) if invoice_lines else None
        unique_skus = list({line.sku for line in invoice_lines})

        # ── Step 2: Structured Excel pricing (deterministic ground truth) ─────
        _jobs[job_id].message = "Reading structured pricing tables..."
        structured = StructuredPricing()
        for path in contract_paths:
            if path.lower().endswith((".xlsx", ".xls")):
                sp = parse_structured_pricing(path)
                structured.base_prices.update(sp.base_prices)
                structured.volume_tiers.update(sp.volume_tiers)
                structured.discount_records.extend(sp.discount_records)
                if not structured.source_file:
                    structured.source_file = sp.source_file

        # ── Step 3: Ingest + effective-date filter ────────────────────────────
        _jobs[job_id].message = "Ingesting and chunking documents..."
        all_chunks = ingest_documents(contract_paths)
        kept_chunks, filter_notes = filter_chunks_by_date(all_chunks, invoice_date)

        # ── Step 4: Regex pre-extraction (deterministic) ─────────────────────
        _jobs[job_id].message = f"Pre-extracting terms from {len(kept_chunks)} chunks..."
        regex_findings = extract_findings(kept_chunks)

        # ── Step 5: Embed kept chunks ─────────────────────────────────────────
        _jobs[job_id].message = f"Embedding {len(kept_chunks)} chunks into ChromaDB..."
        collection_name = f"job_{job_id}"
        vectorstore = await asyncio.to_thread(
            embed_chunks, kept_chunks, collection_name, openai_api_key
        )
        _vectorstores[job_id] = vectorstore

        # ── Step 5b: Build BM25 sparse index ─────────────────────────────────
        _jobs[job_id].message = "Building BM25 sparse index for hybrid retrieval..."
        bm25_store = await asyncio.to_thread(build_bm25, kept_chunks, job_id)
        _bm25_stores[job_id] = bm25_store

        # ── Step 6: Per-SKU: LLM extract → hallucination guard → reconcile ───
        all_warnings: list[str] = list(filter_notes)
        normalized = {}
        all_field_decisions = {}

        for sku in unique_skus:
            desc = SKU_MAP.get(sku, sku)
            _jobs[job_id].message = f"Extracting & reconciling terms for {sku}..."

            llm_term = await asyncio.to_thread(
                extract_contract_term, sku, desc, vectorstore, openai_api_key,
                6, bm25_store,
            )

            _, hallucination_warnings = verify_evidence(llm_term.evidence_chunks, kept_chunks)
            all_warnings.extend(hallucination_warnings)

            reconciled, decisions = reconcile_term(
                sku=sku,
                description=desc,
                llm_term=llm_term,
                regex_findings=regex_findings,
                structured_pricing=structured if structured.has_data() else None,
                invoice_date=invoice_date,
                retrieved_chunks=kept_chunks,
            )
            normalized[sku] = reconciled
            all_field_decisions[sku] = decisions

        # ── Step 7: Compare invoice ───────────────────────────────────────────
        _jobs[job_id].message = "Comparing invoice against contract terms..."
        audit_rows = compare_invoice(
            invoice_lines,
            normalized,
            all_field_decisions,
            structured if structured.has_data() else None,
        )

        # ── Step 8: Build report ──────────────────────────────────────────────
        report = build_report(
            job_id=job_id,
            invoice_file=invoice_filename,
            contract_files=contract_filenames,
            rows=audit_rows,
        )
        report.notes = all_warnings
        report.model_used = resolve_reasoning_model(openai_api_key)
        report.total_dollar_exposure = round(
            sum(abs(r.dollar_impact) for r in audit_rows if r.status == "FAIL"), 2
        )
        report.review_required_count = sum(1 for r in audit_rows if r.review_required)

        _jobs[job_id] = JobStatus(job_id=job_id, status="done", report=report)

    except Exception as exc:
        import traceback
        _jobs[job_id] = JobStatus(
            job_id=job_id, status="error", message=f"{exc}\n{traceback.format_exc()}"
        )
        raise


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/audit", response_model=dict)
async def start_audit(
    background_tasks: BackgroundTasks,
    contract_files: list[UploadFile] = File(...),
    invoice_file: UploadFile = File(...),
    openai_api_key: str = Form(...),
) -> dict:
    job_id = str(uuid.uuid4())[:8]
    job_dir = os.path.join(UPLOAD_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    contract_paths: list[str] = []
    contract_filenames: list[str] = []
    for f in contract_files:
        dest = os.path.join(job_dir, f.filename)
        with open(dest, "wb") as out:
            out.write(await f.read())
        contract_paths.append(dest)
        contract_filenames.append(f.filename)

    inv_dest = os.path.join(job_dir, invoice_file.filename)
    with open(inv_dest, "wb") as out:
        out.write(await invoice_file.read())

    _jobs[job_id] = JobStatus(job_id=job_id, status="pending", message="Job queued.")
    background_tasks.add_task(
        _run_audit_job,
        job_id, contract_paths, inv_dest, openai_api_key,
        contract_filenames, invoice_file.filename,
    )
    return {"job_id": job_id}


@router.get("/audit/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str) -> JobStatus:
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return _jobs[job_id]


@router.get("/audit/{job_id}/download")
async def download_audit_csv(job_id: str) -> StreamingResponse:
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = _jobs[job_id]
    if job.status != "done" or not job.report:
        raise HTTPException(status_code=400, detail="Audit not complete")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "invoice_id", "line_id", "sku", "field_checked",
        "expected_value", "actual_value", "delta", "status",
        "confidence", "dollar_impact", "review_required",
        "explanation", "evidence", "override_status", "override_reason",
    ])
    for row in job.report.rows:
        evidence_str = "; ".join(ev.location_label for ev in row.evidence[:2])
        writer.writerow([
            row.invoice_id, row.line_id, row.sku, row.field_checked,
            row.expected_value, row.actual_value, row.delta, row.status,
            f"{row.confidence:.2f}", row.dollar_impact, row.review_required,
            row.explanation, evidence_str,
            row.override_status or "", row.override_reason or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=audit_{job_id}.csv"},
    )


@router.post("/audit/{job_id}/override")
async def override_audit_row(job_id: str, req: OverrideRequest) -> dict:
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = _jobs[job_id]
    if not job.report or req.row_index >= len(job.report.rows):
        raise HTTPException(status_code=400, detail="Row index out of range")

    row = job.report.rows[req.row_index]
    ts = datetime.utcnow().isoformat() + "Z"
    log_entry = {
        "job_id": job_id,
        "row_index": req.row_index,
        "sku": row.sku,
        "field_checked": row.field_checked,
        "original_status": row.status,
        "override_status": req.new_status,
        "reason": req.reason,
        "reviewer": req.reviewer,
        "timestamp": ts,
    }

    row.override_status = req.new_status
    row.override_reason = req.reason
    row.overridden_by = req.reviewer
    row.overridden_at = ts

    log_path = AUDIT_LOG_DIR / f"{job_id}.jsonl"
    with log_path.open("a") as f:
        f.write(json.dumps(log_entry) + "\n")

    # Recompute report summary counts to reflect effective status
    effective = lambda r: r.override_status if r.override_status else r.status
    job.report.pass_count = sum(1 for r in job.report.rows if effective(r) == "PASS")
    job.report.fail_count = sum(1 for r in job.report.rows if effective(r) == "FAIL")
    job.report.warn_count = sum(1 for r in job.report.rows if effective(r) == "WARN")

    return {"ok": True, "log_entry": log_entry}


@router.get("/audit/{job_id}/log")
async def get_audit_log(job_id: str) -> dict:
    log_path = AUDIT_LOG_DIR / f"{job_id}.jsonl"
    if not log_path.exists():
        return {"entries": []}
    entries = []
    with log_path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return {"entries": entries}


@router.post("/ask", response_model=QAResponse)
async def ask_question(
    job_id: str = Form(...),
    question: str = Form(...),
    openai_api_key: str = Form(...),
) -> QAResponse:
    if job_id not in _vectorstores:
        raise HTTPException(status_code=404, detail="No indexed documents for this job")
    vectorstore = _vectorstores[job_id]
    bm25_store = _bm25_stores.get(job_id)
    return await asyncio.to_thread(run_qa, question, vectorstore, openai_api_key, bm25_store)
