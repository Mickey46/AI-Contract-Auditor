import React, { useEffect, useState } from 'react'
import { X, History, Download, RotateCcw, CheckCircle, AlertCircle, FileText, Clock } from 'lucide-react'
import { fetchHistory, downloadAuditCsv, pollJobStatus } from '../api/client'
import type { HistoryEntry, JobStatus } from '../types'
import { cn } from '../utils/cn'

interface Props {
  open: boolean
  onClose: () => void
  onLoad: (status: JobStatus) => void
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function ComplianceBadge({ pass, fail, warn, total }: { pass: number; fail: number; warn: number; total: number }) {
  const pct = total > 0 ? Math.round((pass / total) * 100) : 0
  const color = pct === 100 ? 'text-emerald-400 border-emerald-700 bg-emerald-950/30'
    : pct >= 70  ? 'text-amber-400 border-amber-700 bg-amber-950/30'
    : 'text-red-400 border-red-700 bg-red-950/30'
  return (
    <span className={cn('text-xs font-bold border px-2 py-0.5 rounded-full', color)}>
      {pct}%
    </span>
  )
}

export function HistoryPanel({ open, onClose, onLoad }: Props) {
  const [entries, setEntries]   = useState<HistoryEntry[]>([])
  const [loading, setLoading]   = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetchHistory()
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [open])

  async function handleLoad(job_id: string) {
    setLoadingId(job_id)
    try {
      const status = await pollJobStatus(job_id)
      onLoad(status)
      onClose()
    } catch {
      alert('Failed to load audit. The job may have expired.')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={[
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/* Drawer — slides in from the right */}
      <div
        className={[
          'fixed top-0 right-0 z-50 h-full w-[420px] bg-slate-900 border-l border-slate-700',
          'flex flex-col shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center">
              <History size={14} className="text-slate-300" />
            </div>
            <div>
              <p className="font-semibold text-slate-100 text-sm leading-none">Audit History</p>
              <p className="text-xs text-slate-400 leading-none mt-0.5">
                {entries.length > 0 ? `${entries.length} past audit${entries.length !== 1 ? 's' : ''}` : 'Past audit runs'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              Loading history…
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <Clock size={28} className="text-slate-600 mb-3" />
              <p className="text-sm text-slate-400 font-medium">No history yet</p>
              <p className="text-xs text-slate-600 mt-1">Completed audits will appear here</p>
            </div>
          )}

          {!loading && entries.length > 0 && (
            <ul className="divide-y divide-slate-800">
              {entries.map((entry) => {
                const total = entry.pass_count + entry.fail_count + entry.warn_count
                const isLoading = loadingId === entry.job_id
                return (
                  <li key={entry.job_id} className="px-5 py-4 hover:bg-slate-800/40 transition-colors">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileText size={12} className="text-slate-400 shrink-0" />
                          <span className="text-sm font-medium text-slate-200 truncate">
                            {entry.invoice_file}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                          <Clock size={10} />
                          {fmtDate(entry.completed_at)}
                        </p>
                      </div>
                      <ComplianceBadge pass={entry.pass_count} fail={entry.fail_count} warn={entry.warn_count} total={total} />
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle size={11} />{entry.pass_count} PASS
                      </span>
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <AlertCircle size={11} />{entry.fail_count} FAIL
                      </span>
                      {entry.warn_count > 0 && (
                        <span className="text-xs text-amber-400">{entry.warn_count} WARN</span>
                      )}
                      <span className="ml-auto text-xs text-slate-600 font-mono">{entry.job_id}</span>
                    </div>

                    {/* Contract files */}
                    {entry.contract_files.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {entry.contract_files.map((f, i) => (
                          <span key={i} className="text-[10px] text-slate-500 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 truncate max-w-[120px]">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoad(entry.job_id)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex-1 justify-center"
                      >
                        <RotateCcw size={11} className={isLoading ? 'animate-spin' : ''} />
                        {isLoading ? 'Loading…' : 'Load Results'}
                      </button>
                      <button
                        onClick={() => downloadAuditCsv(entry.job_id)}
                        className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Download size={11} />
                        CSV
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
