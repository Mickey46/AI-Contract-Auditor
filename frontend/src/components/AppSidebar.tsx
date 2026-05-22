import React, { useEffect } from 'react'
import { X, FileSearch } from 'lucide-react'
import { UploadPanel } from './UploadPanel'

interface Props {
  open: boolean
  onClose: () => void
  loading: boolean
  onAuditStart: (contracts: File[], invoice: File, apiKey: string) => void
}

export function AppSidebar({ open, onClose, loading, onAuditStart }: Props) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={[
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/* Drawer panel */}
      <div
        className={[
          'fixed top-0 left-0 z-50 h-full w-[360px] bg-slate-900 border-r border-slate-700',
          'flex flex-col shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <FileSearch size={14} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-slate-100 text-sm leading-none">Run Audit</p>
              <p className="text-xs text-slate-400 leading-none mt-0.5">Upload documents &amp; configure</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <UploadPanel
            onAuditStart={(c, i, k) => { onAuditStart(c, i, k); onClose() }}
            loading={loading}
          />
        </div>
      </div>
    </>
  )
}
