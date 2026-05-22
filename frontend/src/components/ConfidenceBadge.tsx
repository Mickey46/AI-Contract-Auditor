import React from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { cn } from '../utils/cn'

interface Props {
  value: number
  reviewRequired: boolean
}

export function ConfidenceBadge({ value, reviewRequired }: Props) {
  const pct = Math.round(value * 100)
  const tier =
    value >= 0.95
      ? { label: 'HIGH', cls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700' }
      : value >= 0.80
      ? { label: 'GOOD', cls: 'bg-blue-900/60 text-blue-300 border-blue-700' }
      : value >= 0.60
      ? { label: 'MED', cls: 'bg-amber-900/60 text-amber-300 border-amber-700' }
      : { label: 'LOW', cls: 'bg-red-900/60 text-red-300 border-red-700' }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border whitespace-nowrap',
        tier.cls,
      )}
      title={reviewRequired ? 'Requires human review' : 'Confidence verified'}
    >
      {reviewRequired ? <AlertTriangle size={10} /> : <ShieldCheck size={10} />}
      {tier.label} {pct}%
    </span>
  )
}
