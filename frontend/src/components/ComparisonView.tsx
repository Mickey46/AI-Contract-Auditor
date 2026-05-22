import React from 'react'
import type { AuditRow } from '../types'
import { ConfidenceBadge } from './ConfidenceBadge'
import { cn } from '../utils/cn'

const FIELD_LABELS: Record<string, string> = {
  unit_price: 'Unit Price (USD)',
  discount_percent: 'Discount (%)',
  tax_percent: 'Tax Rate (%)',
  total_amount: 'Total Amount (USD)',
}

interface Props {
  row: AuditRow
}

export function ComparisonView({ row }: Props) {
  const label = FIELD_LABELS[row.field_checked] ?? row.field_checked
  const isPass = row.status === 'PASS' && !row.override_status

  if (isPass) return null

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>

      <div className="grid grid-cols-2 gap-3">
        {/* Contract */}
        <div className="rounded-xl border border-emerald-700 bg-emerald-950/30 p-4 space-y-2">
          <p className="text-xs uppercase font-semibold text-emerald-300/80 tracking-wide">Contract says</p>
          <p className="text-3xl font-mono font-bold text-emerald-200">{row.expected_value}</p>
          {row.sources_agreeing.length > 0 && (
            <p className="text-xs text-emerald-400/80">
              Verified by: {row.sources_agreeing.join(', ')}
            </p>
          )}
          {row.conflicts.length > 0 && (
            <p className="text-xs text-amber-400">
              Conflicts: {row.conflicts.join(', ')}
            </p>
          )}
        </div>

        {/* Invoice */}
        <div className="rounded-xl border border-red-700 bg-red-950/30 p-4 space-y-2">
          <p className="text-xs uppercase font-semibold text-red-300/80 tracking-wide">Invoice says</p>
          <p className="text-3xl font-mono font-bold text-red-200">{row.actual_value}</p>
          {row.quantity > 0 && (
            <p className="text-xs text-red-400/80">Qty: {row.quantity.toLocaleString()}</p>
          )}
          <p className={cn(
            'text-sm font-mono font-bold',
            row.dollar_impact > 0 ? 'text-red-400' : row.dollar_impact < 0 ? 'text-amber-400' : 'text-slate-400',
          )}>
            {row.dollar_impact > 0 ? '+' : ''}${row.dollar_impact.toFixed(2)} exposure
          </p>
        </div>
      </div>

      {/* Delta bar */}
      <div className="flex items-center justify-between rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-2">
        <span className="text-xs text-slate-400">Delta</span>
        <span className={cn(
          'font-mono font-bold text-sm',
          row.delta > 0 ? 'text-red-400' : row.delta < 0 ? 'text-amber-400' : 'text-slate-400',
        )}>
          {row.delta > 0 ? '+' : ''}{row.delta}
        </span>
        <ConfidenceBadge value={row.confidence} reviewRequired={row.review_required} />
      </div>
    </div>
  )
}
