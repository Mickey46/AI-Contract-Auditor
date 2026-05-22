"""
FastAPI routes — async audit pipeline with:
  • WebSocket endpoint /ws/audit/{job_id}: real-time push instead of polling
  • asyncio.gather() for parallel per-SKU LLM extraction (all SKUs run concurrently)
  • asyncio.to_thread() for every blocking I/O operation (ingest, embed, extract)
  • Completed reports persisted to data/history/ (JSON + CSV) for history API
"""

from __future__ import annotations
import asyncio
import os
import uuid

_ENV_API_KEY = os.getenv("OPENAI_API_KEY", "")

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse

from app.models.schemas import JobStatus, QAResponse
from app.rag.ingestion import ingest_documents
from app.rag.embedder import embed_chunks
from app.rag.history import save_report, load_report, list_reports, get_csv_path
from app.parsers.csv_parser import parse_invoice
from app.agents.extractor import extract_contract_term
from app.agents.comparator import compare_invoice
from app.agents.reporter import build_report
from app.config import resolve_reasoning_model
from app.chains.qa_chain import run_qa

router = APIRouter()

_jobs: dict[str, JobStatus] = {}
_vectorstores: dict[str, object] = {}
_subscribers: dict[str, list[WebSocket]] = {}  # job_id → open WebSocket connections

UPLOAD_DIR = "/tmp/contract_auditor_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ── WebSocket broadcast helpers ────────────────────────────────────────────────

async def _broadcast(job_id: str) -> None:
    """Push current job state to every WebSocket subscriber for this job."""
    if job_id not in _jobs:
        return
    payload = _jobs[job_id].model_dump_json()
    dead: list[WebSocket] = []
    for ws in _subscribers.get(job_id, []):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _subscribers[job_id].remove(ws)


async def _notify(job_id: str, message: str) -> None:
    """Update job status message and broadcast to subscribers."""
    current = _jobs.get(job_id)
    _jobs[job_id] = JobStatus(
        job_id=job_id,
        status="running",
        message=message,
        report=current.report if current else None,
    )
    await _broadcast(job_id)


# ── Audit pipeline ─────────────────────────────────────────────────────────────

async def _run_audit_job(
    job_id: str,
    contract_paths: list[str],
    invoice_path: str,
    openai_api_key: str,
    contract_filenames: list[str],
    invoice_filename: str,
) -> None:
    try:
        await _notify(job_id, "Parsing invoice...")

        # 1. Parse invoice CSV — sync, fast
        invoice_lines = parse_invoice(invoice_path)
        sku_to_desc: dict[str, str] = {}
        for line in invoice_lines:
            sku_to_desc.setdefault(line.sku, line.description)

        # 2. Ingest contract docs — wrapped in thread so it doesn't block the event loop
        await _notify(job_id, f"Ingesting {len(contract_paths)} contract file(s)...")
        chunks = await asyncio.to_thread(ingest_documents, contract_paths)

        # 3. Embed into ChromaDB — network + disk I/O, runs in thread
        await _notify(job_id, f"Embedding {len(chunks)} chunks into ChromaDB...")
        collection_name = f"job_{job_id}"
        vectorstore = await asyncio.to_thread(embed_chunks, chunks, collection_name, openai_api_key)
        _vectorstores[job_id] = vectorstore

        # 4. Parallel per-SKU LLM extraction — all SKUs run concurrently via gather()
        skus = list(sku_to_desc.items())
        completed = 0
        lock = asyncio.Lock()

        async def _extract_one(sku: str, desc: str):
            nonlocal completed
            term = await asyncio.to_thread(
                extract_contract_term, sku, desc, vectorstore, openai_api_key
            )
            async with lock:
                completed += 1
                await _notify(job_id, f"Extracted {sku} ({completed}/{len(skus)})")
            return sku, term

        await _notify(job_id, f"Extracting contract terms for {len(skus)} SKU(s) in parallel...")
        results = await asyncio.gather(*[_extract_one(sku, desc) for sku, desc in skus])
        contract_terms = dict(results)

        # 5. Compare — pure Python, fast
        await _notify(job_id, "Comparing invoice lines against contract terms...")
        audit_rows = compare_invoice(invoice_lines, contract_terms)

        # 6. Build and publish final report
        report = build_report(
            job_id=job_id,
            invoice_file=invoice_filename,
            contract_files=contract_filenames,
            rows=audit_rows,
        )
        report.model_used = resolve_reasoning_model(openai_api_key)
        _jobs[job_id] = JobStatus(job_id=job_id, status="done", report=report)

        # 7. Persist to disk (non-blocking) — survives server restarts
        await asyncio.to_thread(save_report, report)

        await _broadcast(job_id)

    except Exception as exc:
        import traceback
        _jobs[job_id] = JobStatus(
            job_id=job_id,
            status="error",
            message=f"{exc}\n{traceback.format_exc()}",
        )
        await _broadcast(job_id)
        raise


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

@router.post("/audit", response_model=dict)
async def start_audit(
    background_tasks: BackgroundTasks,
    contract_files: list[UploadFile] = File(...),
    invoice_file: UploadFile = File(...),
    openai_api_key: str = Form(""),
) -> dict:
    # Allow env-based key so users don't have to paste it every time
    effective_key = openai_api_key.strip() or _ENV_API_KEY
    if not effective_key:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="OpenAI API key required. Set it in the upload panel or in backend/.env")
    openai_api_key = effective_key
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
    # Check in-memory first (live or recent job)
    if job_id in _jobs:
        return _jobs[job_id]
    # Fall back to disk — survives server restarts
    report = await asyncio.to_thread(load_report, job_id)
    if report:
        return JobStatus(job_id=job_id, status="done", report=report)
    raise HTTPException(status_code=404, detail="Job not found")


@router.get("/audit/{job_id}/download")
async def download_audit_csv(job_id: str):
    # Serve pre-saved CSV from disk if available (fastest path)
    csv_path = await asyncio.to_thread(get_csv_path, job_id)
    if csv_path:
        return FileResponse(
            csv_path,
            media_type="text/csv",
            filename=f"audit_{job_id}.csv",
        )

    # Fall back to generating from memory (job still running or disk write pending)
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "done" or not job.report:
        raise HTTPException(status_code=400, detail="Audit not complete")

    import csv, io
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "invoice_id", "line_id", "sku", "field_checked",
        "expected_value", "actual_value", "delta", "status",
        "explanation", "evidence",
    ])
    for row in job.report.rows:
        evidence_str = "; ".join(ev.location_label for ev in row.evidence[:2])
        writer.writerow([
            row.invoice_id, row.line_id, row.sku, row.field_checked,
            row.expected_value, row.actual_value, row.delta, row.status,
            row.explanation, evidence_str,
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=audit_{job_id}.csv"},
    )


@router.get("/history")
async def get_history() -> list[dict]:
    """Return a list of all completed audit jobs, newest first."""
    return await asyncio.to_thread(list_reports)


@router.post("/ask", response_model=QAResponse)
async def ask_question(
    job_id: str = Form(...),
    question: str = Form(...),
    openai_api_key: str = Form(""),
) -> QAResponse:
    openai_api_key = openai_api_key.strip() or _ENV_API_KEY
    if job_id not in _vectorstores:
        raise HTTPException(status_code=404, detail="No indexed documents for this job")
    vectorstore = _vectorstores[job_id]
    return await asyncio.to_thread(run_qa, question, vectorstore, openai_api_key)


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

@router.websocket("/ws/audit/{job_id}")
async def ws_audit_status(websocket: WebSocket, job_id: str) -> None:
    """
    Real-time audit progress stream.
    Client connects immediately after POST /audit and receives every status
    update as JSON without polling.
    """
    await websocket.accept()
    _subscribers.setdefault(job_id, []).append(websocket)

    # Send the current state right away (job may already be in progress)
    if job_id in _jobs:
        await websocket.send_text(_jobs[job_id].model_dump_json())

    try:
        # Hold the connection open until the client disconnects.
        # receive_text() blocks until a message or disconnect.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        subs = _subscribers.get(job_id, [])
        if websocket in subs:
            subs.remove(websocket)
