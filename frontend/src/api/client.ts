import axios from 'axios'
import type { HistoryEntry, JobStatus, QAResponse } from '../types'

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

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const { data } = await axios.get<HistoryEntry[]>(`${BASE}/history`)
  return data
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
