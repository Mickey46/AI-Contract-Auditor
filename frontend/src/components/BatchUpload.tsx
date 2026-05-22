import React, { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Layers, Play, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { startAudit, pollJobStatus } from '../api/client'
import type { AuditReport } from '../types'
import { cn } from '../utils/cn'

interface BatchJob {
  filename: string
  status: 'pending' | 'running' | 'done' | 'error'
  message?: string
  report?: AuditReport
  jobId?: string
}

interface Props {
  contractFiles: File[]
  apiKey: string
  onSelectReport: (report: AuditReport) => void
}

export function BatchUpload({ contractFiles, apiKey, onSelectReport }: Props) {
  const [invoices, setInvoices] = useState<File[]>([])
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [running, setRunning] = useState(false)

  const drop = useDropzone({
    accept: { 'text/csv': ['.csv'] },
    onDrop: files => setInvoices(prev => [...prev, ...files]),
    multiple: true,
  })

  function updateJob(i: number, patch: Partial<BatchJob>) {
    setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, ...patch } : j))
  }

  async function runBatch() {
    if (!contractFiles.length || !invoices.length || !apiKey) return
    setRunning(true)
    const initialJobs: BatchJob[] = invoices.map(f => ({ filename: f.name, status: 'pending' }))
    setJobs(initialJobs)

    for (let i = 0; i < invoices.length; i++) {
      updateJob(i, { status: 'running', message: 'Starting...' })
      try {
        const { job_id } = await startAudit(contractFiles, invoices[i], apiKey)
        updateJob(i, { jobId: job_id, message: 'Processing...' })

        // Poll until done
        await new Promise<void>((resolve, reject) => {
          const timer = setInterval(async () => {
            const status = await pollJobStatus(job_id)
            updateJob(i, { message: status.message ?? status.status })
            if (status.status === 'done') {
              clearInterval(timer)
              updateJob(i, { status: 'done', report: status.report ?? undefined })
              resolve()
            } else if (status.status === 'error') {
              clearInterval(timer)
              updateJob(i, { status: 'error', message: status.message ?? 'Error' })
              reject(new Error(status.message ?? 'Error'))
            }
          }, 2500)
        })
      } catch (err) {
        updateJob(i, { status: 'error', message: String(err) })
      }
    }
    setRunning(false)
  }

  const canRun = contractFiles.length > 0 && invoices.length > 0 && apiKey && !running

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Layers size={14} className="text-blue-400" />
        <h3 className="text-sm font-semibold text-slate-200">Batch Invoice Audit</h3>
      </div>

      {/* Drop zone */}
      <div
        {...drop.getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors',
          drop.isDragActive ? 'border-blue-400 bg-blue-950/20' : 'border-slate-600 hover:border-slate-400 bg-slate-800/20',
        )}
      >
        <input {...drop.getInputProps()} />
        <p className="text-sm text-slate-400">Drop multiple invoice CSVs here</p>
        <p className="text-xs text-slate-500 mt-1">Each will be audited against the same contract set</p>
      </div>

      {invoices.length > 0 && (
        <ul className="space-y-1 text-sm text-slate-300">
          {invoices.map((f, i) => (
            <li key={i} className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-1.5">
              <span>📋</span>
              <span className="flex-1 truncate">{f.name}</span>
              <button
                onClick={() => setInvoices(prev => prev.filter((_, idx) => idx !== i))}
                className="text-slate-500 hover:text-red-400 text-xs"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={runBatch}
        disabled={!canRun}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all',
          canRun ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed',
        )}
      >
        {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        {running ? 'Running batch...' : `Run Batch (${invoices.length} invoices)`}
      </button>

      {/* Progress list */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job, i) => (
            <div key={i} className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 flex items-center gap-3">
              {job.status === 'done' ? <CheckCircle size={15} className="text-emerald-400 shrink-0" /> :
               job.status === 'error' ? <XCircle size={15} className="text-red-400 shrink-0" /> :
               job.status === 'running' ? <Loader2 size={15} className="text-blue-400 animate-spin shrink-0" /> :
               <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-600 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 truncate">{job.filename}</p>
                <p className="text-xs text-slate-400 truncate">{job.message}</p>
              </div>
              {job.status === 'done' && job.report && (
                <button
                  onClick={() => onSelectReport(job.report!)}
                  className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
                >
                  View
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
