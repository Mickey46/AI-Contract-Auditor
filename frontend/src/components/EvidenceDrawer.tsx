import React, { useState } from 'react'
import { X, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import type { AuditRow, EvidenceChunk } from '../types'
import { locationLabel, sourceTypeIcon, effectiveStatus } from '../types'
import { overrideRow } from '../api/client'
import { ComparisonView } from './ComparisonView'
import { ConfidenceBadge } from './ConfidenceBadge'
import { cn } from '../utils/cn'

interface Props {
  row: AuditRow | null
  rowIndex: number
  jobId: string
  onClose: () => void
  onOverride: (rowIndex: number, newStatus: string, reason: string) => void
}

const PREC_LABEL: Record<number, string> = {
  1: 'Email Addendum',
  2: 'DOCX Amendment',
  3: 'Excel Sheet',
  4: 'PDF Contract',
}
const PREC_COLOR: Record<number, string> = {
  1: 'bg-purple-900/50 border-purple-700 text-purple-300',
  2: 'bg-blue-900/50 border-blue-700 text-blue-300',
  3: 'bg-emerald-900/50 border-emerald-700 text-emerald-300',
  4: 'bg-slate-800 border-slate-600 text-slate-300',
}

function EvidenceCard({ ev, authoritative }: { ev: EvidenceChunk; authoritative: boolean }) {
  return (
    <div className={cn(
      'rounded-xl border p-4 space-y-2',
      authoritative ? PREC_COLOR[ev.doc_precedence] : 'bg-slate-800/40 border-slate-700 opacity-55',
    )}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base">{sourceTypeIcon(ev.source_file)}</span>
          <span className="font-semibold text-sm">{locationLabel(ev)}</span>
          {authoritative && (
            <span className="text-xs px-1.5 py-0.5 bg-emerald-700/50 text-emerald-200 rounded font-bold">
              AUTHORITATIVE
            </span>
          )}
          {ev.superseded_by && (
            <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded border border-red-800">
              superseded by {ev.superseded_by}
            </span>
          )}
        </div>
        <span className={cn('shrink-0 text-xs px-2 py-0.5 rounded border', PREC_COLOR[ev.doc_precedence])}>
          {PREC_LABEL[ev.doc_precedence]}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {ev.page_number != null && <span className="bg-slate-900/60 border border-slate-600 rounded px-2 py-0.5">Page {ev.page_number}</span>}
        {ev.sheet_name && <span className="bg-slate-900/60 border border-slate-600 rounded px-2 py-0.5">Sheet: {ev.sheet_name}</span>}
        {ev.row_range && <span className="bg-slate-900/60 border border-slate-600 rounded px-2 py-0.5">Rows: {ev.row_range}</span>}
        {ev.section && <span className="bg-slate-900/60 border border-slate-600 rounded px-2 py-0.5 max-w-xs truncate">{ev.section}</span>}
        {ev.similarity_score != null && <span className="bg-slate-900/60 border border-slate-600 rounded px-2 py-0.5 text-slate-500">sim: {ev.similarity_score.toFixed(3)}</span>}
      </div>
      <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words bg-slate-950/60 rounded-lg p-3 max-h-40 overflow-y-auto scrollbar-thin">
        {ev.excerpt}
      </pre>
    </div>
  )
}

export function EvidenceDrawer({ row, rowIndex, jobId, onClose, onOverride }: Props) {
  const [overriding, setOverriding] = useState(false)
  const [reason, setReason] = useState('')
  const [reviewer, setReviewer] = useState('analyst')
  const [loading, setLoading] = useState(false)

  if (!row) return null

  const topPrecedence = Math.min(...row.evidence.map(e => e.doc_precedence), 5)
  const effStatus = effectiveStatus(row)
  const isOverridden = row.override_status != null

  async function handleOverride(newStatus: string) {
    if (!reason.trim()) return
    setLoading(true)
    try {
      await overrideRow(jobId, rowIndex, newStatus, reason.trim(), reviewer || 'analyst')
      onOverride(rowIndex, newStatus, reason.trim())
      setOverriding(false)
      setReason('')
    } catch (e) {
      alert(`Override failed: ${e}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-700 flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 sticky top-0 bg-slate-900 z-10">
          <div>
            <h2 className="font-bold text-slate-100">Evidence Inspector</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {row.invoice_id} · Line {row.line_id} · <span className="font-mono">{row.sku}</span> · {row.field_checked}
              {isOverridden && <span className="ml-2 text-amber-400">✏️ Overridden</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-thin">

          {/* Comparison: contract vs invoice */}
          <ComparisonView row={row} />

          {/* Verdict */}
          <div className={cn(
            'rounded-xl border p-4 space-y-2',
            effStatus === 'PASS' ? 'border-emerald-700 bg-emerald-950/40' :
            effStatus === 'FAIL' ? 'border-red-700 bg-red-950/40' :
            'border-amber-700 bg-amber-950/40',
          )}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'text-xs font-bold px-2 py-0.5 rounded',
                effStatus === 'PASS' ? 'bg-emerald-700 text-white' :
                effStatus === 'FAIL' ? 'bg-red-700 text-white' : 'bg-amber-700 text-white',
              )}>
                {effStatus}
              </span>
              <span className="text-sm font-semibold text-slate-200 capitalize">
                {row.field_checked.replace('_', ' ')} check
              </span>
              <ConfidenceBadge value={row.confidence} reviewRequired={row.review_required} />
            </div>
            {row.sources_agreeing.length > 0 && (
              <p className="text-xs text-slate-400">
                Sources in agreement: <span className="text-slate-300">{row.sources_agreeing.join(', ')}</span>
              </p>
            )}
            {row.conflicts.length > 0 && (
              <p className="text-xs text-amber-400">
                Conflicts detected: {row.conflicts.join(', ')}
              </p>
            )}
          </div>

          {/* AI Explanation */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">AI Explanation</h3>
            <p className="text-sm text-slate-300 leading-relaxed bg-slate-800/40 border border-slate-700 rounded-xl p-4">
              {row.explanation}
            </p>
          </div>

          {/* Override info */}
          {isOverridden && (
            <div className="bg-amber-950/30 border border-amber-700 rounded-xl p-4 space-y-1 text-sm">
              <p className="font-semibold text-amber-300">Manually overridden to {row.override_status}</p>
              <p className="text-xs text-slate-400">Reason: {row.override_reason}</p>
              <p className="text-xs text-slate-500">By {row.overridden_by} at {row.overridden_at}</p>
            </div>
          )}

          {/* Evidence chunks */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Retrieved Source Chunks ({row.evidence.length})
            </h3>
            <div className="space-y-3">
              {row.evidence.map((ev, i) => (
                <EvidenceCard key={i} ev={ev} authoritative={ev.doc_precedence === topPrecedence} />
              ))}
              {row.evidence.length === 0 && (
                <p className="text-xs text-slate-500">No evidence chunks retrieved for this field.</p>
              )}
            </div>
          </div>
        </div>

        {/* Override panel */}
        <div className="border-t border-slate-700 bg-slate-900 px-6 py-4">
          {!overriding ? (
            <div>
              <p className="text-xs text-slate-400 mb-3">Disagree with the AI finding? Override below.</p>
              <div className="flex gap-2">
                {(['PASS', 'FAIL', 'WARN'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setOverriding(true)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors',
                      s === 'PASS' ? 'bg-emerald-800 hover:bg-emerald-700 text-emerald-100' :
                      s === 'FAIL' ? 'bg-red-800 hover:bg-red-700 text-red-100' :
                      'bg-amber-800 hover:bg-amber-700 text-amber-100',
                    )}
                  >
                    {s === 'PASS' ? <CheckCircle size={14} /> : s === 'FAIL' ? <XCircle size={14} /> : <AlertTriangle size={14} />}
                    Mark {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-300">Override reason (required)</p>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. Verified against original signed contract..."
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={reviewer}
                onChange={e => setReviewer(e.target.value)}
                placeholder="Reviewer name"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                {(['PASS', 'FAIL', 'WARN'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => handleOverride(s)}
                    disabled={!reason.trim() || loading}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40',
                      s === 'PASS' ? 'bg-emerald-700 hover:bg-emerald-600 text-white' :
                      s === 'FAIL' ? 'bg-red-700 hover:bg-red-600 text-white' :
                      'bg-amber-700 hover:bg-amber-600 text-white',
                    )}
                  >
                    {loading ? '...' : `Set ${s}`}
                  </button>
                ))}
                <button
                  onClick={() => { setOverriding(false); setReason('') }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
