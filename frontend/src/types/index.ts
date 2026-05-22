export interface EvidenceChunk {
  source_file: string
  page_number: number | null
  sheet_name: string | null
  row_range: string | null
  section: string | null
  excerpt: string
  doc_precedence: number
  superseded_by: string | null
  similarity_score: number | null
}

export interface AuditRow {
  invoice_id: string
  line_id: number
  sku: string
  field_checked: string
  expected_value: number
  actual_value: number
  delta: number
  status: 'PASS' | 'FAIL' | 'WARN'
  explanation: string
  evidence: EvidenceChunk[]
}

export interface AuditReport {
  job_id: string
  invoice_file: string
  contract_files: string[]
  total_lines: number
  pass_count: number
  fail_count: number
  warn_count: number
  rows: AuditRow[]
  model_used: string | null
}

export interface JobStatus {
  job_id: string
  status: 'pending' | 'running' | 'done' | 'error'
  message: string | null
  report: AuditReport | null
}

export interface QASource {
  source_file: string
  page_number: number | null
  sheet_name: string | null
  row_range: string | null
  section: string | null
  excerpt: string
}

export interface QAResponse {
  question: string
  answer: string
  sources: QASource[]
}

export interface HistoryEntry {
  job_id: string
  invoice_file: string
  contract_files: string[]
  pass_count: number
  fail_count: number
  warn_count: number
  total_lines: number
  model_used: string | null
  completed_at: string  // ISO timestamp
}

export function locationLabel(s: QASource | EvidenceChunk): string {
  const parts = [s.source_file]
  if (s.sheet_name) {
    parts.push(s.sheet_name)
    if (s.row_range) parts.push(`Row ${s.row_range}`)
  } else if (s.page_number != null) {
    parts.push(`Page ${s.page_number}`)
  } else if (s.section) {
    parts.push(s.section)
  }
  return parts.join(' — ')
}

export function sourceTypeIcon(filename: string): string {
  if (filename.endsWith('.pdf')) return '📄'
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) return '📊'
  if (filename.endsWith('.docx') || filename.endsWith('.doc')) return '📝'
  if (filename.endsWith('.eml')) return '📧'
  if (filename.endsWith('.csv')) return '📋'
  return '📁'
}
