// supabase/functions/cron-expire/index.ts
// Agendada via pg_cron a cada 15 minutos
//
// Responsabilidades:
//  1. Expirar documentos com expires_at no passado
//  2. Disparar webhook document.expired para cada um
//  3. Disparar webhook document.expiring para documentos que expiram em < 48h
//  4. Reprocessar fila de webhooks com retry pendente (chama /webhooks/dispatch)

import {
  getServiceClient, requireApiKey, ok, corsHeaders, dispatchWebhook, auditLog,
} from '../_shared/lib.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Aceita chamada via pg_cron (service_role) ou API key
  const authHeader = req.headers.get('Authorization') ?? ''
  const isServiceRole = authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '__none__')
  if (!isServiceRole) {
    const authErr = requireApiKey(req)
    if (authErr) return authErr
  }

  const db  = getServiceClient()
  const now = new Date()

  // ── 1. Expirar documentos vencidos ───────────────────────────
  const { data: expired } = await db
    .from('documents')
    .select('id, title')
    .eq('status', 'pending')
    .lt('expires_at', now.toISOString())

  let expiredCount = 0
  for (const doc of (expired ?? [])) {
    await db.from('documents')
      .update({ status: 'expired' })
      .eq('id', doc.id)

    await auditLog(db, { document_id: doc.id, event: 'document.expired' })
    await dispatchWebhook(db, 'document.expired', doc.id, { document_title: doc.title })
    expiredCount++
  }

  // ── 2. Alertar documentos expirando em < 48h ─────────────────
  // Apenas aqueles que ainda não receberam o alerta (sem registro no audit_log)
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString()

  const { data: expiring } = await db
    .from('documents')
    .select('id, title, expires_at, signatories(name, email, status)')
    .eq('status', 'pending')
    .lte('expires_at', in48h)
    .gt('expires_at', now.toISOString())

  let expiringCount = 0
  for (const doc of (expiring ?? [])) {
    // Verifica se já disparou o alerta de expiring
    const { count } = await db
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', doc.id)
      .eq('event', 'document.expiring')

    if ((count ?? 0) > 0) continue  // já alertou

    const pendingSigs = (doc.signatories as { name: string; email: string; status: string }[])
      .filter((s) => s.status === 'pending')

    await auditLog(db, {
      document_id: doc.id,
      event: 'document.expiring',
      payload: { expires_at: doc.expires_at, pending_count: pendingSigs.length },
    })

    await dispatchWebhook(db, 'document.expiring', doc.id, {
      document_title: doc.title,
      expires_at: doc.expires_at,
      pending_signatories: pendingSigs.map((s) => ({ name: s.name, email: s.email })),
    })

    expiringCount++
  }

  // ── 3. Processar fila de retry de webhooks ────────────────────
  const internalUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhooks/dispatch`
  const retryRes = await fetch(internalUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('ESIGN_API_KEY')}`,
      'Content-Type': 'application/json',
    },
  }).catch(() => null)

  const retryResult = retryRes?.ok ? await retryRes.json() : { processed: 0 }

  return ok({
    ran_at: now.toISOString(),
    expired: expiredCount,
    expiring_alerted: expiringCount,
    webhooks_retried: retryResult.processed ?? 0,
  })
})

// ── Registrar no pg_cron (rodar no SQL Editor do Supabase) ──────
//
// select cron.schedule(
//   'esign-cron-expire',
//   '*/15 * * * *',
//   $$
//   select net.http_post(
//     url := current_setting('app.supabase_url') || '/functions/v1/cron-expire',
//     headers := jsonb_build_object(
//       'Authorization', 'Bearer ' || current_setting('app.esign_api_key')
//     )
//   );
//   $$
// );