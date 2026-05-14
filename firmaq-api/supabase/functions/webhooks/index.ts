// supabase/functions/webhooks/index.ts
// Rotas de gestão de webhooks
//
//  POST   /webhooks                        → registrar endpoint
//  GET    /webhooks                        → listar endpoints
//  DELETE /webhooks/:id                    → remover endpoint
//  GET    /webhooks/:id/logs               → histórico de disparos
//  POST   /webhooks/:id/retry/:delivery_id → reprocessar entrega com falha
//  POST   /webhooks/dispatch               → uso interno: processar fila de retry

import {
  getServiceClient, requireApiKey, ok, err, corsHeaders, hmacSign,
} from '../_shared/lib.ts'

const VALID_EVENTS = [
  'document.created', 'document.sent', 'document.completed',
  'document.cancelled', 'document.expired', 'document.expiring',
  'signatory.viewed', 'signatory.signed', 'signatory.declined',
  'signatory.identity_failed',
]

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url      = new URL(req.url)
  const segments = url.pathname.replace(/^\/webhooks\/?/, '').split('/')
  const id       = segments[0] || null
  const sub      = segments[1] || null      // logs | retry
  const sub2     = segments[2] || null      // delivery_id (para retry)
  const method   = req.method

  // dispatch é chamado internamente pelo cron — aceita service_role key também
  if (!(id === 'dispatch')) {
    const authErr = requireApiKey(req)
    if (authErr) return authErr
  }

  const db = getServiceClient()

  // ── POST /webhooks ────────────────────────────────────────────
  if (!id && method === 'POST') {
    const body = await req.json() as { label?: string; url: string; events: string[] }

    if (!body.url || !body.events?.length) {
      return err('URL e eventos são obrigatórios', 'VALIDATION_ERROR', 422)
    }

    // Valida URL
    try { new URL(body.url) } catch {
      return err('URL inválida', 'INVALID_URL', 422)
    }

    // Valida eventos
    const invalid = body.events.filter((e) => !VALID_EVENTS.includes(e))
    if (invalid.length) {
      return err(`Eventos inválidos: ${invalid.join(', ')}`, 'INVALID_EVENTS', 422)
    }

    // Gera secret HMAC (exibido apenas uma vez)
    const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')

    const { data, error } = await db
      .from('webhook_endpoints')
      .insert({ label: body.label ?? null, url: body.url, secret, events: body.events })
      .select('id, label, url, events, active, created_at')
      .single()

    if (error) return err('Erro ao salvar webhook', 'DB_ERROR', 500)

    return ok({ ...data, secret }, 201)
  }

  // ── GET /webhooks ─────────────────────────────────────────────
  if (!id && method === 'GET') {
    const { data } = await db
      .from('webhook_endpoints')
      .select('id, label, url, events, active, created_at')
      .order('created_at', { ascending: false })

    return ok({ data })
  }

  // ── DELETE /webhooks/:id ──────────────────────────────────────
  if (id && !sub && method === 'DELETE') {
    const { error } = await db.from('webhook_endpoints').delete().eq('id', id)
    if (error) return err('Erro ao remover webhook', 'DB_ERROR', 500)
    return ok({ deleted: true })
  }

  // ── GET /webhooks/:id/logs ────────────────────────────────────
  if (id && sub === 'logs' && method === 'GET') {
    const status = url.searchParams.get('status')
    const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)

    let query = db
      .from('webhook_deliveries')
      .select('id, event, status, response_status, attempt_count, delivered_at, created_at, next_retry_at')
      .eq('endpoint_id', id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)

    const { data } = await query
    return ok({ data })
  }

  // ── POST /webhooks/:id/retry/:delivery_id ─────────────────────
  if (id && sub === 'retry' && sub2 && method === 'POST') {
    const { data: delivery } = await db
      .from('webhook_deliveries')
      .select('*, webhook_endpoints(url, secret)')
      .eq('id', sub2)
      .eq('endpoint_id', id)
      .single()

    if (!delivery) return err('Entrega não encontrada', 'NOT_FOUND', 404)

    const ep = delivery.webhook_endpoints as { url: string; secret: string }
    const body = JSON.stringify(delivery.payload)
    const signature = await hmacSign(body, ep.secret)

    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Event': delivery.event,
          'X-Retry': 'manual',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })

      await db.from('webhook_deliveries').update({
        status: res.ok ? 'success' : 'failed',
        response_status: res.status,
        delivered_at: res.ok ? new Date().toISOString() : null,
        attempt_count: (delivery.attempt_count ?? 0) + 1,
        next_retry_at: null,
      }).eq('id', sub2)

      return ok({ retried: true, success: res.ok, response_status: res.status })
    } catch (e: unknown) {
      await db.from('webhook_deliveries').update({
        status: 'failed',
        attempt_count: (delivery.attempt_count ?? 0) + 1,
        next_retry_at: new Date(Date.now() + 300_000).toISOString(),
      }).eq('id', sub2)
      return err(`Falha na entrega: ${(e as Error).message}`, 'DELIVERY_FAILED', 502)
    }
  }

  // ── POST /webhooks/dispatch (cron interno) ────────────────────
  // Processa fila de webhooks com falha e agenda retry
  if (id === 'dispatch' && method === 'POST') {
    const now = new Date().toISOString()

    // Busca entregas pendentes ou com falha prontas para retry
    const { data: pending } = await db
      .from('webhook_deliveries')
      .select('*, webhook_endpoints(url, secret, active)')
      .in('status', ['pending', 'failed'])
      .lte('next_retry_at', now)
      .lt('attempt_count', 4)        // máx 4 tentativas
      .limit(50)

    let processed = 0
    let succeeded = 0

    for (const delivery of (pending ?? [])) {
      const ep = delivery.webhook_endpoints as { url: string; secret: string; active: boolean }
      if (!ep?.active) {
        await db.from('webhook_deliveries').update({ status: 'dead' }).eq('id', delivery.id)
        continue
      }

      const body = JSON.stringify(delivery.payload)
      const signature = await hmacSign(body, ep.secret)
      const attempt = (delivery.attempt_count ?? 0) + 1

      // Backoff exponencial: 30s, 5min, 30min
      const nextRetry = attempt >= 4 ? null :
        new Date(Date.now() + [30_000, 300_000, 1_800_000][attempt - 1]).toISOString()

      try {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
          body,
          signal: AbortSignal.timeout(10_000),
        })

        await db.from('webhook_deliveries').update({
          status: res.ok ? 'success' : (attempt >= 4 ? 'dead' : 'failed'),
          response_status: res.status,
          delivered_at: res.ok ? new Date().toISOString() : null,
          attempt_count: attempt,
          next_retry_at: res.ok ? null : nextRetry,
        }).eq('id', delivery.id)

        if (res.ok) succeeded++
      } catch {
        await db.from('webhook_deliveries').update({
          status: attempt >= 4 ? 'dead' : 'failed',
          attempt_count: attempt,
          next_retry_at: nextRetry,
        }).eq('id', delivery.id)
      }

      processed++
    }

    return ok({ processed, succeeded })
  }

  return err('Rota não encontrada', 'NOT_FOUND', 404)
})