"""FastAPI routes: POST /api/audit, GET /api/audit/{id}, GET /audit/{id}/download, POST /api/ask."""

from __future__ import annotations
import asyncio
import csv
import io
import os
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.models.schemas import JobStatus, QAResponse
from app.rag.ingestion import ingest_documents
from app.rag.embedder import embed_chunks
from app.parsers.csv_parser import parse_invoice
from app.agents.extractor import extract_contract_term
from app.agents.comparator import compare_invoice
from app.agents.reporter import build_report
from app.config import resolve_reasoning_model
from app.chains.qa_chain import run_qa

router = APIRouter()

_jobs: dict[str, JobStatus] = {}
_vectorstores: dict[str, object] = {}

UPLOAD_DIR = "/tmp/contract_auditor_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


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

        # 1. Parse invoice (gives us SKUs + descriptions for free)
        invoice_lines = parse_invoice(invoice_path)
        sku_to_desc: dict[str, str] = {}
        for line in invoice_lines:
            sku_to_desc.setdefault(line.sku, line.description)

        # 2. Ingest contract docs into chunks (PDF / DOCX / XLSX / EML)
        _jobs[job_id].message = "Ingesting and chunking contract documents..."
        chunks = ingest_documents(contract_paths)

        # 3. Embed chunks into ChromaDB
        _jobs[job_id].message = f"Embedding {len(chunks)} chunks into ChromaDB..."
        collection_name = f"job_{job_id}"
        vectorstore = await asyncio.to_thread(embed_chunks, chunks, collection_name, openai_api_key)
        _vectorstores[job_id] = vectorstore

        # 4. For each unique SKU: retrieve top-K + LLM extraction
        contract_terms = {}
        for sku, desc in sku_to_desc.items():
            _jobs[job_id].message = f"Extracting contract terms for {sku}..."
            term = await asyncio.to_thread(
                extract_contract_term, sku, desc, vectorstore, openai_api_key
            )
            contract_terms[sku] = term

        # 5. Compare invoice lines vs contract terms
        _jobs[job_id].message = "Comparing invoice against contract terms..."
        audit_rows = compare_invoice(invoice_lines, contract_terms)

        # 6. Build report
        report = build_report(
            job_id=job_id,
            invoice_file=invoice_filename,
            contract_files=contract_filenames,
            rows=audit_rows,
        )
        report.model_used = resolve_reasoning_model(openai_api_key)
        _jobs[job_id] = JobStatus(job_id=job_id, status="done", report=report)

    except Exception as exc:
        import traceback
        _jobs[job_id] = JobStatus(
            job_id=job_id,
            status="error",
            message=f"{exc}\n{traceback.format_exc()}",
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


@router.post("/ask", response_model=QAResponse)
async def ask_question(
    job_id: str = Form(...),
    question: str = Form(...),
    openai_api_key: str = Form(...),
) -> QAResponse:
    if job_id not in _vectorstores:
        raise HTTPException(status_code=404, detail="No indexed documents for this job")
    vectorstore = _vectorstores[job_id]
    return await asyncio.to_thread(run_qa, question, vectorstore, openai_api_key)
