import React, { useState, useEffect, useRef } from 'react'
import { FileSearch, MessageSquare, BarChart3, ClipboardList, Layers } from 'lucide-react'
import { UploadPanel } from './components/UploadPanel'
import { AuditTable } from './components/AuditTable'
import { EvidenceDrawer } from './components/EvidenceDrawer'
import { ContractQA } from './components/ContractQA'
import { SourcePanel } from './components/SourcePanel'
import { StatusBar } from './components/StatusBar'
import { RiskDashboard } from './components/RiskDashboard'
import { AuditLogPanel } from './components/AuditLogPanel'
import { BatchUpload } from './components/BatchUpload'
import { startAudit, pollJobStatus } from './api/client'
import type { AuditRow, AuditReport, JobStatus } from './types'
import { cn } from './utils/cn'

type Tab = 'audit' | 'qa' | 'log' | 'batch'

export default function App() {
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [selectedRow, setSelectedRow] = useState<AuditRow | null>(null)
  const [selectedRowIdx, setSelectedRowIdx] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<Tab>('audit')
  const [loading, setLoading] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [contractFiles, setContractFiles] = useState<File[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  async function handleAuditStart(contracts: File[], invoice: File, key: string) {
    setApiKey(key)
    setContractFiles(contracts)
    setLoading(true)
    setJobStatus(null)
    setSelectedRow(null)

    try {
      const { job_id } = await startAudit(contracts, invoice, key)
      pollRef.current = setInterval(async () => {
        const status = await pollJobStatus(job_id)
        setJobStatus(status)
        if (status.status === 'done' || status.status === 'error') {
          stopPolling()
          setLoading(false)
          if (status.status === 'done') setActiveTab('audit')
        }
      }, 2000)
    } catch (err) {
      setLoading(false)
      setJobStatus({
        job_id: '',
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to start audit',
        report: null,
      })
    }
  }

  function handleRowClick(row: AuditRow, idx: number) {
    setSelectedRow(row)
    setSelectedRowIdx(idx)
  }

  function handleOverride(rowIndex: number, newStatus: string, reason: string) {
    if (!jobStatus?.report) return
    const updatedRows = jobStatus.report.rows.map((r, i) =>
      i === rowIndex
        ? { ...r, override_status: newStatus, override_reason: reason, overridden_by: 'analyst', overridden_at: new Date().toISOString() }
        : r
    )
    const updatedReport = { ...jobStatus.report, rows: updatedRows }
    setJobStatus(prev => prev ? { ...prev, report: updatedReport } : prev)
    // Also update the selected row in the drawer
    setSelectedRow(updatedRows[rowIndex])
  }

  function handleBatchReport(report: AuditReport) {
    setJobStatus({ job_id: report.job_id, status: 'done', message: null, report })
    setActiveTab('audit')
  }

  useEffect(() => () => stopPolling(), [])

  const report: AuditReport | null = jobStatus?.report ?? null

  const tabs: { id: Tab; icon: React.ReactNode; label: string; badge?: number }[] = [
    { id: 'audit', icon: <BarChart3 size={14} />, label: 'Audit Results', badge: report?.fail_count },
    { id: 'qa', icon: <MessageSquare size={14} />, label: 'Contract Q&A' },
    { id: 'log', icon: <ClipboardList size={14} />, label: 'Override Log' },
    { id: 'batch', icon: <Layers size={14} />, label: 'Batch Audit' },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top nav */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <FileSearch size={16} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-100 leading-none">AI Contract Auditor</h1>
              <p className="text-xs text-slate-400 leading-none mt-0.5">Production-grade · RAG + Reconciler + Confidence scoring</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {['GPT-5.5', 'o3', 'ChromaDB', 'LangChain'].map(t => (
              <span key={t} className="bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">{t}</span>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-6 py-6 flex gap-6 min-h-[calc(100vh-57px)]">
        {/* Left sidebar */}
        <aside className="w-80 shrink-0 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2 text-sm">
              <BarChart3 size={15} className="text-blue-400" />
              Upload & Configure
            </h2>
            <UploadPanel onAuditStart={handleAuditStart} loading={loading} />
          </div>

          {report && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <SourcePanel report={report} />
            </div>
          )}
        </aside>

        {/* Main area */}
        <main className="flex-1 min-w-0 space-y-4">
          {jobStatus && <StatusBar jobStatus={jobStatus} />}

          {/* Empty state */}
          {!report && !loading && (
            <div className="flex flex-col items-center justify-center h-96 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-4">
                <FileSearch size={28} className="text-slate-500" />
              </div>
              <h2 className="text-lg font-semibold text-slate-300">No audit results yet</h2>
              <p className="text-sm text-slate-500 mt-1 max-w-sm">
                Upload contract documents + invoice CSV and click Run Audit.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 text-left max-w-md">
                {[
                  ['Structured Excel parser', 'Reads pricing tables directly — no hallucinations'],
                  ['Regex pre-extractor', 'Deterministic amendment pattern matching'],
                  ['LLM reasoning (o3/GPT-5.5)', 'Multi-document conflict resolution'],
                  ['Confidence scoring', 'Per-field 0–100% confidence with review flag'],
                ].map(([title, desc]) => (
                  <div key={title} className="bg-slate-800/50 border border-slate-700 rounded-xl p-3">
                    <p className="text-xs font-semibold text-slate-300">{title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center h-96 text-center space-y-4">
              <div className="w-12 h-12 rounded-full border-4 border-blue-600/30 border-t-blue-500 animate-spin" />
              <p className="text-slate-300 font-medium">{jobStatus?.message ?? 'Processing...'}</p>
              <p className="text-xs text-slate-500 max-w-xs">
                Effective-date filter → regex pre-extraction → ChromaDB embed → LLM extraction → reconciliation
              </p>
            </div>
          )}

          {/* Results */}
          {report && (
            <div className="space-y-4">
              <RiskDashboard report={report} />

              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b border-slate-800">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors relative',
                        activeTab === tab.id
                          ? 'border-blue-500 text-blue-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200',
                      )}
                    >
                      {tab.icon}
                      {tab.label}
                      {tab.badge != null && tab.badge > 0 && (
                        <span className="absolute -top-0.5 right-2 bg-red-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                          {tab.badge > 9 ? '9+' : tab.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="p-5">
                  {activeTab === 'audit' && (
                    <AuditTable report={report} onRowClick={handleRowClick} />
                  )}
                  {activeTab === 'qa' && (
                    <div className="h-[600px]">
                      <ContractQA jobId={report.job_id} apiKey={apiKey} />
                    </div>
                  )}
                  {activeTab === 'log' && (
                    <AuditLogPanel jobId={report.job_id} />
                  )}
                  {activeTab === 'batch' && (
                    <BatchUpload
                      contractFiles={contractFiles}
                      apiKey={apiKey}
                      onSelectReport={handleBatchReport}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Batch tab available even without a report */}
          {!report && !loading && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="flex border-b border-slate-800">
                <button className="flex items-center gap-1.5 px-5 py-3.5 text-sm font-medium border-b-2 border-blue-500 text-blue-400">
                  <Layers size={14} />
                  Batch Audit
                </button>
              </div>
              <div className="p-5">
                <BatchUpload
                  contractFiles={contractFiles}
                  apiKey={apiKey}
                  onSelectReport={handleBatchReport}
                />
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Evidence drawer */}
      <EvidenceDrawer
        row={selectedRow}
        rowIndex={selectedRowIdx}
        jobId={report?.job_id ?? ''}
        onClose={() => setSelectedRow(null)}
        onOverride={handleOverride}
      />
    </div>
  )
}
