import React, { useState, useEffect, useRef } from 'react'
import { ShieldCheck, MessageSquare, BarChart3, Menu, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { AuditTable }    from './components/AuditTable'
import { ContractQA }    from './components/ContractQA'
import { RiskDashboard } from './components/RiskDashboard'
import { AuditProgress } from './components/AuditProgress'
import { AppSidebar }    from './components/AppSidebar'
import { startAudit, pollJobStatus } from './api/client'
import type { AuditReport, JobStatus } from './types'
import { cn } from './utils/cn'

type Tab = 'audit' | 'qa'

// Map WebSocket message → short label for the nav bar pill
function shortStep(msg: string | null): string {
  if (!msg) return 'Starting…'
  const m = msg.toLowerCase()
  if (m.includes('compar') || m.includes('building')) return 'Comparing…'
  if (m.includes('extract') || m.includes('term'))    return 'Extracting terms…'
  if (m.includes('sku') && m.includes('/'))           return msg.replace(/Extracted?\s+/i, '').split('(')[0].trim() + ' extracted'
  if (m.includes('embed')  || m.includes('chroma'))   return 'Embedding…'
  if (m.includes('ingest') || m.includes('chunk'))    return 'Ingesting docs…'
  if (m.includes('pars'))                             return 'Parsing invoice…'
  return msg.length > 40 ? msg.slice(0, 40) + '…' : msg
}

export default function App() {
  const [jobStatus,   setJobStatus]   = useState<JobStatus | null>(null)
  const [activeTab,   setActiveTab]   = useState<Tab>('audit')
  const [loading,     setLoading]     = useState(false)
  const [apiKey,      setApiKey]      = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const wsRef         = useRef<WebSocket | null>(null)
  const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const terminalRef   = useRef(false)
  const userPickedTab = useRef(false)

  function stopAll() {
    if (wsRef.current)   { wsRef.current.close(); wsRef.current = null }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  function onStatusUpdate(status: JobStatus) {
    setJobStatus(status)
    if (status.status === 'done' || status.status === 'error') {
      terminalRef.current = true
      stopAll()
      setLoading(false)
      if (status.status === 'done' && !userPickedTab.current) setActiveTab('audit')
    }
  }

  function startPollingFallback(job_id: string) {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      if (terminalRef.current) { clearInterval(pollRef.current!); pollRef.current = null; return }
      try { const s = await pollJobStatus(job_id); onStatusUpdate(s) }
      catch { /* keep retrying */ }
    }, 2000)
  }

  async function handleAuditStart(contracts: File[], invoice: File, key: string) {
    setApiKey(key)
    setLoading(true)
    setJobStatus(null)
    userPickedTab.current = false
    terminalRef.current   = false
    stopAll()

    try {
      const { job_id } = await startAudit(contracts, invoice, key)
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws    = new WebSocket(`${proto}//${window.location.host}/api/ws/audit/${job_id}`)
      wsRef.current = ws

      ws.onmessage = (e: MessageEvent) => {
        try { onStatusUpdate(JSON.parse(e.data as string) as JobStatus) } catch { /* skip */ }
      }
      ws.onerror = () => { ws.close(); wsRef.current = null; if (!terminalRef.current) startPollingFallback(job_id) }
      ws.onclose = () => { wsRef.current = null;              if (!terminalRef.current) startPollingFallback(job_id) }
      setTimeout(() => {
        if (!terminalRef.current && wsRef.current?.readyState !== WebSocket.OPEN && !pollRef.current)
          startPollingFallback(job_id)
      }, 3000)
    } catch (err) {
      setLoading(false)
      setJobStatus({ job_id: '', status: 'error', message: err instanceof Error ? err.message : 'Failed to start audit', report: null })
    }
  }

  function handleTabClick(tab: Tab) { userPickedTab.current = true; setActiveTab(tab) }
  useEffect(() => () => stopAll(), [])

  const report: AuditReport | null = jobStatus?.report ?? null

  const tabs: { id: Tab; icon: React.ReactNode; label: string; badge?: number }[] = [
    { id: 'audit', icon: <BarChart3    size={14} />, label: 'Audit Results', badge: report?.fail_count },
    { id: 'qa',    icon: <MessageSquare size={14} />, label: 'Contract Q&A' },
  ]

  // Nav bar center content — changes based on app state
  const navCenter = loading ? (
    <div className="flex items-center gap-2 bg-blue-950/60 border border-blue-700 rounded-full px-3 py-1.5 text-xs">
      <Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />
      <span className="text-blue-300 font-medium max-w-[200px] truncate">
        {shortStep(jobStatus?.message ?? null)}
      </span>
    </div>
  ) : jobStatus?.status === 'done' && report ? (
    <div className="flex items-center gap-2 text-xs">
      <CheckCircle size={13} className="text-emerald-400" />
      <span className="text-emerald-300 font-medium">
        Audit complete —{' '}
        <span className="text-emerald-400">{report.pass_count} PASS</span>
        {' · '}
        <span className="text-red-400">{report.fail_count} FAIL</span>
        {report.warn_count > 0 && <span className="text-amber-400"> · {report.warn_count} WARN</span>}
      </span>
    </div>
  ) : jobStatus?.status === 'error' ? (
    <div className="flex items-center gap-1.5 text-xs text-red-400">
      <XCircle size={13} />
      <span>Audit failed</span>
    </div>
  ) : null

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">

      {/* ── Nav bar ─────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur z-30">
        <div className="w-full px-4 py-2.5 flex items-center gap-4">

          {/* LEFT: upload trigger + logo */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
            >
              <Menu size={14} />
              <span>Upload</span>
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center shrink-0">
                <ShieldCheck size={13} className="text-white" />
              </div>
              <span className="font-bold text-slate-100 text-sm whitespace-nowrap">AI Contract Auditor</span>
            </div>
          </div>

          {/* CENTER: live status — grows to fill space */}
          <div className="flex-1 flex justify-center">
            {navCenter}
          </div>

          {/* RIGHT: tech stack badges */}
          <div className="flex items-center gap-1.5 shrink-0">
            {[
              { label: 'LangChain', color: 'text-green-400 border-green-800 bg-green-950/40' },
              { label: 'ChromaDB',  color: 'text-purple-400 border-purple-800 bg-purple-950/40' },
              { label: 'GPT-4o',   color: 'text-blue-400 border-blue-800 bg-blue-950/40' },
            ].map(b => (
              <span key={b.label} className={cn('text-[10px] font-semibold border px-2 py-0.5 rounded-full hidden sm:inline', b.color)}>
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Slide-out upload sidebar ─────────────────────────────── */}
      <AppSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        loading={loading}
        onAuditStart={handleAuditStart}
      />

      {/* ── Main content ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden flex flex-col w-full max-w-[1600px] mx-auto px-4 sm:px-6 py-5 gap-4">

          {/* Empty state */}
          {!report && !loading && (
            <div className="flex flex-col items-center justify-center flex-1 text-center">
              <div className="w-20 h-20 rounded-3xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mb-5">
                <ShieldCheck size={32} className="text-slate-500" />
              </div>
              <h2 className="text-xl font-semibold text-slate-300">No audit running</h2>
              <p className="text-sm text-slate-500 mt-2 max-w-xs leading-relaxed">
                Click <strong className="text-slate-300">Upload</strong> to add your contracts and invoice CSV, then hit Run Audit.
              </p>
              <button
                onClick={() => setSidebarOpen(true)}
                className="mt-6 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors"
              >
                Get started →
              </button>
            </div>
          )}

          {/* Loading progress — full width card */}
          {loading && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl px-6 py-7 shrink-0">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">Running audit pipeline</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    WebSocket live — parallel SKU extraction · ChromaDB RAG
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-950/40 border border-blue-800 rounded-full px-3 py-1">
                  <Loader2 size={11} className="animate-spin" />
                  live
                </div>
              </div>
              <AuditProgress message={jobStatus?.message ?? null} />
            </div>
          )}

          {/* Error banner */}
          {jobStatus?.status === 'error' && !loading && (
            <div className="bg-red-950/40 border border-red-700 rounded-2xl px-5 py-4 flex items-start gap-3 shrink-0">
              <XCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-300">Audit failed</p>
                <p className="text-xs text-red-400/80 mt-1 font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                  {jobStatus.message}
                </p>
              </div>
            </div>
          )}

          {/* Results */}
          {report && (
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              <div className="shrink-0">
                <RiskDashboard report={report} />
              </div>

              <div className="flex-1 overflow-hidden flex flex-col bg-slate-900 border border-slate-800 rounded-2xl">
                {/* Tabs */}
                <div className="flex items-center border-b border-slate-800 px-2 shrink-0">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => handleTabClick(tab.id)}
                      className={cn(
                        'relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors',
                        activeTab === tab.id
                          ? 'border-blue-500 text-blue-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200',
                      )}
                    >
                      {tab.icon}
                      {tab.label}
                      {tab.badge != null && tab.badge > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  {activeTab === 'audit' && <AuditTable report={report} />}
                  {activeTab === 'qa'    && (
                    <div className="h-full" style={{ minHeight: '480px' }}>
                      <ContractQA jobId={report.job_id} apiKey={apiKey} report={report} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
