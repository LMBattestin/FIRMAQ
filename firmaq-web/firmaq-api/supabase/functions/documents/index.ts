// supabase/functions/documents/index.ts
// Rotas: POST /documents · GET /documents
//        POST /documents/:id/fields
//        POST /documents/:id/signatories
//        POST /documents/:id/send
//        GET  /documents/:id
//        GET  /documents/:id/download
//        GET  /documents/:id/audit
//        POST /documents/:id/cancel
//        POST /documents/:id/remind

import {
  getServiceClient, requireApiKey, ok, err, corsHeaders,
  sha256, dispatchWebhook, auditLog, sendEmail, emailTemplates,
  validateCpf, cpfLastDigits,
} from '../_shared/lib.ts'

const SIGN_BASE_URL = Deno.env.get('SIGN_BASE_URL') ?? 'https://sign.firmaq.com.br'
const TOKEN_EXPIRY_DAYS = 7

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authErr = requireApiKey(req)
  if (authErr) return authErr

  const url = new URL(req.url)
  // Extrai segmentos: /documents, /documents/:id, /documents/:id/fields, etc.
  const segments = url.pathname.replace(/^\/documents\/?/, '').split('/')
  const docId = segments[0] || null
  const sub = segments[1] || null        // fields | signatories | send | download | audit | cancel | remind
  const method = req.method

  const db = getServiceClient()
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? ''
  const ua = req.headers.get('user-agent') ?? ''

  // ── POST /documents ───────────────────────────────────────────
  if (!docId && method === 'POST') {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file || file.type !== 'application/pdf') {
      return err('Arquivo PDF obrigatório', 'INVALID_FILE', 422)
    }
    if (file.size > 10 * 1024 * 1024) {
      return err('Arquivo excede 10MB', 'FILE_TOO_LARGE', 422)
    }

    const title = form.get('title')?.toString()
    if (!title) return err('Título obrigatório', 'VALIDATION_ERROR', 422)

    const signatureType = form.get('signature_type')?.toString() ?? 'avancada'
    const signingMode   = form.get('signing_mode')?.toString() ?? 'parallel'
    const expiresInDays = parseInt(form.get('expires_in_days')?.toString() ?? String(TOKEN_EXPIRY_DAYS))

    const fileBuffer = await file.arrayBuffer()
    const fileHash   = await sha256(fileBuffer)
    const docId_new  = crypto.randomUUID()
    const filePath   = `documents/original/${docId_new}.pdf`
    const expiresAt  = new Date(Date.now() + expiresInDays * 86_400_000).toISOString()

    // Upload para o Storage
    const { error: uploadErr } = await db.storage
      .from('documents')
      .upload(filePath, fileBuffer, { contentType: 'application/pdf', upsert: false })

    if (uploadErr) {
      console.error('Storage upload error:', uploadErr)
      return err('Falha no upload do arquivo', 'STORAGE_ERROR', 500)
    }

    // Persiste o documento
    const { data: doc, error: dbErr } = await db
      .from('documents')
      .insert({
        id: docId_new,
        title,
        description: form.get('description')?.toString() ?? null,
        file_path: filePath,
        file_hash: fileHash,
        signature_type: signatureType,
        signing_mode: signingMode,
        expires_at: expiresAt,
        created_by: form.get('created_by')?.toString() ?? 'api',
      })
      .select()
      .single()

    if (dbErr) {
      console.error('DB insert error:', dbErr)
      return err('Erro ao salvar documento', 'DB_ERROR', 500)
    }

    await auditLog(db, { document_id: docId_new, event: 'document.created', ip, user_agent: ua })
    return ok(doc, 201)
  }

  // ── GET /documents ────────────────────────────────────────────
  if (!docId && method === 'GET') {
    const status  = url.searchParams.get('status')
    const limit   = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
    const offset  = parseInt(url.searchParams.get('offset') ?? '0')

    let query = db.from('documents').select('*, signatories(*)', { count: 'exact' })
    if (status) query = query.eq('status', status)
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) return err('Erro ao buscar documentos', 'DB_ERROR', 500)
    return ok({ data, total: count, limit, offset })
  }

  if (!docId) return err('Rota não encontrada', 'NOT_FOUND', 404)

  // ── GET /documents/:id ────────────────────────────────────────
  if (!sub && method === 'GET') {
    const { data, error } = await db
      .from('documents')
      .select('*, signatories(*), signature_fields(*)')
      .eq('id', docId)
      .single()

    if (error || !data) return err('Documento não encontrado', 'NOT_FOUND', 404)
    return ok(data)
  }

  // ── POST /documents/:id/fields ────────────────────────────────
  if (sub === 'fields' && method === 'POST') {
    const body = await req.json() as { fields: unknown[] }
    if (!body.fields?.length) return err('Campos obrigatórios', 'VALIDATION_ERROR', 422)

    // Remove campos anteriores e insere os novos
    await db.from('signature_fields').delete().eq('document_id', docId)

    const rows = (body.fields as Record<string, unknown>[]).map((f) => ({
      ...f,
      document_id: docId,
    }))

    const { data, error } = await db.from('signature_fields').insert(rows).select()
    if (error) return err('Erro ao salvar campos', 'DB_ERROR', 500)

    return ok({ count: data.length, fields: data }, 201)
  }

  // ── POST /documents/:id/signatories ───────────────────────────
  if (sub === 'signatories' && method === 'POST') {
    const body = await req.json() as { signatories: Record<string, unknown>[] }
    if (!body.signatories?.length) return err('Signatários obrigatórios', 'VALIDATION_ERROR', 422)

    const rows = body.signatories.map((s) => {
      const cpf = s.cpf?.toString().replace(/\D/g, '') ?? null
      if (cpf && !validateCpf(cpf)) {
        throw new Error(`CPF inválido para ${s.name}`)
      }
      return {
        document_id: docId,
        name: s.name,
        email: s.email,
        cpf_hash: cpf ? null : null,   // será preenchido no momento da verificação
        cpf_last_digits: cpf ? cpfLastDigits(cpf) : null,
        role: s.role ?? 'signer',
        signing_order: s.signing_order ?? 0,
        is_app_user: s.is_app_user ?? false,
        app_user_id: s.app_user_id ?? null,
        field_ids: s.field_ids ?? [],
        token_expires_at: null,        // definido no /send
      }
    })

    try {
      const { data, error } = await db.from('signatories').insert(rows).select()
      if (error) return err('Erro ao salvar signatários', 'DB_ERROR', 500)
      return ok({ signatories: data }, 201)
    } catch (e: unknown) {
      return err((e as Error).message, 'VALIDATION_ERROR', 422)
    }
  }

  // ── POST /documents/:id/send ──────────────────────────────────
  if (sub === 'send' && method === 'POST') {
    const { data: doc } = await db
      .from('documents')
      .select('*, signatories(*)')
      .eq('id', docId)
      .single()

    if (!doc) return err('Documento não encontrado', 'NOT_FOUND', 404)
    if (doc.status !== 'draft') {
      return err('Documento já foi enviado', 'CONFLICT', 409)
    }
    if (!doc.signatories?.length) {
      return err('Adicione ao menos um signatário antes de enviar', 'VALIDATION_ERROR', 422)
    }

    const body = await req.json().catch(() => ({})) as { message?: string }
    const expiresAt = doc.expires_at ?? new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86_400_000).toISOString()

    let notified = 0
    // Em modo sequencial, apenas o primeiro (signing_order = 1) recebe o convite agora
    const signatories = doc.signatories as Record<string, unknown>[]
    const toNotify = doc.signing_mode === 'sequential'
      ? signatories.filter((s) => s.signing_order === 1 || s.signing_order === 0)
      : signatories

    for (const sig of signatories) {
      const tokenExpiry = new Date(expiresAt).toISOString()
      await db.from('signatories').update({ token_expires_at: tokenExpiry }).eq('id', sig.id)
    }

    for (const sig of toNotify) {
      const signUrl = `${SIGN_BASE_URL}/s/${sig.token}`
      const { subject, html } = emailTemplates.invite({
        signatoryName: sig.name as string,
        documentTitle: doc.title,
        senderName: 'FIRMAQ',
        signUrl,
        expiresAt: new Date(expiresAt).toLocaleDateString('pt-BR'),
        message: body.message,
      })
      await sendEmail({ to: sig.email as string, subject, html })
      await db.from('signatories').update({ notification_sent_at: new Date().toISOString() }).eq('id', sig.id)
      await auditLog(db, { document_id: docId, signatory_id: sig.id as string, event: 'signatory.notified', ip })
      notified++
    }

    await db.from('documents').update({ status: 'pending' }).eq('id', docId)
    await auditLog(db, { document_id: docId, event: 'document.sent', ip })
    await dispatchWebhook(db, 'document.sent', docId, { notified })

    return ok({ document_id: docId, status: 'pending', notified })
  }

  // ── GET /documents/:id/download ───────────────────────────────
  if (sub === 'download' && method === 'GET') {
    const version  = url.searchParams.get('version') ?? 'signed'
    const { data: doc } = await db.from('documents').select('file_path, signed_file_path, status').eq('id', docId).single()
    if (!doc) return err('Documento não encontrado', 'NOT_FOUND', 404)

    const path = version === 'original' ? doc.file_path : (doc.signed_file_path ?? doc.file_path)
    const expiresIn = 15 * 60   // 15 minutos

    const { data: signed } = await db.storage.from('documents').createSignedUrl(path, expiresIn)
    if (!signed) return err('Erro ao gerar URL', 'STORAGE_ERROR', 500)

    return ok({
      url: signed.signedUrl,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      version,
    })
  }

  // ── GET /documents/:id/audit ──────────────────────────────────
  if (sub === 'audit' && method === 'GET') {
    const { data: doc } = await db.from('documents').select('*').eq('id', docId).single()
    if (!doc) return err('Documento não encontrado', 'NOT_FOUND', 404)

    const { data: logs } = await db
      .from('audit_logs')
      .select('*')
      .eq('document_id', docId)
      .order('created_at', { ascending: true })

    return ok({ document: doc, logs })
  }

  // ── POST /documents/:id/cancel ────────────────────────────────
  if (sub === 'cancel' && method === 'POST') {
    const body = await req.json().catch(() => ({})) as { reason?: string }
    const { data: doc } = await db.from('documents').select('status').eq('id', docId).single()
    if (!doc) return err('Documento não encontrado', 'NOT_FOUND', 404)
    if (!['draft', 'pending'].includes(doc.status)) {
      return err('Não é possível cancelar um documento neste estado', 'CONFLICT', 409)
    }

    await db.from('documents').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: body.reason ?? null,
    }).eq('id', docId)

    await auditLog(db, { document_id: docId, event: 'document.cancelled', ip, payload: { reason: body.reason } })
    await dispatchWebhook(db, 'document.cancelled', docId, { reason: body.reason })

    return ok({ cancelled: true })
  }

  // ── POST /documents/:id/remind ────────────────────────────────
  if (sub === 'remind' && method === 'POST') {
    const body = await req.json().catch(() => ({})) as { signatory_ids?: string[] }

    let query = db.from('signatories').select('*').eq('document_id', docId).eq('status', 'pending')
    if (body.signatory_ids?.length) {
      query = query.in('id', body.signatory_ids)
    }
    const { data: pending } = await query

    const { data: doc } = await db.from('documents').select('title').eq('id', docId).single()

    let reminded = 0
    for (const sig of (pending ?? [])) {
      const signUrl = `${SIGN_BASE_URL}/s/${sig.token}`
      const { subject, html } = emailTemplates.invite({
        signatoryName: sig.name,
        documentTitle: doc?.title ?? 'Documento',
        senderName: 'FIRMAQ',
        signUrl,
        expiresAt: new Date(sig.token_expires_at).toLocaleDateString('pt-BR'),
        message: 'Lembrete: este documento aguarda sua assinatura.',
      })
      await sendEmail({ to: sig.email, subject: `[Lembrete] ${subject}`, html })
      await db.from('signatories').update({ reminder_count: (sig.reminder_count ?? 0) + 1 }).eq('id', sig.id)
      await auditLog(db, { document_id: docId, signatory_id: sig.id, event: 'reminder.sent', ip })
      reminded++
    }

    return ok({ reminded })
  }

  return err('Rota não encontrada', 'NOT_FOUND', 404)
})