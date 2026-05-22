import React, { useEffect, useState } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'
import type { AuditLogEntry } from '../types'
import { getAuditLog } from '../api/client'
import { cn } from '../utils/cn'

interface Props {
  jobId: string
}

const STATUS_CLS: Record<string, string> = {
  PASS: 'text-emerald-400',
  FAIL: 'text-red-400',
  WARN: 'text-amber-400',
}

export function AuditLogPanel({ jobId }: Props) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await getAuditLog(jobId)
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [jobId])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-2">
          <ClipboardList size={13} />
          Audit Override Log
        </h3>
        <button
          onClick={load}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">
          No overrides yet. Use the Evidence Drawer to override any AI finding.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((e, i) => (
            <div
              key={i}
              className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 space-y-1.5"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-200">{e.sku}</span>
                  <span className="text-xs text-slate-400">{e.field_checked}</span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <span className={STATUS_CLS[e.original_status] || 'text-slate-400'}>
                    {e.original_status}
                  </span>
                  <span className="text-slate-600">→</span>
                  <span className={cn('font-bold', STATUS_CLS[e.override_status] || 'text-slate-400')}>
                    {e.override_status}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                <span className="text-slate-500">Reason: </span>{e.reason}
              </p>
              <div className="flex gap-3 text-xs text-slate-500">
                <span>By {e.reviewer}</span>
                <span>{new Date(e.timestamp).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
