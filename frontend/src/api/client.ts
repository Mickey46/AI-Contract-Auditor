import axios from 'axios'
import type { JobStatus, QAResponse, AuditLogEntry } from '../types'

const BASE = '/api'

export async function startAudit(
  contractFiles: File[],
  invoiceFile: File,
  openaiKey: string,
): Promise<{ job_id: string }> {
  const form = new FormData()
  for (const f of contractFiles) form.append('contract_files', f)
  form.append('invoice_file', invoiceFile)
  form.append('openai_api_key', openaiKey)
  const { data } = await axios.post(`${BASE}/audit`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function pollJobStatus(jobId: string): Promise<JobStatus> {
  const { data } = await axios.get<JobStatus>(`${BASE}/audit/${jobId}`)
  return data
}

export function downloadAuditCsv(jobId: string): void {
  window.open(`${BASE}/audit/${jobId}/download`, '_blank')
}

export async function askQuestion(
  jobId: string,
  question: string,
  openaiKey: string,
): Promise<QAResponse> {
  const form = new FormData()
  form.append('job_id', jobId)
  form.append('question', question)
  form.append('openai_api_key', openaiKey)
  const { data } = await axios.post<QAResponse>(`${BASE}/ask`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function overrideRow(
  jobId: string,
  rowIndex: number,
  newStatus: string,
  reason: string,
  reviewer = 'analyst',
): Promise<{ ok: boolean; log_entry: AuditLogEntry }> {
  const { data } = await axios.post(`${BASE}/audit/${jobId}/override`, {
    job_id: jobId,
    row_index: rowIndex,
    new_status: newStatus,
    reason,
    reviewer,
  })
  return data
}

export async function getAuditLog(jobId: string): Promise<AuditLogEntry[]> {
  const { data } = await axios.get(`${BASE}/audit/${jobId}/log`)
  return data.entries as AuditLogEntry[]
}
