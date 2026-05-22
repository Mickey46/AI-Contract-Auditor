import React from 'react'
import type { AuditReport } from '../types'
import { sourceTypeIcon } from '../types'
import { cn } from '../utils/cn'

interface Props {
  report: AuditReport
}

interface DocSummary {
  filename: string
  type: string
  evidenceCount: number
  fieldsUsed: Set<string>
}

export function SourcePanel({ report }: Props) {
  const docMap = new Map<string, DocSummary>()

  for (const file of report.contract_files) {
    docMap.set(file, {
      filename: file,
      type: file.endsWith('.pdf') ? 'pdf' : file.endsWith('.xlsx') ? 'excel' : file.endsWith('.docx') ? 'docx' : 'email',
      evidenceCount: 0,
      fieldsUsed: new Set(),
    })
  }

  for (const row of report.rows) {
    for (const ev of row.evidence) {
      const entry = docMap.get(ev.source_file)
      if (entry) {
        entry.evidenceCount++
        entry.fieldsUsed.add(row.field_checked)
      }
    }
  }

  const PREC_LABEL: Record<string, string> = {
    email: 'Highest — Email Addendum',
    docx: 'High — DOCX Amendment',
    excel: 'Medium — Excel Sheet',
    pdf: 'Base — PDF Contract',
  }
  const PREC_COLOR: Record<string, string> = {
    email: 'border-purple-700 bg-purple-950/30',
    docx: 'border-blue-700 bg-blue-950/30',
    excel: 'border-emerald-700 bg-emerald-950/30',
    pdf: 'border-slate-600 bg-slate-800/30',
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
        Indexed Contract Documents
      </h3>
      {[...docMap.values()].map((doc) => (
        <div
          key={doc.filename}
          className={cn('rounded-xl border p-4 space-y-2', PREC_COLOR[doc.type])}
        >
          <div className="flex items-center gap-2">
            <span className="text-xl">{sourceTypeIcon(doc.filename)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-200 truncate">{doc.filename}</p>
              <p className="text-xs text-slate-400">{PREC_LABEL[doc.type]}</p>
            </div>
          </div>
          <div className="flex gap-3 text-xs text-slate-400">
            <span>{doc.evidenceCount} citations</span>
            {doc.fieldsUsed.size > 0 && (
              <span>Fields: {[...doc.fieldsUsed].join(', ')}</span>
            )}
          </div>
        </div>
      ))}

      <div className="mt-4 p-3 rounded-xl bg-slate-800/40 border border-slate-700">
        <p className="text-xs font-semibold text-slate-400 mb-1.5">Precedence Order</p>
        <ol className="text-xs text-slate-400 space-y-1">
          <li><span className="text-purple-400 font-bold">1.</span> Email Addendum</li>
          <li><span className="text-blue-400 font-bold">2.</span> DOCX Amendment</li>
          <li><span className="text-emerald-400 font-bold">3.</span> Excel Pricing Sheet</li>
          <li><span className="text-slate-300 font-bold">4.</span> PDF Base Contract</li>
        </ol>
        <p className="text-xs text-slate-500 mt-2">
          When multiple documents define the same term, the higher-precedence document wins.
        </p>
      </div>
    </div>
  )
}
