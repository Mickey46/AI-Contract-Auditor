import React, { useState, useMemo } from 'react'
import {
  ChevronDown, ChevronUp, ChevronRight,
  Filter, Download, CheckCircle, AlertCircle, AlertTriangle,
} from 'lucide-react'
import type { AuditReport, AuditRow } from '../types'
import { sourceTypeIcon, locationLabel } from '../types'
import { downloadAuditCsv } from '../api/client'
import { cn } from '../utils/cn'

interface Props {
  report: AuditReport
}

const STATUS_META: Record<string, { badge: string; icon: React.ReactNode; bar: string }> = {
  PASS: {
    badge: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700',
    icon: <CheckCircle size={13} className="text-emerald-400" />,
    bar:  'bg-emerald-500',
  },
  FAIL: {
    badge: 'bg-red-900/60 text-red-300 border border-red-700',
    icon: <AlertCircle size={13} className="text-red-400" />,
    bar:  'bg-red-500',
  },
  WARN: {
    badge: 'bg-amber-900/60 text-amber-300 border border-amber-700',
    icon: <AlertTriangle size={13} className="text-amber-400" />,
    bar:  'bg-amber-500',
  },
}

const FIELD_LABELS: Record<string, string> = {
  unit_price:       'Unit Price',
  discount_percent: 'Discount %',
  tax_percent:      'Tax %',
  total_amount:     'Total Amount',
  sku:              'SKU',
}

type SortKey = 'sku' | 'field_checked' | 'expected_value' | 'actual_value' | 'delta' | 'status'
type FilterStatus = 'ALL' | 'PASS' | 'FAIL' | 'WARN'

export function AuditTable({ report }: Props) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL')
  const [filterSku, setFilterSku]       = useState('')
  const [sortKey, setSortKey]           = useState<SortKey>('status')
  const [sortAsc, setSortAsc]           = useState(true)
  const [expandedIdx, setExpandedIdx]   = useState<number | null>(null)

  const skus = useMemo(() => [...new Set(report.rows.map(r => r.sku))], [report])

  const filtered = useMemo(() => {
    let rows = report.rows.map((r, i) => ({ ...r, _origIdx: i }))
    if (filterStatus !== 'ALL') rows = rows.filter(r => r.status === filterStatus)
    if (filterSku)              rows = rows.filter(r => r.sku === filterSku)
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

  // Reset expansion when filters change
  const prevFilter = React.useRef({ filterStatus, filterSku, sortKey, sortAsc })
  React.useEffect(() => {
    const p = prevFilter.current
    if (p.filterStatus !== filterStatus || p.filterSku !== filterSku
        || p.sortKey !== sortKey || p.sortAsc !== sortAsc) {
      setExpandedIdx(null)
      prevFilter.current = { filterStatus, filterSku, sortKey, sortAsc }
    }
  }, [filterStatus, filterSku, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  const toggleRow = (i: number) => setExpandedIdx(prev => prev === i ? null : i)

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k
      ? <ChevronDown size={11} className="text-slate-600" />
      : sortAsc
        ? <ChevronUp size={11} className="text-blue-400" />
        : <ChevronDown size={11} className="text-blue-400" />

  const COLS = 7  // SKU · Field · Expected · Actual · Delta · Status · Expand

  return (
    <div className="space-y-4">
      {/* Summary filter cards */}
      <div className="grid grid-cols-3 gap-3">
        {([ 
          { label: 'PASS' as FilterStatus, count: report.pass_count },
          { label: 'FAIL' as FilterStatus, count: report.fail_count },
          { label: 'WARN' as FilterStatus, count: report.warn_count },
        ]).map(({ label, count }) => {
          const meta = STATUS_META[label]
          return (
            <button
              key={label}
              onClick={() => setFilterStatus(prev => prev === label ? 'ALL' : label)}
              className={cn(
                'rounded-xl border p-3 text-center transition-all select-none',
                meta.badge,
                filterStatus === label
                  ? 'ring-2 ring-offset-1 ring-offset-slate-950 ring-current opacity-100'
                  : 'hover:opacity-80',
              )}
            >
              <div className="flex justify-center mb-1">{meta.icon}</div>
              <div className="text-2xl font-bold leading-none">{count}</div>
              <div className="text-xs font-medium opacity-60 mt-1">{label}</div>
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={13} className="text-slate-400 shrink-0" />
        <select
          value={filterSku}
          onChange={e => setFilterSku(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All SKUs</option>
          {skus.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-slate-500 flex-1">
          {filtered.length} of {report.rows.length} checks
        </span>
        <button
          onClick={() => downloadAuditCsv(report.job_id)}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-3 py-1.5 rounded-lg transition-colors"
        >
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left min-w-[560px]">
            <thead>
              <tr className="bg-slate-800 border-b border-slate-700">
                {([
                  { key: 'sku',            label: 'SKU'      },
                  { key: 'field_checked',  label: 'Field'    },
                  { key: 'expected_value', label: 'Expected' },
                  { key: 'actual_value',   label: 'Actual'   },
                  { key: 'delta',          label: 'Delta'    },
                  { key: 'status',         label: 'Status'   },
                ] as { key: SortKey; label: string }[]).map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="px-4 py-3 font-semibold text-slate-400 cursor-pointer hover:text-slate-200 select-none whitespace-nowrap text-xs uppercase tracking-wide"
                  >
                    <span className="flex items-center gap-1">{label}<SortIcon k={key} /></span>
                  </th>
                ))}
                {/* Expand toggle — no header label */}
                <th className="px-3 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const isExpanded = expandedIdx === i
                const meta = STATUS_META[row.status] ?? STATUS_META.WARN

                return (
                  <React.Fragment key={i}>
                    {/* Main data row */}
                    <tr
                      onClick={() => toggleRow(i)}
                      className={cn(
                        'border-b border-slate-800/60 cursor-pointer transition-colors group',
                        i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/40',
                        isExpanded ? 'bg-slate-800/80 border-b-0' : 'hover:bg-slate-800/60',
                      )}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-slate-200 whitespace-nowrap">
                        {row.sku}
                      </td>
                      <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                        {FIELD_LABELS[row.field_checked] ?? row.field_checked}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                        {row.expected_value}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                        {row.actual_value}
                      </td>
                      <td className={cn(
                        'px-4 py-3 font-mono font-semibold whitespace-nowrap',
                        row.delta === 0 ? 'text-slate-500'
                          : row.delta > 0 ? 'text-red-400' : 'text-amber-400',
                      )}>
                        {row.delta > 0 ? `+${row.delta}` : row.delta}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap',
                          meta.badge,
                        )}>
                          {meta.icon}
                          {row.status}
                        </span>
                      </td>
                      {/* Expand chevron */}
                      <td className="px-3 py-3 text-slate-500 group-hover:text-slate-300 transition-colors">
                        <ChevronRight
                          size={15}
                          className={cn(
                            'transition-transform duration-200',
                            isExpanded ? 'rotate-90 text-blue-400' : '',
                          )}
                        />
                      </td>
                    </tr>

                    {/* Accordion expansion */}
                    {isExpanded && (
                      <tr className="border-b border-slate-700">
                        <td colSpan={COLS} className="bg-slate-800/50 px-5 py-4">
                          <div className="space-y-4">
                            {/* Status bar accent */}
                            <div className={cn('h-0.5 rounded-full w-full', meta.bar)} />

                            {/* Explanation */}
                            <div>
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                                AI Explanation
                              </p>
                              <p className="text-sm text-slate-200 leading-relaxed">
                                {row.explanation || 'No explanation provided.'}
                              </p>
                            </div>

                            {/* Evidence cards */}
                            {row.evidence.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                                  Source Evidence ({row.evidence.length})
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {row.evidence.map((ev, j) => (
                                    <div
                                      key={j}
                                      className="bg-slate-900 border border-slate-700 rounded-xl p-3 space-y-2"
                                    >
                                      {/* Source header */}
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-base leading-none">
                                          {sourceTypeIcon(ev.source_file)}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-200">
                                          {locationLabel(ev)}
                                        </span>
                                        {ev.score != null && (
                                          <span className="ml-auto text-xs text-slate-500 font-mono">
                                            {(ev.score * 100).toFixed(0)}% match
                                          </span>
                                        )}
                                      </div>
                                      {/* Excerpt */}
                                      {ev.excerpt && (
                                        <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap break-words bg-slate-950/60 rounded-lg p-2 max-h-32 overflow-y-auto">
                                          {ev.excerpt}
                                        </pre>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="py-12 text-center text-slate-500 text-sm">
              No results match the current filters.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
