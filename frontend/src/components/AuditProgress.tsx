import React, { useEffect, useRef, useState } from 'react'
import { CheckCircle, Loader2, Circle, Clock } from 'lucide-react'
import { cn } from '../utils/cn'

interface Props {
  message: string | null
}

const PIPELINE = [
  { id: 'parse',   label: 'Parse invoice',                   hint: 'Reading CSV rows'               },
  { id: 'ingest',  label: 'Ingest contract documents',       hint: 'PDF · DOCX · XLSX · EML'        },
  { id: 'embed',   label: 'Embed chunks → ChromaDB',         hint: 'text-embedding-3-large'          },
  { id: 'extract', label: 'Extract contract terms (LLM)',    hint: 'Parallel per-SKU GPT calls'      },
  { id: 'compare', label: 'Compare invoice vs contract',     hint: 'Field-level diff'                },
]

function resolveStep(msg: string | null): string {
  if (!msg) return 'parse'
  const m = msg.toLowerCase()
  if (m.includes('compar') || m.includes('building')) return 'compare'
  if (m.includes('extract') || m.includes('sku') || m.includes('term')) return 'extract'
  if (m.includes('embed')   || m.includes('chroma'))  return 'embed'
  if (m.includes('ingest')  || m.includes('chunk'))   return 'ingest'
  return 'parse'
}

function fmtElapsed(s: number) {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export function AuditProgress({ message }: Props) {
  // Accumulate per-SKU completions — never reset within a run
  const [completedSkus, setCompletedSkus] = useState<string[]>([])
  const [totalSkus,     setTotalSkus]     = useState<number>(0)
  const [elapsed,       setElapsed]       = useState(0)
  const seenSkus = useRef(new Set<string>())

  // Elapsed timer
  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Parse incoming messages to accumulate state
  useEffect(() => {
    if (!message) return
    // "Extracting contract terms for N SKU(s) in parallel..."
    const totalMatch = message.match(/for\s+(\d+)\s+sku/i)
    if (totalMatch) { setTotalSkus(parseInt(totalMatch[1], 10)); return }

    // "Extracted CP-001 (2/4)"
    const doneMatch = message.match(/Extracted?\s+(\S+)\s+\((\d+)\/(\d+)\)/i)
    if (doneMatch) {
      const sku  = doneMatch[1]
      const tot  = parseInt(doneMatch[3], 10)
      if (tot) setTotalSkus(tot)
      if (!seenSkus.current.has(sku)) {
        seenSkus.current.add(sku)
        setCompletedSkus(prev => [...prev, sku])
      }
    }
  }, [message])

  const currentId  = resolveStep(message)
  const currentIdx = PIPELINE.findIndex(s => s.id === currentId)
  const pct        = Math.round(((currentIdx + 0.5) / PIPELINE.length) * 100)

  const skuPct = totalSkus > 0
    ? Math.round((completedSkus.length / totalSkus) * 100)
    : 0

  return (
    <div className="w-full space-y-6">
      {/* ── Top: overall progress bar + timer ── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
          <Clock size={11} />
          {fmtElapsed(elapsed)}
        </div>
      </div>

      {/* ── Pipeline steps ── */}
      <div className="grid sm:grid-cols-5 gap-2">
        {PIPELINE.map((step, i) => {
          const done    = i < currentIdx
          const active  = i === currentIdx
          const pending = i > currentIdx

          return (
            <div
              key={step.id}
              className={cn(
                'relative rounded-xl border p-3 transition-all duration-300',
                done    ? 'border-emerald-800/60 bg-emerald-950/20'     : '',
                active  ? 'border-blue-600 bg-blue-950/30 shadow-lg shadow-blue-950/40' : '',
                pending ? 'border-slate-800 bg-slate-900/40'            : '',
              )}
            >
              {/* Step number connector line (desktop) */}
              {i < PIPELINE.length - 1 && (
                <div className={cn(
                  'hidden sm:block absolute top-[22px] -right-[calc(0.5rem+1px)] w-[calc(0.5rem+2px)] h-px',
                  done || active ? 'bg-blue-800' : 'bg-slate-800',
                )} />
              )}

              <div className="flex items-start gap-2">
                <div className="shrink-0 mt-0.5">
                  {done    && <CheckCircle size={14} className="text-emerald-400" />}
                  {active  && <Loader2    size={14} className="text-blue-400 animate-spin" />}
                  {pending && <Circle     size={14} className="text-slate-700" />}
                </div>
                <div className="min-w-0">
                  <p className={cn(
                    'text-xs font-semibold leading-tight',
                    done    ? 'text-emerald-400/70' : '',
                    active  ? 'text-slate-100'      : '',
                    pending ? 'text-slate-600'       : '',
                  )}>
                    {step.label}
                  </p>
                  <p className={cn(
                    'text-[10px] mt-0.5 leading-tight',
                    done    ? 'text-emerald-700'  : '',
                    active  ? 'text-blue-500/80'  : '',
                    pending ? 'text-slate-700'    : '',
                  )}>
                    {done ? 'done' : step.hint}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── SKU extraction progress (only visible during extract step) ── */}
      {(currentId === 'extract' || completedSkus.length > 0) && totalSkus > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">
              SKU extractions
            </span>
            <span className={cn(
              'font-mono font-semibold tabular-nums',
              completedSkus.length === totalSkus ? 'text-emerald-400' : 'text-blue-400',
            )}>
              {completedSkus.length} / {totalSkus}
            </span>
          </div>

          {/* Per-SKU progress bar */}
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500 ease-out',
                completedSkus.length === totalSkus ? 'bg-emerald-500' : 'bg-blue-500',
              )}
              style={{ width: `${skuPct}%` }}
            />
          </div>

          {/* SKU chips */}
          {completedSkus.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {completedSkus.map(sku => (
                <span
                  key={sku}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-900/60 border border-emerald-700 text-emerald-300 text-[10px] font-mono font-semibold"
                >
                  <CheckCircle size={9} />
                  {sku}
                </span>
              ))}
              {/* Pending SKU placeholders */}
              {Array.from({ length: totalSkus - completedSkus.length }).map((_, i) => (
                <span
                  key={`pending-${i}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-700 text-slate-600 text-[10px] font-mono"
                >
                  <Loader2 size={9} className="animate-spin" />
                  waiting
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Current message ── */}
      {message && (
        <p className="text-xs text-slate-500 text-center animate-pulse">
          {message}
        </p>
      )}
    </div>
  )
}
