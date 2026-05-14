'use client'
import { Button }   from '@/components/ui/Button'
import { Badge }    from '@/components/ui/index'
import { roleLabel, sigTypeLabel, timeUntil, formatDate } from '@/lib/utils'
import type { PanelData } from '@/lib/types'

interface WelcomeProps {
  data:    PanelData
  onStart: () => void
}

export function Welcome({ data, onStart }: WelcomeProps) {
  const remaining = timeUntil(data.expires_at)
  const isUrgent  = remaining.includes('hora') || remaining.includes('menos')

  return (
    <div className="animate-fade-in space-y-5">
      {/* Documento */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-400 mb-0.5">Documento para assinar</p>
            <h1 className="text-base font-semibold text-gray-900 leading-snug line-clamp-2">
              {data.document_title}
            </h1>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center py-2.5 border-t border-gray-50">
            <span className="text-gray-500">Seu papel</span>
            <Badge variant="blue">{roleLabel(data.signatory_role)}</Badge>
          </div>
          <div className="flex justify-between items-center py-2.5 border-t border-gray-50">
            <span className="text-gray-500">Verificação</span>
            <span className="text-gray-700 font-medium text-xs text-right max-w-[55%]">
              {sigTypeLabel(data.signature_type)}
            </span>
          </div>
          <div className="flex justify-between items-center py-2.5 border-t border-gray-50">
            <span className="text-gray-500">Validade do link</span>
            <Badge variant={isUrgent ? 'amber' : 'gray'}>
              {isUrgent ? '⚠ ' : ''}{remaining}
            </Badge>
          </div>
          <div className="flex justify-between items-center py-2.5 border-t border-gray-50">
            <span className="text-gray-500">Expira em</span>
            <span className="text-gray-600 text-xs">{formatDate(data.expires_at)}</span>
          </div>
        </div>
      </div>

      {/* Info legal */}
      <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
        <div className="flex gap-3">
          <div className="text-blue-500 mt-0.5 flex-shrink-0">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-800 mb-1">Assinatura com validade jurídica</p>
            <p className="text-xs text-blue-700 leading-relaxed">
              Ao assinar, você confirma ter lido e concordado com o documento. Esta assinatura eletrônica é legalmente válida pela <strong>Lei nº 14.063/2020</strong> e tem o mesmo valor de uma assinatura de próprio punho para este tipo de contrato.
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="space-y-3 safe-bottom">
        <Button fullWidth onClick={onStart}>
          Começar a assinar
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Button>
        <p className="text-xs text-center text-gray-400">
          Você também pode recusar a assinatura durante o processo
        </p>
      </div>
    </div>
  )
}
