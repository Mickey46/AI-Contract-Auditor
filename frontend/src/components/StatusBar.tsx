import React from 'react'
import { Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import type { JobStatus } from '../types'

interface Props {
  jobStatus: JobStatus | null
}

export function StatusBar({ jobStatus }: Props) {
  if (!jobStatus) return null

  const icons = {
    pending: <Loader2 className="animate-spin text-slate-400" size={16} />,
    running: <Loader2 className="animate-spin text-blue-400" size={16} />,
    done: <CheckCircle className="text-emerald-400" size={16} />,
    error: <XCircle className="text-red-400" size={16} />,
  }

  const colors = {
    pending: 'border-slate-600 bg-slate-800/60',
    running: 'border-blue-700 bg-blue-950/40',
    done: 'border-emerald-700 bg-emerald-950/40',
    error: 'border-red-700 bg-red-950/40',
  }

  return (
    <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 text-sm ${colors[jobStatus.status]}`}>
      {icons[jobStatus.status]}
      <span className="text-slate-300">
        {jobStatus.status === 'done' && jobStatus.report
          ? `Audit complete — ${jobStatus.report.pass_count} PASS · ${jobStatus.report.fail_count} FAIL · ${jobStatus.report.warn_count} WARN`
          : jobStatus.message ?? jobStatus.status}
      </span>
    </div>
  )
}
