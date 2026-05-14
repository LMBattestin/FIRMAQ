'use client'
import { useState }    from 'react'
import { Button }      from '@/components/ui/Button'
import { panel }       from '@/lib/api'
import { formatDateTime } from '@/lib/utils'

// ── Success ───────────────────────────────────────────────────
interface SuccessProps {
  documentTitle: string
  signedAt:      string
  allSigned:     boolean
}

export function Success({ documentTitle, signedAt, allSigned }: SuccessProps) {
  return (
    <div className="animate-fade-in text-center py-8 px-2 space-y-6">
      <div className="relative inline-flex items-center justify-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Documento assinado!</h2>
        <p className="text-sm text-gray-500 leading-relaxed">
          {allSigned
            ? 'Todos os signatários já assinaram. O documento final será enviado para todos por e-mail em instantes.'
            : 'Sua assinatura foi registrada com sucesso. Você receberá o documento final por e-mail assim que todos os signatários assinarem.'}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm text-left space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Comprovante de assinatura</p>
        <div className="space-y-2.5">
          <div className="flex justify-between items-start gap-4">
            <span className="text-sm text-gray-500 flex-shrink-0">Documento</span>
            <span className="text-sm font-medium text-gray-900 text-right leading-snug">{documentTitle}</span>
          </div>
          <div className="flex justify-between items-center gap-4 pt-2 border-t border-gray-50">
            <span className="text-sm text-gray-500">Assinado em</span>
            <span className="text-xs font-mono text-gray-600">{formatDateTime(signedAt)}</span>
          </div>
          <div className="flex justify-between items-center gap-4 pt-2 border-t border-gray-50">
            <span className="text-sm text-gray-500">Validade</span>
            <span className="text-xs text-green-700 font-medium">Lei 14.063/2020</span>
          </div>
        </div>
      </div>

      {allSigned && (
        <div className="bg-green-50 rounded-xl p-4 border border-green-100">
          <p className="text-sm text-green-800">
            🎉 <strong>Todos assinaram!</strong> O documento completo foi enviado para o e-mail de todos os signatários.
          </p>
        </div>
      )}

      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-xs text-gray-500 leading-relaxed">
          Guarde o e-mail de comprovante que enviamos para você. Ele serve como prova da sua assinatura em caso de necessidade.
        </p>
      </div>
    </div>
  )
}

// ── Declined ──────────────────────────────────────────────────
interface DeclinedProps {
  token:        string
  sessionToken: string
  onBack:       () => void
  onConfirmed:  () => void
}

export function Declined({ token, sessionToken, onBack, onConfirmed }: DeclinedProps) {
  const [reason, setReason]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [done, setDone]       = useState(false)

  const MIN = 10
  const remaining = Math.max(0, MIN - reason.trim().length)

  async function handleDecline() {
    if (reason.trim().length < MIN) return
    setLoading(true); setError('')
    try {
      await panel.decline(token, sessionToken, reason.trim())
      setDone(true)
      setTimeout(onConfirmed, 2000)
    } catch {
      setError('Não foi possível registrar a recusa. Tente novamente.')
    } finally { setLoading(false) }
  }

  if (done) {
    return (
      <div className="animate-fade-in text-center py-12 space-y-4">
        <div className="text-5xl">✓</div>
        <h2 className="text-xl font-semibold text-gray-900">Recusa registrada</h2>
        <p className="text-sm text-gray-500">O remetente será notificado do motivo informado.</p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Recusar assinatura</h2>
        <p className="text-sm text-gray-500">Informe o motivo para que o remetente seja notificado.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-2">
          Motivo da recusa
        </label>
        <textarea
          id="reason"
          rows={4}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Ex: Não concordo com a cláusula X do contrato..."
          className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none transition-all"
        />
        {remaining > 0 && (
          <p className="mt-1.5 text-xs text-gray-400">
            Mínimo {MIN} caracteres ({remaining} restantes)
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

      <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
        <p className="text-xs text-amber-800 leading-relaxed">
          Esta ação não pode ser desfeita. O remetente receberá o motivo informado e poderá enviar um novo documento para revisão.
        </p>
      </div>

      <div className="space-y-3">
        <Button
          fullWidth
          variant="danger"
          onClick={handleDecline}
          loading={loading}
          disabled={reason.trim().length < MIN}
        >
          Confirmar recusa
        </Button>
        <Button fullWidth variant="ghost" onClick={onBack} disabled={loading}>
          Cancelar — voltar
        </Button>
      </div>
    </div>
  )
}