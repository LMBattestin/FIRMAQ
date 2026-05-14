// src/lib/esign/client.ts
// SDK cliente TypeScript para React Native
// Wrapper tipado sobre a E-Sign API (Supabase Edge Functions)

// ── Tipos ──────────────────────────────────────────────────────

export type SignatureType = 'simples' | 'avancada'
export type SigningMode   = 'parallel' | 'sequential'
export type DocStatus     = 'draft' | 'pending' | 'completed' | 'cancelled' | 'expired'
export type SigStatus     = 'pending' | 'viewed' | 'signed' | 'declined'
export type FieldType     = 'signature' | 'rubric' | 'initials' | 'date' | 'text'
export type SignatoryRole  = 'signer' | 'witness' | 'approver'

export interface SignatureField {
  id?:           string
  signatory_id?: string | null
  field_type:    FieldType
  page:          number
  x:             number
  y:             number
  width:         number
  height:        number
  required?:     boolean
}

export interface NewSignatory {
  name:          string
  email:         string
  cpf?:          string
  role:          SignatoryRole
  signing_order?: number
  is_app_user?:  boolean
  app_user_id?:  string
  field_ids?:    string[]
}

export interface Signatory extends NewSignatory {
  id:                string
  status:            SigStatus
  signed_at?:        string
  viewed_at?:        string
  declined_at?:      string
  decline_reason?:   string
  identity_verified: boolean
  cpf_last_digits?:  string
  created_at:        string
}

export interface Document {
  id:               string
  title:            string
  description?:     string
  status:           DocStatus
  signature_type:   SignatureType
  signing_mode:     SigningMode
  file_hash:        string
  audit_token:      string
  expires_at?:      string
  completed_at?:    string
  signatories?:     Signatory[]
  created_at:       string
  updated_at:       string
}

export interface CreateDocumentOpts {
  title:             string
  description?:      string
  signature_type?:   SignatureType
  signing_mode?:     SigningMode
  expires_in_days?:  number
  created_by?:       string
}

export interface ESignClientConfig {
  apiKey:  string
  baseUrl: string   // ex: https://{project}.supabase.co/functions/v1
}

// ── Erro tipado ────────────────────────────────────────────────

export class ESignError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ESignError'
  }
}

// ── Cliente principal ──────────────────────────────────────────

export function createESignClient(config: ESignClientConfig) {
  const { apiKey, baseUrl } = config
  const base = baseUrl.replace(/\/$/, '')

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
  }

  async function request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown> | null,
    isForm = false
  ): Promise<T> {
    const url = `${base}${path}`
    const opts: RequestInit = { method, headers: { ...headers } }

    if (body && !isForm) {
      ;(opts.headers as Record<string, string>)['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }

    const res = await fetch(url, opts)
    const data = await res.json()

    if (!res.ok) {
      throw new ESignError(data.message ?? 'Erro desconhecido', data.error ?? 'UNKNOWN', res.status)
    }

    return data as T
  }

  return {
    // ── Documentos ─────────────────────────────────────────────

    documents: {
      /** Cria um documento a partir de um arquivo URI local (React Native) */
      async create(fileUri: string, opts: CreateDocumentOpts): Promise<Document> {
        const form = new FormData()

        // Em React Native, FormData aceita { uri, name, type }
        form.append('file', {
          uri:  fileUri,
          name: 'document.pdf',
          type: 'application/pdf',
        } as unknown as Blob)

        form.append('title', opts.title)
        if (opts.description)    form.append('description', opts.description)
        if (opts.signature_type) form.append('signature_type', opts.signature_type)
        if (opts.signing_mode)   form.append('signing_mode', opts.signing_mode)
        if (opts.expires_in_days) form.append('expires_in_days', String(opts.expires_in_days))
        if (opts.created_by)     form.append('created_by', opts.created_by)

        const res = await fetch(`${base}/documents`, {
          method: 'POST',
          headers,   // NÃO adicionar Content-Type — o browser/RN define o boundary
          body: form,
        })
        const data = await res.json()
        if (!res.ok) throw new ESignError(data.message, data.error, res.status)
        return data as Document
      },

      /** Lista documentos com filtros opcionais */
      list(params?: { status?: DocStatus; limit?: number; offset?: number }) {
        const qs = new URLSearchParams()
        if (params?.status) qs.set('status', params.status)
        if (params?.limit)  qs.set('limit', String(params.limit))
        if (params?.offset) qs.set('offset', String(params.offset))
        return request<{ data: Document[]; total: number }>('GET', `/documents?${qs}`)
      },

      /** Obtém documento completo por ID */
      get(id: string) {
        return request<Document>('GET', `/documents/${id}`)
      },

      /** Define os campos de assinatura no PDF */
      setFields(documentId: string, fields: SignatureField[]) {
        return request<{ count: number; fields: SignatureField[] }>(
          'POST', `/documents/${documentId}/fields`, { fields }
        )
      },

      /** Adiciona signatários ao documento */
      addSignatories(documentId: string, signatories: NewSignatory[]) {
        return request<{ signatories: Signatory[] }>(
          'POST', `/documents/${documentId}/signatories`, { signatories }
        )
      },

      /** Envia o documento para assinatura */
      send(documentId: string, message?: string) {
        return request<{ document_id: string; status: string; notified: number }>(
          'POST', `/documents/${documentId}/send`, message ? { message } : {}
        )
      },

      /** Cancela o documento */
      cancel(documentId: string, reason?: string) {
        return request<{ cancelled: boolean }>(
          'POST', `/documents/${documentId}/cancel`, { reason }
        )
      },

      /** Reenvia lembrete para signatários pendentes */
      remind(documentId: string, signatoryIds?: string[]) {
        return request<{ reminded: number }>(
          'POST', `/documents/${documentId}/remind`,
          signatoryIds?.length ? { signatory_ids: signatoryIds } : {}
        )
      },

      /** Obtém URL de download do PDF (original ou assinado) */
      getDownloadUrl(documentId: string, version: 'original' | 'signed' = 'signed') {
        return request<{ url: string; expires_at: string; version: string }>(
          'GET', `/documents/${documentId}/download?version=${version}`
        )
      },

      /** Obtém a trilha de auditoria completa */
      getAudit(documentId: string) {
        return request<{ document: Document; logs: unknown[] }>(
          'GET', `/documents/${documentId}/audit`
        )
      },
    },

    // ── Verificação pública ───────────────────────────────────

    verify: {
      /** Verifica autenticidade por audit_token (QR code) */
      byToken(auditToken: string) {
        return request<{ valid: boolean; document: unknown; signatories: unknown[] }>(
          'GET', `/verify/${auditToken}`
        )
      },
    },

    // ── Webhooks ──────────────────────────────────────────────

    webhooks: {
      /** Registra endpoint de webhook */
      create(url: string, events: string[], label?: string) {
        return request<{ id: string; secret: string; url: string; events: string[] }>(
          'POST', '/webhooks', { url, events, label }
        )
      },

      /** Lista webhooks registrados */
      list() {
        return request<{ data: unknown[] }>('GET', '/webhooks')
      },

      /** Histórico de disparos */
      getLogs(webhookId: string, status?: string) {
        const qs = status ? `?status=${status}` : ''
        return request<{ data: unknown[] }>('GET', `/webhooks/${webhookId}/logs${qs}`)
      },

      /** Reprocessa entrega manualmente */
      retry(webhookId: string, deliveryId: string) {
        return request<{ retried: boolean; success: boolean }>(
          'POST', `/webhooks/${webhookId}/retry/${deliveryId}`
        )
      },
    },

    // ── Fluxo de assinatura no app (signatário com app) ───────
    // Usado quando is_app_user = true e o signatário assina direto no app
    // sem passar pelo painel web

    sign: {
      /**
       * Assina um documento direto pelo app (signatário com app instalado).
       * Requer que o signatário já esteja autenticado no app (session do Supabase Auth).
       * Internamente: pede OTP → verifica → assina.
       *
       * @param token   - token do signatário (recebido via deep link ou push)
       * @param cpf     - CPF do signatário (obrigatório para assinatura avançada)
       */
      async fromApp(token: string, opts: { cpf?: string; geolocation?: { lat: number; lng: number } }) {
        // 1. Solicita OTP
        const otpRes = await fetch(`${base}/s/${token}/send-otp`, {
          method: 'POST',
          headers,
        })
        if (!otpRes.ok) {
          const d = await otpRes.json()
          throw new ESignError(d.message, d.error, otpRes.status)
        }
        const { message } = await otpRes.json() as { message: string }

        // Retorna o prompt para o app coletar o OTP do usuário
        return {
          otpSent: true,
          otpMessage: message,

          /** Chamar após o usuário digitar o código OTP no app */
          async confirm(otp: string): Promise<{ signed: boolean; all_signed: boolean; message: string }> {
            // 2. Verificar identidade
            const verRes = await fetch(`${base}/s/${token}/verify`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ otp, cpf: opts.cpf }),
            })
            const verData = await verRes.json()
            if (!verRes.ok) throw new ESignError(verData.message, verData.error, verRes.status)

            const { session_token } = verData as { session_token: string }

            // 3. Assinar
            const signRes = await fetch(`${base}/s/${token}/sign`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_token,
                accepted: true,
                geolocation: opts.geolocation ?? null,
              }),
            })
            const signData = await signRes.json()
            if (!signRes.ok) throw new ESignError(signData.message, signData.error, signRes.status)

            return signData as { signed: boolean; all_signed: boolean; message: string }
          },
        }
      },
    },
  }
}

// ── Uso exemplo (React Native) ─────────────────────────────────
//
// import { createESignClient } from './lib/esign/client'
//
// const esign = createESignClient({
//   apiKey:  process.env.ESIGN_API_KEY!,
//   baseUrl: process.env.SUPABASE_FUNCTIONS_URL!,
// })
//
// // 1. Criar documento
// const doc = await esign.documents.create(localPdfUri, {
//   title:           'Contrato de Prestação de Serviços',
//   signature_type:  'avancada',
//   signing_mode:    'parallel',
//   expires_in_days: 7,
// })
//
// // 2. Definir campos (baseado no template PDF existente)
// await esign.documents.setFields(doc.id, [
//   { field_type: 'signature', page: 4, x: 72,  y: 680, width: 180, height: 60 },
//   { field_type: 'signature', page: 4, x: 320, y: 680, width: 180, height: 60 },
//   { field_type: 'signature', page: 4, x: 72,  y: 600, width: 180, height: 60 },  // testemunha 1
//   { field_type: 'signature', page: 4, x: 320, y: 600, width: 180, height: 60 },  // testemunha 2
// ])
//
// // 3. Adicionar signatários
// await esign.documents.addSignatories(doc.id, [
//   { name: 'João Silva',    email: 'joao@email.com',  cpf: '12345678901', role: 'signer',  is_app_user: true,  app_user_id: currentUserId },
//   { name: 'Carlos Lima',  email: 'carlos@email.com', cpf: '98765432100', role: 'signer',  is_app_user: false },
//   { name: 'Ana Costa',    email: 'ana@email.com',    cpf: '11122233344', role: 'witness', is_app_user: true,  app_user_id: witnessUserId },
//   { name: 'Pedro Souza',  email: 'pedro@email.com',  cpf: '55566677788', role: 'witness', is_app_user: false },
// ])
//
// // 4. Enviar
// await esign.documents.send(doc.id, 'Por favor, assine o contrato em anexo.')
//
// // 5. Assinar no app (signatário com app)
// const flow = await esign.sign.fromApp(signatoryToken, { cpf: '12345678901' })
// // → Exibir campo de OTP na UI
// const result = await flow.confirm(otpDigitadoPeloUsuario)
// if (result.all_signed) {
//   console.log('Todos assinaram! PDF gerado e enviado.')
// }