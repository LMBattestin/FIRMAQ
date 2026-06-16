'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge }  from '@/components/ui/index'
import { panel }  from '@/lib/api'
import { formatDateTime, roleLabel } from '@/lib/utils'
import type { PanelData } from '@/lib/types'

interface ConfirmSignProps {
  token:        string
  data:         PanelData
  sessionToken: string
  onSigned:     (allSigned: boolean, signedAt: string) => void
  onBack:       () => void
}

export function ConfirmSign({ token, data, sessionToken, onSigned, onBack }: ConfirmSignProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleSign() {
    setLoading(true); setError('')

    // Tenta capturar geolocalização (opcional, com permissão do usuário)
    let geo: { lat: number; lng: number } | undefined
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 })
      )
      geo = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    } catch { /* geolocalização negada — ok, não é obrigatório */ }

    try {
      const result = await panel.sign(token, sessionToken, geo)
      onSigned(result.all_signed, result.signed_at)
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string }
      if (err.code === 'INVALID_SESSION')  setError('Sua sessão expirou. Por favor, volte e verifique sua identidade novamente.')
      else if (err.code === 'ALREADY_SIGNED') setError('Você já assinou este documento.')
      else setError('Não foi possível registrar a assinatura. Tente novamente.')
    } finally { setLoading(false) }
  }

  const now = new Date().toISOString()

  return (
    <div className="animate-fade-in space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Confirmar assinatura</h2>
        <p className="text-sm text-gray-500">Revise os dados abaixo antes de assinar</p>
      </div>

      {/* Resumo */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-3">
        <div className="flex justify-between items-start py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-500">Documento</span>
          <span className="text-sm font-medium text-gray-900 text-right max-w-[55%] leading-snug">{data.document_title}</span>
        </div>
        <div className="flex justify-between items-center py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-500">Signatário</span>
          <span className="text-sm font-medium text-gray-900">{data.signatory_name}</span>
        </div>
        <div className="flex justify-between items-center py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-500">Papel</span>
          <Badge variant="blue">{roleLabel(data.signatory_role)}</Badge>
        </div>
        <div className="flex justify-between items-center py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-500">Data / hora</span>
          <span className="text-xs text-gray-600 font-mono">{formatDateTime(now)}</span>
        </div>
        <div className="flex justify-between items-center py-2.5">
          <span className="text-sm text-gray-500">Verificação</span>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-green-700 font-medium">Identidade confirmada</span>
          </div>
        </div>
      </div>

      {/* Aviso legal */}
      <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
        <div className="flex gap-2.5">
          <span className="text-amber-500 flex-shrink-0 mt-0.5">⚠</span>
          <p className="text-xs text-amber-800 leading-relaxed">
            <strong>Atenção:</strong> Ao clicar em "Assinar agora", você estará formalizando seu acordo com todos os termos do documento. Esta ação não pode ser desfeita.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 rounded-xl p-4 border border-red-100">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Ações */}
      <div className="space-y-3 safe-bottom">
        <Button fullWidth onClick={handleSign} loading={loading}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Assinar agora
        </Button>
        <Button fullWidth variant="secondary" onClick={onBack} disabled={loading}>
          Reler documento
        </Button>
      </div>
    </div>
  )
}
