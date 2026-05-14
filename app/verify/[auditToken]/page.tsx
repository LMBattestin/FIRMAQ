import type { Metadata }     from 'next'
import { Layout }             from '@/components/Layout'
import { ErrorScreen }        from '@/components/ErrorScreen'
import { Badge }              from '@/components/ui/index'
import { verify, ApiError }   from '@/lib/api'
import { formatDateTime, roleLabel } from '@/lib/utils'

interface Props { params: { auditToken: string } }

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Verificação de documento' }
}

const STATUS_LABEL: Record<string, { label: string; badge: 'green' | 'amber' | 'gray' | 'red' | 'blue' }> = {
  completed: { label: 'Assinado por todos', badge: 'green' },
  pending:   { label: 'Em andamento',       badge: 'amber' },
  cancelled: { label: 'Cancelado',          badge: 'red'   },
  expired:   { label: 'Expirado',           badge: 'gray'  },
}

const SIG_STATUS: Record<string, { label: string; icon: string; color: string }> = {
  signed:   { label: 'Assinou',   icon: '✓', color: 'text-green-600' },
  pending:  { label: 'Pendente',  icon: '○', color: 'text-amber-500' },
  viewed:   { label: 'Visualizou', icon: '◎', color: 'text-blue-500' },
  declined: { label: 'Recusou',   icon: '✗', color: 'text-red-500'  },
}

export default async function VerifyPage({ params }: Props) {
  const { auditToken } = params
  let result
  let notFound = false

  try {
    result = await verify.byToken(auditToken)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound = true
  }

  if (notFound || !result) {
    return (
      <Layout>
        <ErrorScreen code="not_found" title="Documento não encontrado" message="O token de verificação é inválido ou o documento foi removido." />
      </Layout>
    )
  }

  const { document: doc, signatories, timeline, verification_timestamp } = result
  const status = STATUS_LABEL[doc.status] ?? { label: doc.status, badge: 'gray' as const }

  return (
    <Layout maxWidth="md">
      <div className="space-y-5 animate-fade-in">

        {/* Header resultado */}
        <div className={`rounded-2xl p-5 border ${result.valid ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${result.valid ? 'bg-green-100' : 'bg-red-100'}`}>
              <span className="text-2xl">{result.valid ? '✅' : '❌'}</span>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-0.5">
                {result.valid ? 'Documento autêntico' : 'Documento inválido'}
              </p>
              <h1 className="text-base font-semibold text-gray-900 leading-snug">{doc.title}</h1>
            </div>
          </div>
        </div>

        {/* Detalhes do documento */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Dados do documento</p>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-50">
              <span className="text-sm text-gray-500">Status</span>
              <Badge variant={status.badge}>{status.label}</Badge>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-50">
              <span className="text-sm text-gray-500">Tipo de assinatura</span>
              <span className="text-sm font-medium text-gray-700 capitalize">{doc.signature_type}</span>
            </div>
            {doc.completed_at && (
              <div className="flex justify-between items-center py-2 border-b border-gray-50">
                <span className="text-sm text-gray-500">Concluído em</span>
                <span className="text-xs text-gray-600">{formatDateTime(doc.completed_at)}</span>
              </div>
            )}
            <div className="flex justify-between items-start py-2 border-b border-gray-50">
              <span className="text-sm text-gray-500 flex-shrink-0">Hash SHA-256</span>
              <span className="text-xs font-mono text-gray-500 text-right max-w-[55%] break-all">{doc.file_hash}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-gray-500">Base legal</span>
              <span className="text-xs text-gray-600">{doc.legal_basis}</span>
            </div>
          </div>
        </div>

        {/* Signatários */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Signatários ({signatories.length})
          </p>
          <div className="space-y-4">
            {signatories.map((sig, i) => {
              const s = SIG_STATUS[sig.status] ?? { label: sig.status, icon: '?', color: 'text-gray-400' }
              return (
                <div key={i} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
                  <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className={`text-base font-bold ${s.color}`}>{s.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{sig.name}</span>
                      <Badge variant={sig.role === 'witness' ? 'gray' : 'blue'}>{roleLabel(sig.role)}</Badge>
                    </div>
                    {sig.cpf_suffix && <p className="text-xs text-gray-500 mt-0.5">CPF: {sig.cpf_suffix}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                      {sig.signed_at && (
                        <span className="text-xs text-gray-400">· {formatDateTime(sig.signed_at)}</span>
                      )}
                    </div>
                    {sig.identity_verified && (
                      <p className="text-xs text-gray-400 mt-0.5">✓ Identidade verificada</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Timeline */}
        {timeline.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Linha do tempo</p>
            <div className="relative pl-5">
              <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-gray-100" aria-hidden />
              <div className="space-y-4">
                {timeline.map((ev, i) => (
                  <div key={i} className="relative flex items-start gap-3">
                    <div className="absolute -left-5 top-1 w-3 h-3 rounded-full bg-gray-200 border-2 border-white" aria-hidden />
                    <div>
                      <p className="text-xs font-medium text-gray-700">{ev.event.replace('.', ' → ')}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(ev.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Rodapé de verificação */}
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Verificação realizada em {formatDateTime(verification_timestamp)}. Este registro é imutável e pode ser apresentado como prova em caso de litígio.
          </p>
        </div>

      </div>
    </Layout>
  )
}
