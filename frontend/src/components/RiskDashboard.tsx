import React from 'react'
import { AlertCircle, CheckCircle, AlertTriangle, Cpu, FileText } from 'lucide-react'
import type { AuditReport } from '../types'
import { cn } from '../utils/cn'

interface Props {
  report: AuditReport
}

export function RiskDashboard({ report }: Props) {
  const total = report.rows.length
  const passPct = total > 0 ? Math.round((report.pass_count / total) * 100) : 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* Compliance score card */}
      <div className="md:col-span-2 bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-5">
        <p className="text-xs uppercase font-semibold tracking-widest text-slate-400">Compliance Rate</p>
        <p className="text-5xl font-bold text-slate-100 mt-1">{passPct}%</p>
        <p className="text-xs text-slate-500 mt-2">
          {report.pass_count} of {total} field checks passed across {report.total_lines} invoice line(s)
        </p>
      </div>

      {/* Status pills */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <p className="text-xs uppercase tracking-widest text-slate-500">Findings</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'PASS', count: report.pass_count, icon: <CheckCircle size={14} />, cls: 'text-emerald-400 border-emerald-800' },
            { label: 'FAIL', count: report.fail_count, icon: <AlertCircle size={14} />, cls: 'text-red-400 border-red-800' },
            { label: 'WARN', count: report.warn_count, icon: <AlertTriangle size={14} />, cls: 'text-amber-400 border-amber-800' },
          ].map(({ label, count, icon, cls }) => (
            <div key={label} className={cn('rounded-xl border py-2 px-1', cls, 'bg-slate-900/60')}>
              <div className={cn('flex justify-center mb-1', cls)}>{icon}</div>
              <p className="text-xl font-bold">{count}</p>
              <p className="text-xs opacity-70">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Meta card */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400 flex items-center gap-1"><FileText size={11} />Invoice</span>
          <span className="text-slate-300 font-mono truncate max-w-[140px]" title={report.invoice_file}>{report.invoice_file}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Contracts</span>
          <span className="text-slate-300">{report.contract_files.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Total checks</span>
          <span className="text-slate-300">{total}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-400 flex items-center gap-1"><Cpu size={11} />Model</span>
          <span className="font-mono text-blue-400 bg-blue-950/40 border border-blue-800 px-1.5 py-0.5 rounded">
            {report.model_used ?? 'gpt-4o'}
          </span>
        </div>
      </div>
    </div>
  )
}
