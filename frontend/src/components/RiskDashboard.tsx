import React, { useState } from 'react'
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle, AlertTriangle, Cpu, Layers, Zap } from 'lucide-react'
import type { AuditReport } from '../types'
import { effectiveStatus } from '../types'
import { cn } from '../utils/cn'

interface Props {
  report: AuditReport
}

export function RiskDashboard({ report }: Props) {
  const [notesOpen, setNotesOpen] = useState(false)

  // Aggregate dollar exposure by SKU from FAIL rows
  const skuExposure: Record<string, number> = {}
  for (const r of report.rows) {
    if (effectiveStatus(r) === 'FAIL') {
      skuExposure[r.sku] = (skuExposure[r.sku] || 0) + Math.abs(r.dollar_impact)
    }
  }
  const topSkus = Object.entries(skuExposure)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)

  const passCount = report.rows.filter(r => effectiveStatus(r) === 'PASS').length
  const failCount = report.rows.filter(r => effectiveStatus(r) === 'FAIL').length
  const warnCount = report.rows.filter(r => effectiveStatus(r) === 'WARN').length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Dollar exposure card */}
        <div className="md:col-span-2 bg-gradient-to-br from-red-950/70 to-slate-900 border border-red-800/60 rounded-2xl p-5">
          <p className="text-xs uppercase font-semibold tracking-widest text-red-300/80">
            Total Dollar Exposure (FAIL rows)
          </p>
          <p className="text-5xl font-bold text-red-300 mt-1">
            ${report.total_dollar_exposure.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          {topSkus.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-red-300/60 uppercase tracking-wide">Top failing SKUs</p>
              {topSkus.map(([sku, amt]) => (
                <div key={sku} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="font-mono text-sm text-slate-300">{sku}</span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-red-400">
                    +${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stats + meta card */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4">
          {/* Status pills */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'PASS', count: passCount, icon: <CheckCircle size={14} />, cls: 'text-emerald-400 border-emerald-800' },
              { label: 'FAIL', count: failCount, icon: <AlertCircle size={14} />, cls: 'text-red-400 border-red-800' },
              { label: 'WARN', count: warnCount, icon: <AlertTriangle size={14} />, cls: 'text-amber-400 border-amber-800' },
            ].map(({ label, count, icon, cls }) => (
              <div key={label} className={cn('rounded-xl border py-2 px-1', cls, 'bg-slate-900/60')}>
                <div className={cn('flex justify-center mb-1', cls)}>{icon}</div>
                <p className="text-xl font-bold">{count}</p>
                <p className="text-xs opacity-70">{label}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-800 pt-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Reviews required</span>
              <span className={cn('font-bold', report.review_required_count > 0 ? 'text-amber-400' : 'text-slate-400')}>
                {report.review_required_count}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Total checks</span>
              <span className="text-slate-300">{report.rows.length}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Invoice</span>
              <span className="text-slate-300 font-mono truncate max-w-[120px]">{report.invoice_file}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 flex items-center gap-1"><Cpu size={11} />Model</span>
              <span className="font-mono text-blue-400 bg-blue-950/40 border border-blue-800 px-1.5 py-0.5 rounded">
                {report.model_used ?? 'gpt-4o'}
              </span>
            </div>
          </div>

          {/* Retrieval pipeline badge — NVIDIA RAG architecture */}
          <div className="border-t border-slate-800 pt-3">
            <p className="text-xs text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1">
              <Layers size={10} /> Retrieval Pipeline
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs font-medium bg-violet-950/60 border border-violet-700/50 text-violet-300 px-2 py-0.5 rounded-full">
                  <Layers size={10} /> Hybrid Dense + BM25
                </span>
                <span className="text-xs text-slate-500">k=40 each</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs font-medium bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 px-2 py-0.5 rounded-full">
                  <Zap size={10} /> Reranker
                </span>
                <span className="text-xs text-slate-500 truncate">
                  CrossEncoder / NVIDIA NeMo NIM
                </span>
              </div>
              <p className="text-xs text-slate-600 font-mono">k=40 → top_n=6 → LLM</p>
            </div>
          </div>

          {/* Pipeline notes */}
          {report.notes && report.notes.length > 0 && (
            <div className="border-t border-slate-800 pt-3">
              <button
                onClick={() => setNotesOpen(v => !v)}
                className="flex items-center justify-between w-full text-xs text-slate-400 hover:text-slate-200"
              >
                <span>Pipeline notes ({report.notes.length})</span>
                {notesOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {notesOpen && (
                <ul className="mt-2 space-y-1 text-xs text-slate-500 max-h-32 overflow-y-auto scrollbar-thin">
                  {report.notes.map((n, i) => (
                    <li key={i} className="leading-relaxed border-l-2 border-slate-700 pl-2">{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
