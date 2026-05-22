# AI Contract Auditor Agent

![License: Personal Reference Only](https://img.shields.io/badge/license-Personal%20Reference%20Only-red)
![No Commercial Use](https://img.shields.io/badge/commercial%20use-prohibited-critical)

A production-grade, full-stack system that audits invoices against multi-format contract documents using a multi-strategy RAG pipeline — structured parsing, regex extraction, and LLM reasoning — with confidence scoring, override tracking, and a React UI.

---

## Demo

> **Watch the full walkthrough** → [▶ demo.mov](https://github.com/Mickey46/rag/releases/latest/download/demo.mov)

The demo covers:
- Uploading all 4 contract documents (PDF, XLSX, DOCX, EML) + invoice CSV
- Live audit run with real-time progress (embedding → extraction → reconciliation → comparison)
- Audit results table with confidence scores, dollar impact, and source citations
- Evidence drawer showing contract-vs-invoice side-by-side comparison
- AI chat Q&A — asking *"What is the unit price for CP-001?"* and getting a cited answer pinpointing the exact sheet and section
- Manual override flow with reviewer sign-off and audit log

---

## Architecture

```
Contract Documents (PDF, XLSX, DOCX, EML)
         │
         ▼
┌──────────────────────────────────────────┐
│  INGESTION & CHUNKING                    │
│  pdfplumber / openpyxl / python-docx     │
│  Each chunk carries: source_file,        │
│  page_number, sheet_name, row_range,     │
│  section, doc_precedence                 │
└───────────────┬──────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────┐
│  EFFECTIVE-DATE FILTER                   │
│  Drops amendment chunks not yet active  │
│  or expired relative to invoice_date    │
└───────────────┬──────────────────────────┘
                │
         ┌──────┴─────────────────────────┐
         │                                │
         ▼                                ▼
┌─────────────────┐            ┌──────────────────────┐
│ STRUCTURED      │            │ EMBED → CHROMADB     │
│ Excel Parser    │            │ text-embedding-3-    │
│ (deterministic) │            │ large (3072-dim),    │
│ Base prices,    │            │ collection           │
│ volume tiers,   │            └──────────┬───────────┘
│ discount log    │                       │
└────────┬────────┘                       ▼
         │                     ┌──────────────────────┐
         │        ┌────────────│  REGEX EXTRACTOR     │
         │        │            │  Pattern-match on all│
         │        │            │  chunks for price/   │
         │        │            │  discount revisions  │
         │        │            └──────────┬───────────┘
         │        │                       │
         │        │            ┌──────────▼───────────┐
         │        │            │  LLM EXTRACTOR        │
         │        │            │  Per-field RAG query  │
         │        │            │  + gpt-4o/o3/        │
         │        │            │  gpt-5.5-thinking     │
         │        │            └──────────┬───────────┘
         │        │                       │
         │        │            ┌──────────▼───────────┐
         │        │            │  HALLUCINATION GUARD  │
         │        │            │  Fuzzy-verify excerpts│
         │        │            │  exist in source      │
         │        │            └──────────┬───────────┘
         │        │                       │
         └────────┴───────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  RECONCILER (per field)       │
              │  Priority: lower prec# wins   │
              │  1=email > 2=DOCX > 3=Excel   │
              │  > 4=PDF                      │
              │                               │
              │  Confidence:                  │
              │  1.00  all 3 agree            │
              │  0.95  struct + LLM agree     │
              │  0.92  regex + LLM agree      │
              │  0.85  LLM value verbatim     │
              │  0.80  DOCX overrides Excel   │
              │  0.40  real conflict          │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  COMPARATOR                   │
              │  Volume-tier aware totals     │
              │  PASS / FAIL / WARN           │
              │  + dollar_impact per field    │
              │  + confidence, review_flag    │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  REACT UI                     │
              │  Risk Dashboard               │
              │  Audit Table (sorted by conf) │
              │  Side-by-side Comparison      │
              │  Evidence Drawer + Override   │
              │  Audit Trail Log              │
              │  Contract Q&A (RAG)           │
              │  Batch Upload                 │
              └───────────────────────────────┘
```

---

## Dataset

Synthetic but realistic. Generated by `scripts/generate_dataset.py`.

| File | Format | Contents |
|------|--------|----------|
| `master_contract.pdf` | PDF | Base contract — SKU definitions, base pricing, tax/discount policy |
| `pricing.xlsx` | Excel (3 sheets) | Base Pricing · Volume Tiers (multi-row headers) · Discounts & Amendments log |
| `amendment_q2.docx` | DOCX | Q2 amendment — revises CP-001 unit price $5.50→$5.00, increases discounts for CP-001 and EL-003 |
| `email_addendum.eml` | Email | Email addendum — adds 5% discount for DM-004 |
| `invoice_INV-1001.csv` | CSV | 4 line items with **intentional mismatches** |

### Intentional Invoice Mismatches

| SKU | Field | Contract (Expected) | Invoice (Actual) | Why it should FAIL |
|-----|-------|---------------------|------------------|--------------------|
| CP-001 | unit_price | $5.00 (DOCX amendment) | $5.50 | Invoice ignores Q2 amendment |
| CP-001 | discount_percent | 10% (DOCX amendment) | 5% | Using old base rate, not amended rate |
| EL-003 | discount_percent | 12% (DOCX amendment) | 8% | Amendment not applied |
| DM-004 | discount_percent | 5% (email addendum) | 0% | Email addendum completely ignored |
| AP-002 | all fields | correct | correct | Baseline PASS case |

---

## Key Engineering Challenges & How We Solved Them

### Problem 1 — LLM extracts from the wrong (outdated) document
**Issue:** GPT-4o sometimes retrieved and used the base `pricing.xlsx` values instead of the DOCX/email amendments. This caused CP-001 to show discount=5% (old) instead of 10% (amended).

**Solution:** Built a **Reconciler** (`agents/reconciler.py`) that cross-checks three independent extraction strategies and uses document precedence (`1=email > 2=DOCX > 3=Excel > 4=PDF`) to pick the authoritative value. A DOCX amendment always overrides Excel base pricing — regardless of what the LLM returns.

---

### Problem 2 — LLM hallucination / paraphrasing
**Issue:** GPT-4o occasionally cited excerpts that didn't literally exist in the retrieved chunks, or returned 0.0 for fields it couldn't find (ContractTerm has float defaults).

**Solution:**
- **Hallucination Guard** (`agents/hallucination_guard.py`) — fuzzy-matches every LLM-cited excerpt back to source chunks. Flags warnings if the overlap ratio is below 70%.
- **Regex Extractor** (`agents/regex_extractor.py`) — deterministically finds price revision (`"REVISED from $5.50 to $5.00"`) and discount revision (`"5% → 10%"`) patterns directly in text. These findings act as a ground truth check against the LLM.
- **Confidence score** — if LLM is the only source and the value isn't literally in chunks, confidence drops to 0.55. Only when structured Excel + LLM agree does it reach 0.95+.

---

### Problem 3 — Excel volume tier rows matched as pricing rows
**Issue:** The `TABLE_ROW_RE` regex matched Volume Tier sheet rows like `CP-001 | Claims Processing | 0 | 0 | 2 | 4` (tier discount percentages), extracting `price=0.0`, `discount=0`, `tax=2` — all wrong.

**Solution:** Added a guard in `extract_findings`: skip any TABLE_ROW_RE match where `price <= 0.0` or `tax > 20`. Volume tier percentages are small integers; real prices are never zero.

---

### Problem 4 — `_find_col` matched `"discount type"` before `"discount (%)"`
**Issue:** The structured Excel parser's column-finder iterated column-first. For headers `["discount type", "discount (%)"]`, searching needle `"discount"` matched column 2 (`"discount type"`) before column 3 (`"discount (%)"`), so discount values were read from the wrong column — always returning the discount type string instead of the numeric percentage.

**Solution:** Rewrote `_find_col` to iterate **needle-first** across all columns. More specific needles (`"discount (%)"`) are tried across all columns before falling back to the broader `"discount"` needle. Result: the numeric discount column is always found correctly.

---

### Problem 5 — `_find_header_row` matched "SKU" inside sentences
**Issue:** The Volume Tiers sheet has a description row: *"Volume thresholds are measured per SKU per calendar month..."*. The old substring-match found this row as the header (it contains "SKU"), so the actual header row (`SKU | Service | Monthly Volume Threshold...`) was never found, and all volume tier lookups silently returned empty.

**Solution:** Changed `_find_header_row` to **exact cell match** — a cell must equal `"sku"` (or start with it), not merely contain the substring. The description row is skipped; the true header row is correctly identified.

---

### Problem 6 — PRICE_REVISION_RE extracted partial numbers
**Issue:** The regex `(?:to\s+)?\$?(?P<new>\d+\.?\d*)` had `to` as optional and the decimal as optional. On the text `"REVISED from $5.50 to $5.00"`, the greedy `.{0,40}` consumed `"$5.0"` leaving only `"0"` for `(?P<new>...)`, extracting `0.0` instead of `5.00`.

**Solution:** Made `to` **required** (`to\s+`) and required a decimal point (`\d+\.\d+`). Since all monetary prices in this domain have cents (e.g., `5.00`, `3.25`), this constraint eliminates partial matches without losing any real matches.

---

### Problem 7 — Server running stale code
**Issue:** After fixing bugs, the backend was restarted without `--reload`, so all subsequent code changes were invisible to the running process. Jobs submitted after the fixes still showed the old (wrong) `exp=0.0` behaviour.

**Solution:** Always start with `uvicorn app.main:app --reload --port 8000`. The reload watcher picks up file changes automatically during development.

---

## Audit Output Format

```json
{
  "invoice_id": "INV-1001",
  "line_id": 1,
  "sku": "CP-001",
  "field_checked": "unit_price",
  "expected_value": 5.0,
  "actual_value": 5.5,
  "delta": 0.5,
  "status": "FAIL",
  "confidence": 0.80,
  "review_required": true,
  "sources_agreeing": ["regex", "llm"],
  "conflicts": ["structured_excel=5.5"],
  "dollar_impact": 6000.0,
  "quantity": 12000.0,
  "explanation": "Invoice unit_price of 5.5 exceeds the contract value of 5.0 (delta: +0.5). Authoritative source: amendment_q2.docx (precedence 2).",
  "evidence": [
    {
      "source_file": "amendment_q2.docx",
      "section": "Section 2 — Revised Unit Pricing",
      "excerpt": "Effective January 1, 2026, the unit price for SKU CP-001 is REVISED from $5.50 to $5.00.",
      "doc_precedence": 2
    },
    {
      "source_file": "pricing.xlsx",
      "sheet_name": "Base Pricing",
      "row_range": "4-7",
      "doc_precedence": 3,
      "superseded_by": "amendment_q2.docx"
    }
  ]
}
```

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| LLM | GPT-4o / o3 / GPT-5.5-thinking | Auto-probed in order; falls back gracefully |
| Embeddings | **text-embedding-3-large** (OpenAI) | 3072-dim vectors — best accuracy in OpenAI's embedding family |
| Vector DB | ChromaDB | One collection per audit job |
| Orchestration | LangChain | RetrievalQA chain for Contract Q&A |
| Backend | FastAPI + Python 3.9 | Async background jobs |
| Frontend | React 18 + Vite + TypeScript | |
| Styling | Tailwind CSS | Dark theme |
| PDF parsing | pdfplumber | Page-aware chunking |
| Excel parsing | openpyxl | Multi-sheet, multi-row header aware |
| DOCX parsing | python-docx | Section-boundary splitting |

---

## Setup & Running

### Prerequisites
- Python 3.9+
- Node.js 18+
- OpenAI API key

### 1. Generate Dataset
```bash
cd rag/
python scripts/generate_dataset.py
```

### 2. Backend
```bash
cd backend/
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend/
npm install
npm run dev
# → http://localhost:5173 (or 5174 if 5173 is in use)
```

### 4. Usage
1. Open the frontend URL
2. Enter your OpenAI API key
3. Drop all 4 contract files from `data/contracts/`
4. Drop `data/invoices/invoice_INV-1001.csv`
5. Click **Run Audit**
6. Results load with a **Risk Dashboard** (total dollar exposure + top failing SKUs)
7. The **Audit Table** defaults to sorting by confidence ascending — lowest-confidence rows need review first
8. Click any row to open the **Evidence Drawer**: side-by-side contract vs invoice comparison, all retrieved source chunks with page/sheet/section citations, and override buttons
9. Override any AI finding via the drawer — overrides are logged to `/tmp/contract_auditor_logs/{job_id}.jsonl` and shown in the **Override Log** tab
10. Switch to **Contract Q&A** to ask free-text questions (e.g., "What is the discount for CP-001?") — responses cite the exact source document, page, and section
11. Use **Batch Audit** to drop multiple invoice CSVs at once

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/audit` | Start an audit job (multipart: contract_files, invoice_file, openai_api_key) |
| GET | `/api/audit/{job_id}` | Poll job status + full report |
| GET | `/api/audit/{job_id}/download` | Download audit results as CSV |
| POST | `/api/audit/{job_id}/override` | Override a row's status with reason + reviewer |
| GET | `/api/audit/{job_id}/log` | Get JSONL override audit trail |
| POST | `/api/ask` | Contract Q&A (multipart: job_id, question, openai_api_key) |

---

## Sample Verified Results (against `invoice_INV-1001.csv`)

```
SKU      Field             Expected   Actual   Status  Confidence  $ Impact
-------- ----------------  --------   ------   ------  ----------  --------
CP-001   unit_price        5.00       5.50     FAIL    80%         +$6,000.00
CP-001   discount_percent  10.00      5.00     FAIL    95%         +$8,700.00
CP-001   tax_percent       8.00       8.00     PASS    100%             $0.00
CP-001   total_amount      57,024.00  67,716   FAIL    50%        +$10,692.00
AP-002   unit_price        12.00      12.00    PASS    100%             $0.00
AP-002   discount_percent  0.00       0.00     PASS    100%             $0.00
AP-002   tax_percent       8.00       8.00     PASS    100%             $0.00
AP-002   total_amount      2,592.00   2,592.00 PASS    50%              $0.00
EL-003   unit_price        3.25       3.25     PASS    100%             $0.00
EL-003   discount_percent  12.00      8.00     FAIL    95%         +$1,105.00
EL-003   tax_percent       8.00       8.00     PASS    100%             $0.00
EL-003   total_amount      25,956.45  27,448.2 FAIL    50%         +$1,491.75
DM-004   unit_price        45.00      45.00    PASS    100%             $0.00
DM-004   discount_percent  5.00       0.00     FAIL    100%           +$337.50
DM-004   tax_percent       8.00       8.00     PASS    100%             $0.00
DM-004   total_amount      6,925.50   7,290.00 FAIL    50%            +$364.50

Total Dollar Exposure: $28,690.75   |   Reviews Required: 8
```
