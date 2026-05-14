import { cn } from '@/lib/utils'
import type { Step } from '@/lib/types'

const STEPS: { id: Step; label: string }[] = [
  { id: 'welcome', label: 'Início' },
  { id: 'verify',  label: 'Verificação' },
  { id: 'read',    label: 'Leitura' },
  { id: 'confirm', label: 'Confirmar' },
]

const ORDER: Step[] = ['welcome', 'verify', 'read', 'confirm', 'success']

export function StepIndicator({ current }: { current: Step }) {
  if (current === 'success' || current === 'declined') return null
  const currentIdx = ORDER.indexOf(current)

  return (
    <div className="mb-6">
      <div className="flex items-center gap-0">
        {STEPS.map((step, i) => {
          const idx = ORDER.indexOf(step.id)
          const done    = idx < currentIdx
          const active  = idx === currentIdx
          const isLast  = i === STEPS.length - 1

          return (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-200',
                  done   ? 'bg-gray-900 text-white' :
                  active ? 'bg-gray-900 text-white ring-4 ring-gray-100' :
                           'bg-gray-100 text-gray-400'
                )}>
                  {done ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : i + 1}
                </div>
                <span className={cn(
                  'text-[10px] font-medium whitespace-nowrap',
                  active ? 'text-gray-900' : done ? 'text-gray-500' : 'text-gray-300'
                )}>
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div className={cn(
                  'flex-1 h-0.5 mx-1 mb-4 transition-all duration-300',
                  idx < currentIdx ? 'bg-gray-900' : 'bg-gray-100'
                )} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
