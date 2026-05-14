'use client'
import { useState, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import type { PanelData } from '@/lib/types'

interface ReadDocumentProps {
  data:         PanelData
  onConfirm:    () => void
  onDecline:    () => void
  onBack:       () => void
}

export function ReadDocument({ data, onConfirm, onDecline, onBack }: ReadDocumentProps) {
  const [scrolledToEnd, setScrolledToEnd] = useState(false)
  const [accepted, setAccepted]           = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Em mobile, o iframe rola internamente; monitoramos via mensagem do scroll
  // Como o PDF vem de domínio externo (Supabase), usamos um botão manual
  const [manualConfirm, setManualConfirm] = useState(false)

  const canSign = (scrolledToEnd || manualConfirm) && accepted

  return (
    <div className="animate-fade-in flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Leia o documento</h2>
        <p className="text-sm text-gray-500">Role até o fim antes de assinar</p>
      </div>

      {/* PDF Viewer */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
          <span className="text-xs font-medium text-gray-600 truncate max-w-[70%]">{data.document_title}</span>
          <a
            href={data.file_preview_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors font-medium"
            aria-label="Abrir documento em nova aba"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Abrir
          </a>
        </div>

        {/* iFrame PDF */}
        <div className="relative" style={{ height: '52vh', minHeight: 320 }}>
          <iframe
            ref={iframeRef}
            src={`${data.file_preview_url}#toolbar=0&navpanes=0&scrollbar=1`}
            title={data.document_title}
            className="w-full h-full border-0"
            aria-label={`Documento: ${data.document_title}`}
          />
        </div>

        {/* Botão "Cheguei ao final" para mobile */}
        {!manualConfirm && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
            <button
              onClick={() => { setManualConfirm(true); setScrolledToEnd(true) }}
              className="w-full text-xs text-gray-500 flex items-center justify-center gap-2 py-1 hover:text-gray-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Confirmei que li o documento completo
            </button>
          </div>
        )}
        {manualConfirm && (
          <div className="px-4 py-3 border-t border-green-100 bg-green-50">
            <p className="text-xs text-green-700 text-center font-medium flex items-center justify-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Documento confirmado como lido
            </p>
          </div>
        )}
      </div>

      {/* Aceite */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
        <label className="flex items-start gap-3 cursor-pointer">
          <div className="relative flex-shrink-0 mt-0.5">
            <input
              type="checkbox"
              className="sr-only"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
            />
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${accepted ? 'bg-gray-900 border-gray-900' : 'border-gray-300 bg-white'}`}>
              {accepted && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
          <span className="text-sm text-gray-600 leading-relaxed">
            Li o documento na íntegra e concordo com todos os seus termos e condições.
          </span>
        </label>
      </div>

      {/* Ações */}
      <div className="space-y-3 safe-bottom">
        <Button
          fullWidth
          onClick={onConfirm}
          disabled={!canSign}
          className={!canSign ? 'opacity-50' : ''}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          Prosseguir para assinar
        </Button>
        <Button fullWidth variant="danger" onClick={onDecline}>
          Recusar assinatura
        </Button>
        <Button fullWidth variant="ghost" onClick={onBack}>Voltar</Button>
      </div>

      {!canSign && (
        <p className="text-center text-xs text-gray-400">
          {!scrolledToEnd && !manualConfirm
            ? 'Confirme que leu o documento e marque o aceite para continuar'
            : 'Marque a caixa de aceite para continuar'}
        </p>
      )}
    </div>
  )
}
