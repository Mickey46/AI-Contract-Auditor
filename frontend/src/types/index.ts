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
  confidence: number
  review_required: boolean
  sources_agreeing: string[]
  conflicts: string[]
  dollar_impact: number
  quantity: number
  override_status: string | null
  override_reason: string | null
  overridden_by: string | null
  overridden_at: string | null
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
  total_dollar_exposure: number
  review_required_count: number
  notes: string[]
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

export interface AuditLogEntry {
  job_id: string
  row_index: number
  sku: string
  field_checked: string
  original_status: string
  override_status: string
  reason: string
  reviewer: string
  timestamp: string
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

export function effectiveStatus(row: AuditRow): 'PASS' | 'FAIL' | 'WARN' {
  return (row.override_status as 'PASS' | 'FAIL' | 'WARN' | null) ?? row.status
}
