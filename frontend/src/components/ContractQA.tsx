import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { askQuestion } from '../api/client'
import type { AuditReport, QAResponse } from '../types'
import { locationLabel, sourceTypeIcon } from '../types'
import { cn } from '../utils/cn'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: QAResponse['sources']
}

interface Props {
  jobId: string
  apiKey: string
  report: AuditReport
}

/** Build context-aware suggested questions from the actual audit rows */
function buildSuggestions(report: AuditReport): string[] {
  const skus   = [...new Set(report.rows.map(r => r.sku))]
  const failed = report.rows.filter(r => r.status === 'FAIL')

  const suggestions: string[] = []

  // One question per failed field, most interesting first
  const failedDiscount = failed.find(r => r.field_checked === 'discount_percent')
  if (failedDiscount) {
    suggestions.push(
      `What is the correct discount percentage for ${failedDiscount.sku}?`
    )
  }

  const failedPrice = failed.find(r => r.field_checked === 'unit_price')
  if (failedPrice) {
    suggestions.push(
      `Which document changed the unit price for ${failedPrice.sku}?`
    )
  }

  // Ask about a SKU that fully passed (shows contrast)
  const passedSku = skus.find(s => report.rows.filter(r => r.sku === s).every(r => r.status === 'PASS'))
  if (passedSku) {
    suggestions.push(`What are the contract terms for ${passedSku}?`)
  }

  // Generic fallback questions using real SKUs from this audit
  if (suggestions.length < 4 && skus[0]) {
    suggestions.push(`What tax rate applies to ${skus[0]}?`)
  }
  if (suggestions.length < 4 && skus.length > 1) {
    suggestions.push(`Which contract document has the highest authority for ${skus[1]}?`)
  }

  return suggestions.slice(0, 4)
}

export function ContractQA({ jobId, apiKey, report }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Ask me anything about the uploaded contract documents. I will answer using the indexed chunks and tell you exactly which page, sheet, or section the answer came from.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const SUGGESTED = useMemo(() => buildSuggestions(report), [report])

  async function send(text = input) {
    if (!text.trim() || loading) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    setLoading(true)
    try {
      const res = await askQuestion(jobId, text, apiKey)
      setMessages((m) => [...m, { role: 'assistant', content: res.answer, sources: res.sources }])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${msg}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-4 p-4 scrollbar-thin">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : '')}>
            {msg.role === 'assistant' && (
              <div className="shrink-0 w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold text-white mt-0.5">
                AI
              </div>
            )}
            <div className={cn(
              'max-w-[85%] space-y-3',
              msg.role === 'user' ? 'items-end' : '',
            )}>
              <div className={cn(
                'rounded-2xl px-4 py-3 text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700',
              )}>
                {msg.content}
              </div>

              {/* Source citations */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500 font-medium">Sources used:</p>
                  {msg.sources.map((src, j) => (
                    <div
                      key={j}
                      className="group bg-slate-800/60 border border-slate-700 rounded-xl p-3 space-y-2 hover:border-blue-600 transition-colors cursor-default"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{sourceTypeIcon(src.source_file)}</span>
                        <span className="text-xs font-semibold text-slate-200">
                          {locationLabel(src)}
                        </span>
                      </div>
                      <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap break-words bg-slate-900/60 rounded p-2 max-h-28 overflow-y-auto scrollbar-thin">
                        {src.excerpt}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 size={14} className="animate-spin" />
            Searching contract documents...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2">
          <p className="text-xs text-slate-500 mb-2">Suggested questions:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="text-xs bg-slate-800 border border-slate-600 hover:border-blue-500 text-slate-300 rounded-lg px-3 py-1.5 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-slate-700">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ask about contract terms, pricing, discounts..."
            className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white p-2.5 rounded-xl transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
