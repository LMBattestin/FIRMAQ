'use client'
import { useRef, KeyboardEvent, ClipboardEvent } from 'react'
import { cn } from '@/lib/utils'

// ── Spinner ───────────────────────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }[size]
  return (
    <svg className={`animate-spin ${s} text-gray-400`} fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ── Badge ─────────────────────────────────────────────────────
type BadgeVariant = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple'

export function Badge({ variant = 'gray', children }: { variant?: BadgeVariant; children: React.ReactNode }) {
  const v: Record<BadgeVariant, string> = {
    blue:   'bg-blue-50 text-blue-700 ring-blue-100',
    green:  'bg-green-50 text-green-700 ring-green-100',
    amber:  'bg-amber-50 text-amber-700 ring-amber-100',
    red:    'bg-red-50 text-red-700 ring-red-100',
    gray:   'bg-gray-50 text-gray-600 ring-gray-100',
    purple: 'bg-purple-50 text-purple-700 ring-purple-100',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', v[variant])}>
      {children}
    </span>
  )
}

// ── OTPInput ──────────────────────────────────────────────────
interface OTPInputProps {
  value: string
  onChange: (value: string) => void
  length?: number
  disabled?: boolean
  error?: boolean
}

export function OTPInput({ value, onChange, length = 6, disabled, error }: OTPInputProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(length, '').split('').slice(0, length)
  const focus = (i: number) => inputs.current[i]?.focus()

  const handleChange = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = d
    onChange(next.join('').replace(/\s/g, ''))
    if (d && i < length - 1) focus(i + 1)
  }

  const handleKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[i] && i > 0) { focus(i - 1) }
      const next = [...digits]; next[i] = ''; onChange(next.join(''))
    }
    if (e.key === 'ArrowLeft' && i > 0) focus(i - 1)
    if (e.key === 'ArrowRight' && i < length - 1) focus(i + 1)
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    onChange(pasted)
    focus(Math.min(pasted.length, length - 1))
  }

  return (
    <div className="flex gap-2 justify-center" role="group" aria-label="Código de verificação">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { inputs.current[i] = el }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={d}
          disabled={disabled}
          aria-label={`Dígito ${i + 1}`}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKey(i, e)}
          onPaste={handlePaste}
          onFocus={e => e.target.select()}
          className={cn(
            'w-11 h-14 text-center text-xl font-semibold rounded-xl border-2 transition-all duration-100',
            'focus:outline-none focus:ring-0',
            error
              ? 'border-red-300 bg-red-50 text-red-700'
              : d
              ? 'border-gray-900 bg-gray-50 text-gray-900'
              : 'border-gray-200 bg-white text-gray-900 focus:border-gray-900',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        />
      ))}
    </div>
  )
}
