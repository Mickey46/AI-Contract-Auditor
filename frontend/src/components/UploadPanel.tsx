import React, { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileText, X, Play } from 'lucide-react'
import { cn } from '../utils/cn'
import { sourceTypeIcon } from '../types'

interface Props {
  onAuditStart: (contracts: File[], invoice: File, apiKey: string) => void
  loading: boolean
}

export function UploadPanel({ onAuditStart, loading }: Props) {
  const [contracts, setContracts] = useState<File[]>([])
  const [invoice, setInvoice] = useState<File | null>(null)

  const contractDrop = useDropzone({
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'message/rfc822': ['.eml'],
      'text/plain': ['.eml'],
    },
    onDrop: (files) => setContracts((prev) => [...prev, ...files]),
    multiple: true,
  })

  const invoiceDrop = useDropzone({
    accept: { 'text/csv': ['.csv'] },
    onDrop: (files) => files[0] && setInvoice(files[0]),
    multiple: false,
  })

  const removeContract = (i: number) =>
    setContracts((prev) => prev.filter((_, idx) => idx !== i))

  const canRun = contracts.length > 0 && invoice !== null

  return (
    <div className="space-y-6">
      {/* Contract files drop zone */}
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-2 uppercase tracking-wide">
          Contract Documents
        </h3>
        <div
          {...contractDrop.getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            contractDrop.isDragActive
              ? 'border-blue-400 bg-blue-950/30'
              : 'border-slate-600 hover:border-slate-400 bg-slate-800/30',
          )}
        >
          <input {...contractDrop.getInputProps()} />
          <Upload className="mx-auto mb-2 text-slate-400" size={28} />
          <p className="text-sm text-slate-400">
            Drop PDF, XLSX, DOCX, or EML files here
          </p>
          <p className="text-xs text-slate-500 mt-1">Multiple files allowed</p>
        </div>

        {contracts.length > 0 && (
          <ul className="mt-3 space-y-2">
            {contracts.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm text-slate-200">
                  <span>{sourceTypeIcon(f.name)}</span>
                  {f.name}
                  <span className="text-xs text-slate-500">
                    ({(f.size / 1024).toFixed(0)} KB)
                  </span>
                </span>
                <button
                  onClick={() => removeContract(i)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invoice drop zone */}
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-2 uppercase tracking-wide">
          Invoice CSV
        </h3>
        <div
          {...invoiceDrop.getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors',
            invoiceDrop.isDragActive
              ? 'border-emerald-400 bg-emerald-950/30'
              : invoice
              ? 'border-emerald-600 bg-emerald-950/20'
              : 'border-slate-600 hover:border-slate-400 bg-slate-800/30',
          )}
        >
          <input {...invoiceDrop.getInputProps()} />
          {invoice ? (
            <div className="flex items-center justify-center gap-2 text-emerald-400">
              <FileText size={18} />
              <span className="text-sm font-medium">{invoice.name}</span>
            </div>
          ) : (
            <>
              <FileText className="mx-auto mb-1 text-slate-400" size={24} />
              <p className="text-sm text-slate-400">Drop invoice CSV here</p>
            </>
          )}
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={() => invoice && onAuditStart(contracts, invoice, '')}
        disabled={!canRun || loading}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all',
          canRun && !loading
            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/40'
            : 'bg-slate-700 text-slate-500 cursor-not-allowed',
        )}
      >
        {loading ? (
          <>
            <span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />
            Running Audit...
          </>
        ) : (
          <>
            <Play size={16} />
            Run Audit
          </>
        )}
      </button>
    </div>
  )
}
