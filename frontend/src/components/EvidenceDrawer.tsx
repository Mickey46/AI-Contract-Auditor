import React from 'react'
import { X } from 'lucide-react'
import type { AuditRow, EvidenceChunk } from '../types'
import { locationLabel, sourceTypeIcon } from '../types'
import { cn } from '../utils/cn'

interface Props {
  row: AuditRow | null
  onClose: () => void
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

export function EvidenceDrawer({ row, onClose }: Props) {
  if (!row) return null

  const topPrecedence = row.evidence.length > 0
    ? Math.min(...row.evidence.map(e => e.doc_precedence))
    : 5

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
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-thin">

          {/* Verdict */}
          <div className={cn(
            'rounded-xl border p-4 space-y-2',
            row.status === 'PASS' ? 'border-emerald-700 bg-emerald-950/40' :
            row.status === 'FAIL' ? 'border-red-700 bg-red-950/40' :
            'border-amber-700 bg-amber-950/40',
          )}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={cn(
                'text-xs font-bold px-2 py-0.5 rounded',
                row.status === 'PASS' ? 'bg-emerald-700 text-white' :
                row.status === 'FAIL' ? 'bg-red-700 text-white' : 'bg-amber-700 text-white',
              )}>
                {row.status}
              </span>
              <span className="text-sm font-semibold text-slate-200 capitalize">
                {row.field_checked.replace('_', ' ')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Expected</p>
                <p className="font-mono text-slate-200 mt-0.5">{row.expected_value}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Actual</p>
                <p className="font-mono text-slate-200 mt-0.5">{row.actual_value}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Delta</p>
                <p className={cn(
                  'font-mono font-semibold mt-0.5',
                  row.delta === 0 ? 'text-slate-400' : row.delta > 0 ? 'text-red-400' : 'text-amber-400',
                )}>
                  {row.delta > 0 ? `+${row.delta}` : row.delta}
                </p>
              </div>
            </div>
          </div>

          {/* AI Explanation */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Explanation</h3>
            <p className="text-sm text-slate-300 leading-relaxed bg-slate-800/40 border border-slate-700 rounded-xl p-4">
              {row.explanation}
            </p>
          </div>

          {/* Evidence chunks */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Source Evidence ({row.evidence.length})
            </h3>
            <div className="space-y-3">
              {row.evidence.map((ev, i) => (
                <EvidenceCard key={i} ev={ev} authoritative={ev.doc_precedence === topPrecedence} />
              ))}
              {row.evidence.length === 0 && (
                <p className="text-xs text-slate-500">No evidence chunks available for this field.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
