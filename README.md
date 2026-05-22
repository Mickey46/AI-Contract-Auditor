# AI Contract Auditor

![License: Personal Reference Only](https://img.shields.io/badge/license-Personal%20Reference%20Only-red)
![No Commercial Use](https://img.shields.io/badge/commercial%20use-prohibited-critical)

I built this for a CVS Health take-home assignment. The problem: organizations store pricing, discounts, and billing rules across a bunch of different documents — PDFs, Excel sheets, DOCX amendments, email threads — and invoices don't always match. I wanted to build something that actually reads all those docs, figures out what the *real* contract terms are (including amendments that override base prices), and flags every mismatch with evidence.

It works on any vendor, any industry. I tested it on both a healthcare claims dataset and a SaaS cloud vendor dataset — same system, zero config changes.

---

## Demo

> [▶ Watch the walkthrough](https://github.com/Mickey46/AI-Contract-Auditor/releases/latest/download/demo.mov)

---

## How it works

Upload your contracts + invoice, hit Run Audit. The backend does five things in order:

```
1. Parse invoice CSV
         ↓
2. Ingest contracts → chunk with metadata
   (PDF page, Excel sheet+row, DOCX section, EML body)
         ↓
3. Embed chunks → ChromaDB (text-embedding-3-large)
         ↓
4. Per-SKU LLM extraction — all SKUs run in parallel
   RAG retrieves top-K chunks per field, stuffs them into
   a prompt with precedence labels, o3 reasons over them
   and returns the authoritative value + which source won
         ↓
5. Compare each invoice field vs contract term → PASS/FAIL
```

The key thing that makes it accurate: every contract document gets a **precedence number** (1=email > 2=DOCX > 3=Excel > 4=PDF). When two docs say different things, the one with the lower number wins. So if a DOCX amendment says CP-001 price is $5.00 but the base PDF still says $5.50, the system picks $5.00 — and shows you exactly where it found it.

Real-time progress streams to the browser via WebSocket so you see each step as it runs.

---

## What I built

**Backend (FastAPI + Python)**
- Document ingestion for PDF (pdfplumber), DOCX (python-docx), Excel (openpyxl), EML
- Each chunk carries: source file, page/sheet/section, row range, and a precedence number
- ChromaDB vector store, one collection per audit job
- LangChain LCEL chain for Contract Q&A
- Parallel per-SKU extraction with `asyncio.gather()` — all SKUs hit the LLM at the same time
- WebSocket endpoint for live progress updates

**Frontend (React + Vite + TypeScript)**
- Slide-out upload drawer (contract drop zone, invoice drop zone)
- Live progress panel — shows each pipeline stage, per-SKU completion chips appearing as they finish, elapsed timer
- Audit table with clickable accordion rows — click any row to expand the full AI explanation + source evidence cards inline (no separate page)
- Contract Q&A tab with suggested questions generated from the actual FAILed rows in the audit
- Nav bar shows live step name while running, then PASS/FAIL summary when done

---

## Dataset 1 — Healthcare Claims (CVS Health scenario)

| File | What it contains |
|------|-----------------|
| `master_contract.pdf` | Base contract — SKU definitions, base pricing |
| `pricing.xlsx` | 3 sheets: Base Pricing, Volume Tiers, Discounts & Amendments |
| `amendment_q2.docx` | Q2 amendment — CP-001 price $5.50→$5.00, discount bumps for CP-001 and EL-003 |
| `email_addendum.eml` | Email addendum — 5% discount added for DM-004 effective 2026-01-01 |
| `invoice_INV-1001.csv` | 4 line items, intentional mismatches |

**What the vendor overbilled:**

| SKU | Field | Contract | Invoice | Why it fails |
|-----|-------|----------|---------|-------------|
| CP-001 | unit_price | $5.00 | $5.50 | DOCX amendment ignored |
| CP-001 | discount_percent | 10% | 5% | Amendment bumped it, invoice didn't |
| EL-003 | discount_percent | 12% | 8% | Same — amendment not applied |
| DM-004 | discount_percent | 5% | 0% | Email addendum completely missed |

Total overcharge: ~$11,000

---

## Dataset 2 — SaaS/Cloud Vendor (NovaTech scenario)

Same system, different industry. Files in `data/dataset2/`.

| File | What it contains |
|------|-----------------|
| `master_saas_contract.pdf` | Base contract — cloud storage, API, support, licensing |
| `saas_pricing.xlsx` | Base pricing + volume tiers + amendment log |
| `saas_amendment_q1.docx` | Q1 2026 amendment — SRV-101 price $0.08→$0.06, LIC-404 discount 15%→20% |
| `novatech_email_addendum.eml` | Email addendum — 5% discount for API-202 |
| `invoice_INV-2001.csv` | 4 line items, intentional mismatches |

Auditor caught all 6 FAILs correctly on the first run.

---

## Stuff I ran into and fixed

**The `--reload` disaster** — ran uvicorn with `--reload` during dev. On macOS, the `watchfiles` library gets FSEvents from the OS for every file touched in the project directory — including the entire `venv/` folder (thousands of langchain, openpyxl, transformers files). The server was restarting 20+ times in a row before any audit even started, killing mid-run WebSocket connections. Fixed by running without `--reload` in any stable session.

**LLM extraction precedence** — early versions let GPT just pick whatever it wanted from the retrieved chunks. It often grabbed base contract prices instead of amendment values. The fix was baking the precedence rules directly into the extraction prompt: every chunk gets labeled with its authority level, and the LLM is explicitly told "lower number wins." That plus requiring JSON output with a `reasoning` field forces it to explain which source it picked — easy to verify.

**WebSocket stale closure** — the `ws.onclose` handler had a stale closure over `jobStatus` state. After a job finished, `stopAll()` closed the socket, which fired `onclose`, which saw the stale `status="running"` and restarted the polling fallback — which then fetched `status="done"` and called `setActiveTab('audit')`, kicking users off the Q&A tab mid-session. Fixed with a `terminalRef` boolean that gets set to `true` the moment a terminal state is reached, so `onclose` skips the polling restart.

---

## Running it

**Prerequisites:** Python 3.9+, Node 18+, an OpenAI API key with access to o3 (or gpt-4o as fallback)

### 1. Set up your API key

The app reads your OpenAI key from a `.env` file — you only set it once.

```bash
# backend
cp backend/.env.example backend/.env
```

Open `backend/.env` and put your key in:

```
OPENAI_API_KEY=sk-proj-your-key-here
```

That's it. The backend picks it up on startup, no need to paste it in the UI every time.

Both `.env` files are already in `.gitignore` so you won't accidentally push your key.

### 2. Start the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Open the app, click **Upload**, drop your contracts + invoice, hit **Run Audit**. Done.

---

## Tech stack

| | |
|--|--|
| LLM | o3 (auto-probed, falls back to gpt-4o) |
| Embeddings | text-embedding-3-large |
| Vector DB | ChromaDB |
| RAG orchestration | LangChain LCEL |
| Backend | FastAPI, Python 3.9, asyncio |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| Parsers | pdfplumber, openpyxl, python-docx |

---

## API

| Method | Path | What it does |
|--------|------|-------------|
| POST | `/api/audit` | Start audit (multipart: contract_files, invoice_file, openai_api_key) |
| GET | `/api/audit/{job_id}` | Poll status + full report (falls back to disk after restart) |
| GET | `/api/audit/{job_id}/download` | Download results as CSV (served from `data/history/`) |
| GET | `/api/history` | List all past audits (newest first) |
| POST | `/api/ask` | Contract Q&A (job_id, question, openai_api_key) |
| WS | `/api/ws/audit/{job_id}` | Live progress stream |

---

*Built by Prajwal N Praju — take-home assignment for CVS Health Innovation Lab*
