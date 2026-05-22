import React, { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, Filter, Download } from 'lucide-react'
import type { AuditReport, AuditRow } from '../types'
import { sourceTypeIcon } from '../types'
import { downloadAuditCsv } from '../api/client'
import { cn } from '../utils/cn'

interface Props {
  report: AuditReport
  onRowClick: (row: AuditRow, rowIndex: number) => void
}

const STATUS_BADGE: Record<string, string> = {
  PASS: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700',
  FAIL: 'bg-red-900/60 text-red-300 border border-red-700',
  WARN: 'bg-amber-900/60 text-amber-300 border border-amber-700',
}

const FIELD_LABELS: Record<string, string> = {
  unit_price: 'Unit Price',
  discount_percent: 'Discount %',
  tax_percent: 'Tax %',
  total_amount: 'Total Amount',
  sku: 'SKU',
}

type SortKey = 'sku' | 'field_checked' | 'expected_value' | 'actual_value' | 'delta' | 'status'
type FilterStatus = 'ALL' | 'PASS' | 'FAIL' | 'WARN'

export function AuditTable({ report, onRowClick }: Props) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL')
  const [filterSku, setFilterSku] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortAsc, setSortAsc] = useState(true)

  const skus = useMemo(() => [...new Set(report.rows.map(r => r.sku))], [report])

  const filtered = useMemo(() => {
    let rows = report.rows.map((r, i) => ({ ...r, _origIdx: i }))
    if (filterStatus !== 'ALL') rows = rows.filter(r => r.status === filterStatus)
    if (filterSku) rows = rows.filter(r => r.sku === filterSku)
    rows.sort((a, b) => {
      const av = a[sortKey as keyof typeof a] as string | number
      const bv = b[sortKey as keyof typeof b] as string | number
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
    return rows
  }, [report.rows, filterStatus, filterSku, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k
      ? <ChevronDown size={11} className="text-slate-600" />
      : sortAsc
        ? <ChevronUp size={11} className="text-blue-400" />
        : <ChevronDown size={11} className="text-blue-400" />

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'PASS' as FilterStatus, count: report.pass_count, color: 'text-emerald-400 border-emerald-800 bg-emerald-950/30' },
          { label: 'FAIL' as FilterStatus, count: report.fail_count, color: 'text-red-400 border-red-800 bg-red-950/30' },
          { label: 'WARN' as FilterStatus, count: report.warn_count, color: 'text-amber-400 border-amber-800 bg-amber-950/30' },
        ].map(({ label, count, color }) => (
          <button
            key={label}
            onClick={() => setFilterStatus(filterStatus === label ? 'ALL' : label)}
            className={cn(
              'rounded-xl border p-3 text-center transition-all',
              color,
              filterStatus === label ? 'ring-2 ring-offset-1 ring-offset-slate-950 ring-current' : 'hover:opacity-80',
            )}
          >
            <div className="text-2xl font-bold">{count}</div>
            <div className="text-xs font-medium opacity-70">{label}</div>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={13} className="text-slate-400 shrink-0" />
        <select
          value={filterSku}
          onChange={e => setFilterSku(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
        >
          <option value="">All SKUs</option>
          {skus.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => downloadAuditCsv(report.job_id)}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-3 py-1.5 rounded-lg transition-colors"
        >
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {/* Table — exact spec columns */}
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="bg-slate-800 border-b border-slate-700">
              {([
                { key: 'sku', label: 'SKU' },
                { key: 'field_checked', label: 'Field' },
                { key: 'expected_value', label: 'Expected' },
                { key: 'actual_value', label: 'Actual' },
                { key: 'delta', label: 'Delta' },
                { key: 'status', label: 'Status' },
              ] as { key: SortKey; label: string }[]).map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className="px-4 py-3 font-semibold text-slate-400 cursor-pointer hover:text-slate-200 select-none whitespace-nowrap text-xs uppercase tracking-wide"
                >
                  <span className="flex items-center gap-1">
                    {label}
                    <SortIcon k={key} />
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 font-semibold text-slate-400 text-xs uppercase tracking-wide">Explanation</th>
              <th className="px-4 py-3 font-semibold text-slate-400 text-xs uppercase tracking-wide">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr
                key={i}
                onClick={() => onRowClick(row, row._origIdx)}
                className={cn(
                  'border-b border-slate-800/60 cursor-pointer transition-colors',
                  i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/40',
                  'hover:bg-slate-800/70',
                )}
              >
                <td className="px-4 py-3 font-mono font-semibold text-slate-200">{row.sku}</td>
                <td className="px-4 py-3 text-slate-300">{FIELD_LABELS[row.field_checked] ?? row.field_checked}</td>
                <td className="px-4 py-3 font-mono text-slate-300">{row.expected_value}</td>
                <td className="px-4 py-3 font-mono text-slate-300">{row.actual_value}</td>
                <td className={cn(
                  'px-4 py-3 font-mono font-semibold',
                  row.delta === 0 ? 'text-slate-500' : row.delta > 0 ? 'text-red-400' : 'text-amber-400',
                )}>
                  {row.delta > 0 ? `+${row.delta}` : row.delta}
                </td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-bold', STATUS_BADGE[row.status])}>
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs max-w-md truncate" title={row.explanation}>
                  {row.explanation}
                </td>
                <td className="px-4 py-3">
                  {row.evidence.slice(0, 2).map((ev, j) => (
                    <span
                      key={j}
                      title={ev.excerpt}
                      className="inline-flex items-center gap-0.5 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-400 mr-1 mb-0.5 hover:border-blue-600 transition-colors"
                    >
                      {sourceTypeIcon(ev.source_file)}
                      <span className="max-w-[80px] truncate">
                        {ev.sheet_name ?? (ev.page_number != null ? `p.${ev.page_number}` : ev.section?.slice(0, 12) ?? ev.source_file)}
                      </span>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-500 text-sm">
            No results match current filters.
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Showing {filtered.length} of {report.rows.length} audit checks. Click any row for full evidence.
      </p>
    </div>
  )
}
