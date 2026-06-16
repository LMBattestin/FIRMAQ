// supabase/functions/_shared/lib.ts
// Utilitários compartilhados entre todas as Edge Functions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Supabase client (service_role) ──────────────────────────────
export function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )
}

// ── Respostas padronizadas ──────────────────────────────────────
export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function err(message: string, code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Autenticação via API Key ────────────────────────────────────
// A chave fica em ESIGN_API_KEY no Supabase Vault (secrets)
export function requireApiKey(req: Request): Response | null {
  const auth = req.headers.get('Authorization') ?? ''
  const key = auth.replace('Bearer ', '').trim()
  const valid = Deno.env.get('ESIGN_API_KEY')
  if (!key || key !== valid) {
    return err('API key inválida ou ausente', 'UNAUTHORIZED', 401)
  }
  return null
}

// ── SHA-256 hex ─────────────────────────────────────────────────
export async function sha256(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── HMAC-SHA256 para webhooks ───────────────────────────────────
export async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return 'sha256=' + Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Geração e validação de OTP ──────────────────────────────────
export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function hashOtp(otp: string): Promise<string> {
  return sha256(otp)
}

// ── Validação de CPF (algoritmo oficial) ───────────────────────
export function validateCpf(cpf: string): boolean {
  const c = cpf.replace(/\D/g, '')
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  const calc = (mod: number) => {
    let sum = 0
    for (let i = 0; i < mod - 1; i++) sum += parseInt(c[i]) * (mod - i)
    const r = (sum * 10) % 11
    return r >= 10 ? 0 : r
  }
  return calc(10) === parseInt(c[9]) && calc(11) === parseInt(c[10])
}

export function cpfLastDigits(cpf: string): string {
  const c = cpf.replace(/\D/g, '')
  return c.slice(-2)
}

// ── Dispatcher de webhooks ──────────────────────────────────────
export async function dispatchWebhook(
  supabase: ReturnType<typeof getServiceClient>,
  event: string,
  documentId: string,
  payload: Record<string, unknown>
) {
  // Busca endpoints que subscrevem este evento
  const { data: endpoints } = await supabase
    .from('webhook_endpoints')
    .select('id, url, secret')
    .eq('active', true)
    .contains('events', [event])

  if (!endpoints?.length) return

  const body = JSON.stringify({
    event,
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    document_id: documentId,
    ...payload,
  })

  for (const ep of endpoints) {
    const signature = await hmacSign(body, ep.secret)
    const deliveryId = crypto.randomUUID()

    // Registra a tentativa
    await supabase.from('webhook_deliveries').insert({
      id: deliveryId,
      endpoint_id: ep.id,
      document_id: documentId,
      event,
      payload: JSON.parse(body),
      status: 'pending',
      attempt_count: 1,
    })

    // Dispara (fire-and-forget com retry via cron se falhar)
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Event': event,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })

      await supabase
        .from('webhook_deliveries')
        .update({
          status: res.ok ? 'success' : 'failed',
          response_status: res.status,
          delivered_at: res.ok ? new Date().toISOString() : null,
          next_retry_at: res.ok ? null : new Date(Date.now() + 30_000).toISOString(),
        })
        .eq('id', deliveryId)
    } catch {
      await supabase
        .from('webhook_deliveries')
        .update({
          status: 'failed',
          next_retry_at: new Date(Date.now() + 30_000).toISOString(),
        })
        .eq('id', deliveryId)
    }
  }
}

// ── Audit log ───────────────────────────────────────────────────
export async function auditLog(
  supabase: ReturnType<typeof getServiceClient>,
  opts: {
    document_id: string
    signatory_id?: string
    event: string
    ip?: string
    user_agent?: string
    payload?: Record<string, unknown>
  }
) {
  await supabase.from('audit_logs').insert({
    document_id: opts.document_id,
    signatory_id: opts.signatory_id ?? null,
    event: opts.event,
    ip_address: opts.ip ?? null,
    user_agent: opts.user_agent ?? null,
    payload: opts.payload ?? null,
  })
}

// ── E-mail via Resend ───────────────────────────────────────────
export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('EMAIL_FROM') ?? 'assinatura@firmaq.com.br',
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('Resend error:', body)
  }
}

// Templates de e-mail
export const emailTemplates = {
  invite: (opts: {
    signatoryName: string
    documentTitle: string
    senderName: string
    signUrl: string
    expiresAt: string
    message?: string
  }) => ({
    subject: `Você foi convidado para assinar: ${opts.documentTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <h2 style="font-size:18px;font-weight:500">Olá, ${opts.signatoryName}</h2>
        <p style="color:#555">${opts.senderName} convidou você para assinar o documento:</p>
        <div style="border:1px solid #eee;border-radius:8px;padding:16px;margin:16px 0">
          <strong>${opts.documentTitle}</strong>
        </div>
        ${opts.message ? `<p style="color:#555;font-style:italic">"${opts.message}"</p>` : ''}
        <a href="${opts.signUrl}"
           style="display:inline-block;padding:12px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-weight:500">
          Assinar documento
        </a>
        <p style="font-size:12px;color:#999;margin-top:16px">
          Link válido até ${opts.expiresAt}.<br>
          Validade jurídica garantida pela Lei 14.063/2020.
        </p>
      </div>
    `,
  }),

  otp: (opts: { signatoryName: string; code: string }) => ({
    subject: `Seu código de verificação: ${opts.code}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <h2 style="font-size:18px;font-weight:500">Código de verificação</h2>
        <p style="color:#555">Olá ${opts.signatoryName}, use o código abaixo:</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:24px;text-align:center;margin:16px 0">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px">${opts.code}</span>
        </div>
        <p style="font-size:12px;color:#999">Válido por 30 minutos. Não compartilhe este código.</p>
      </div>
    `,
  }),

  signed: (opts: { signatoryName: string; documentTitle: string; signedAt: string }) => ({
    subject: `Comprovante: você assinou "${opts.documentTitle}"`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <h2 style="font-size:18px;font-weight:500">Assinatura registrada</h2>
        <p style="color:#555">Olá ${opts.signatoryName}, sua assinatura foi registrada com sucesso.</p>
        <div style="border:1px solid #eee;border-radius:8px;padding:16px;margin:16px 0;font-size:13px">
          <div style="margin-bottom:6px"><strong>Documento:</strong> ${opts.documentTitle}</div>
          <div><strong>Data/hora:</strong> ${opts.signedAt}</div>
        </div>
        <p style="font-size:12px;color:#999">
          Você receberá o documento final assim que todos os signatários assinarem.
        </p>
      </div>
    `,
  }),

  completed: (opts: { name: string; documentTitle: string; downloadUrl: string }) => ({
    subject: `Documento assinado por todos: ${opts.documentTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <h2 style="font-size:18px;font-weight:500">Documento concluído</h2>
        <p style="color:#555">Olá ${opts.name}, todos os signatários assinaram o documento.</p>
        <a href="${opts.downloadUrl}"
           style="display:inline-block;padding:12px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-weight:500;margin:16px 0">
          Baixar documento assinado
        </a>
        <p style="font-size:12px;color:#999">Link válido por 24 horas.</p>
      </div>
    `,
  }),
}