// supabase/functions/sign-panel/index.ts
// Rotas do painel web do signatário — sem API key, autenticado pelo token de URL
//
//  GET  /s/:token            → carregar painel
//  POST /s/:token/send-otp   → solicitar código OTP por e-mail
//  POST /s/:token/verify     → verificar CPF + OTP → retorna session_token
//  POST /s/:token/sign       → assinar o documento
//  POST /s/:token/decline    → recusar a assinatura

import {
  getServiceClient, ok, err, corsHeaders,
  sha256, hashOtp, generateOtp,
  validateCpf, cpfLastDigits,
  sendEmail, emailTemplates,
  dispatchWebhook, auditLog,
} from '../_shared/lib.ts'

const INVOKE_PDF_ENGINE = Deno.env.get('PDF_ENGINE_URL')  // URL interna da pdf-engine function

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  // Espera: /s/:token  ou  /s/:token/send-otp  /s/:token/verify  /s/:token/sign  /s/:token/decline
  const parts    = url.pathname.replace(/^\/s\/?/, '').split('/')
  const token    = parts[0]
  const action   = parts[1] ?? null   // send-otp | verify | sign | decline
  const method   = req.method

  if (!token) return err('Token obrigatório', 'MISSING_TOKEN', 400)

  const db = getServiceClient()
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? ''
  const ua = req.headers.get('user-agent') ?? ''

  // Valida token do signatário
  const { data: sig, error: sigErr } = await db
    .from('signatories')
    .select('*, documents(*)')
    .eq('token', token)
    .single()

  if (sigErr || !sig) return err('Link inválido', 'INVALID_TOKEN', 404)

  const doc = sig.documents as Record<string, unknown>

  // Verifica expiração do token
  if (sig.token_expires_at && new Date(sig.token_expires_at) < new Date()) {
    return err('Este link expirou', 'TOKEN_EXPIRED', 410)
  }

  // Verifica status do documento
  if (!['pending'].includes(doc.status as string)) {
    const msgs: Record<string, string> = {
      completed: 'Este documento já foi assinado por todos.',
      cancelled: 'Este documento foi cancelado.',
      expired:   'O prazo para assinatura expirou.',
    }
    return err(msgs[doc.status as string] ?? 'Documento indisponível', 'DOCUMENT_UNAVAILABLE', 410)
  }

  // ── GET /s/:token ─────────────────────────────────────────────
  if (!action && method === 'GET') {
    // Log de visualização (apenas na primeira vez)
    if (!sig.viewed_at) {
      await db.from('signatories')
        .update({ viewed_at: new Date().toISOString(), status: 'viewed' })
        .eq('id', sig.id)
      await auditLog(db, { document_id: sig.document_id, signatory_id: sig.id, event: 'signatory.viewed', ip, user_agent: ua })
      await dispatchWebhook(db, 'signatory.viewed', sig.document_id, {
        signatory: { id: sig.id, name: sig.name, email: sig.email },
      })
    }

    // URL de preview do PDF (15 min)
    const { data: signed } = await db.storage
      .from('documents')
      .createSignedUrl(doc.file_path as string, 15 * 60)

    return ok({
      signatory_name:    sig.name,
      signatory_email:   sig.email,
      signatory_role:    sig.role,
      document_title:    doc.title,
      signature_type:    doc.signature_type,
      expires_at:        sig.token_expires_at,
      already_signed:    sig.status === 'signed',
      file_preview_url:  signed?.signedUrl ?? null,
      identity_verified: sig.identity_verified,
      requires_cpf:      doc.signature_type === 'avancada',
    })
  }

  // ── POST /s/:token/send-otp ───────────────────────────────────
  if (action === 'send-otp' && method === 'POST') {
    // Rate limit: máx 3 OTPs na última hora
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count } = await db
      .from('otp_codes')
      .select('id', { count: 'exact', head: true })
      .eq('signatory_id', sig.id)
      .gte('created_at', oneHourAgo)

    if ((count ?? 0) >= 3) {
      return err('Muitas tentativas. Aguarde antes de solicitar novo código.', 'RATE_LIMITED', 429)
    }

    const code = generateOtp()
    const codeHash = await hashOtp(code)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()   // 30 min

    await db.from('otp_codes').insert({
      signatory_id: sig.id,
      code_hash: codeHash,
      expires_at: expiresAt,
    })

    const { subject, html } = emailTemplates.otp({ signatoryName: sig.name, code })
    await sendEmail({ to: sig.email, subject, html })

    await auditLog(db, { document_id: sig.document_id, signatory_id: sig.id, event: 'signatory.otp_requested', ip })

    // Ofuscar o e-mail: jo***@gmail.com
    const [user, domain] = sig.email.split('@')
    const masked = user.slice(0, 2) + '***@' + domain

    return ok({ sent: true, message: `Código enviado para ${masked}` })
  }

  // ── POST /s/:token/verify ─────────────────────────────────────
  if (action === 'verify' && method === 'POST') {
    const body = await req.json() as { otp: string; cpf?: string }

    if (!body.otp || !/^\d{6}$/.test(body.otp)) {
      return err('OTP inválido', 'INVALID_OTP', 422)
    }

    // Verifica CPF (para assinatura avançada)
    if (doc.signature_type === 'avancada') {
      if (!body.cpf) return err('CPF obrigatório', 'MISSING_CPF', 422)
      const cpf = body.cpf.replace(/\D/g, '')
      if (!validateCpf(cpf)) return err('CPF inválido', 'INVALID_CPF', 422)

      // Compara os últimos 2 dígitos com o cadastro (sem armazenar CPF raw)
      if (sig.cpf_last_digits && cpfLastDigits(cpf) !== sig.cpf_last_digits) {
        await auditLog(db, { document_id: sig.document_id, signatory_id: sig.id, event: 'signatory.identity_failed', ip, payload: { reason: 'cpf_mismatch' } })
        await dispatchWebhook(db, 'signatory.identity_failed', sig.document_id, { signatory_id: sig.id, reason: 'cpf_mismatch' })
        return err('CPF não confere com o cadastrado', 'CPF_MISMATCH', 422)
      }

      // Armazena hash do CPF (apenas uma vez)
      if (!sig.cpf_hash) {
        const cpfHash = await sha256(cpf)
        await db.from('signatories').update({ cpf_hash: cpfHash, cpf_validated: true }).eq('id', sig.id)
      }
    }

    // Valida OTP
    const codeHash = await hashOtp(body.otp)
    const { data: otpRow } = await db
      .from('otp_codes')
      .select('*')
      .eq('signatory_id', sig.id)
      .eq('code_hash', codeHash)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!otpRow) {
      // Incrementa tentativas erradas no OTP mais recente
      const { data: latestOtp } = await db
        .from('otp_codes')
        .select('id, attempt_count')
        .eq('signatory_id', sig.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (latestOtp) {
        await db.from('otp_codes')
          .update({ attempt_count: (latestOtp.attempt_count ?? 0) + 1 })
          .eq('id', latestOtp.id)

        if ((latestOtp.attempt_count ?? 0) + 1 >= 5) {
          // Bloqueia o token após 5 tentativas erradas
          await db.from('signatories').update({ token_expires_at: new Date().toISOString() }).eq('id', sig.id)
          return err('Muitas tentativas incorretas. Link bloqueado.', 'TOKEN_BLOCKED', 401)
        }
      }

      return err('Código inválido ou expirado', 'INVALID_OTP', 401)
    }

    // Marca OTP como usado
    await db.from('otp_codes').update({ used_at: new Date().toISOString() }).eq('id', otpRow.id)

    // Cria session_token (30 min, uso único)
    const sessionToken = crypto.randomUUID()
    await db.from('signatory_sessions').insert({
      signatory_id: sig.id,
      session_token: sessionToken,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })

    await db.from('signatories').update({
      identity_verified: true,
      otp_verified_at: new Date().toISOString(),
      ip_address: ip,
      user_agent: ua,
    }).eq('id', sig.id)

    await auditLog(db, { document_id: sig.document_id, signatory_id: sig.id, event: 'signatory.otp_verified', ip })

    return ok({ session_token: sessionToken, verified: true })
  }

  // ── POST /s/:token/sign ───────────────────────────────────────
  if (action === 'sign' && method === 'POST') {
    const body = await req.json() as { session_token: string; accepted: boolean; geolocation?: Record<string, unknown> }

    if (!body.accepted) return err('É necessário aceitar o documento', 'NOT_ACCEPTED', 422)

    // Valida session_token
    const { data: session } = await db
      .from('signatory_sessions')
      .select('*')
      .eq('session_token', body.session_token)
      .eq('signatory_id', sig.id)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .single()

    if (!session) return err('Sessão inválida ou expirada', 'INVALID_SESSION', 401)

    // Verifica se já assinou
    if (sig.status === 'signed') {
      return err('Você já assinou este documento', 'ALREADY_SIGNED', 409)
    }

    const signedAt = new Date().toISOString()

    // Calcula hash do documento no momento da assinatura
    const { data: fileData } = await db.storage
      .from('documents')
      .download(doc.file_path as string)

    const fileBuffer = await fileData!.arrayBuffer()
    const hashAtSigning = await sha256(fileBuffer)

    // Texto visual da assinatura
    const visualText = [
      sig.name,
      sig.cpf_last_digits ? `CPF: ***.***.***-${sig.cpf_last_digits}` : null,
      `Ass. eletrônica avançada — Lei 14.063/2020`,
      new Date(signedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' BRT',
      `IP: ${ip.split(',')[0].trim()}`,
    ].filter(Boolean).join('\n')

    // Registra a assinatura
    await db.from('signatures').insert({
      document_id: sig.document_id,
      signatory_id: sig.id,
      visual_text: visualText,
      hash_at_signing: hashAtSigning,
      ip_address: ip,
    })

    // Atualiza o signatário
    await db.from('signatories').update({
      status: 'signed',
      signed_at: signedAt,
      ip_address: ip,
      user_agent: ua,
      geolocation: body.geolocation ?? null,
    }).eq('id', sig.id)

    // Invalida a sessão (uso único)
    await db.from('signatory_sessions').update({ used_at: signedAt }).eq('id', session.id)

    await auditLog(db, {
      document_id: sig.document_id,
      signatory_id: sig.id,
      event: 'signatory.signed',
      ip,
      payload: { hash_at_signing: hashAtSigning },
    })

    // Dispara webhook signatory.signed
    await dispatchWebhook(db, 'signatory.signed', sig.document_id, {
      signatory: { id: sig.id, name: sig.name, email: sig.email, signed_at: signedAt, ip, verified: true },
      document: { title: doc.title, status: 'pending' },
    })

    // Envia comprovante para o signatário
    const { subject, html } = emailTemplates.signed({
      signatoryName: sig.name,
      documentTitle: doc.title as string,
      signedAt: new Date(signedAt).toLocaleString('pt-BR'),
    })
    await sendEmail({ to: sig.email, subject, html })

    // Verifica se todos assinaram
    const { error: completeErr } = await db.rpc('check_document_completion', { p_document_id: sig.document_id })
    if (completeErr) console.error('check_document_completion error:', completeErr)

    // Consulta status atualizado
    const { data: updatedDoc } = await db.from('documents').select('status').eq('id', sig.document_id).single()
    const allSigned = updatedDoc?.status === 'completed'

    // Se concluído, dispara geração do PDF e notificações finais
    if (allSigned) {
      await auditLog(db, { document_id: sig.document_id, event: 'document.completed', ip })
      await dispatchWebhook(db, 'document.completed', sig.document_id, { document_title: doc.title })

      // Chama pdf-engine para gerar PDF final (async)
      if (INVOKE_PDF_ENGINE) {
        fetch(INVOKE_PDF_ENGINE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('ESIGN_API_KEY')}` },
          body: JSON.stringify({ document_id: sig.document_id }),
        }).catch(console.error)
      }
    }

    // Próximo signatário em modo sequencial
    if (!allSigned && doc.signing_mode === 'sequential') {
      const { data: allSigs } = await db
        .from('signatories')
        .select('*')
        .eq('document_id', sig.document_id)
        .order('signing_order', { ascending: true })

      const nextSig = (allSigs ?? []).find(
        (s: Record<string, unknown>) => s.status === 'pending' && (s.signing_order as number) > (sig.signing_order ?? 0)
      )

      if (nextSig) {
        const { subject: invSub, html: invHtml } = emailTemplates.invite({
          signatoryName: nextSig.name,
          documentTitle: doc.title as string,
          senderName: 'FIRMAQ',
          signUrl: `${Deno.env.get('SIGN_BASE_URL')}/s/${nextSig.token}`,
          expiresAt: new Date(nextSig.token_expires_at).toLocaleDateString('pt-BR'),
        })
        await sendEmail({ to: nextSig.email, subject: invSub, html: invHtml })
        await db.from('signatories').update({ notification_sent_at: new Date().toISOString() }).eq('id', nextSig.id)
      }
    }

    return ok({ signed: true, signed_at: signedAt, all_signed: allSigned, message: allSigned ? 'Todos assinaram! O PDF final será gerado e enviado por e-mail.' : 'Assinatura registrada. Aguardando os demais signatários.' })
  }

  // ── POST /s/:token/decline ────────────────────────────────────
  if (action === 'decline' && method === 'POST') {
    const body = await req.json() as { session_token: string; reason: string }

    if (!body.reason || body.reason.trim().length < 10) {
      return err('Informe o motivo da recusa (mínimo 10 caracteres)', 'VALIDATION_ERROR', 422)
    }

    const { data: session } = await db
      .from('signatory_sessions')
      .select('id')
      .eq('session_token', body.session_token)
      .eq('signatory_id', sig.id)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .single()

    if (!session) return err('Sessão inválida ou expirada', 'INVALID_SESSION', 401)

    const declinedAt = new Date().toISOString()

    await db.from('signatories').update({
      status: 'declined',
      declined_at: declinedAt,
      decline_reason: body.reason,
    }).eq('id', sig.id)

    await db.from('signatory_sessions').update({ used_at: declinedAt }).eq('id', session.id)

    await auditLog(db, {
      document_id: sig.document_id,
      signatory_id: sig.id,
      event: 'signatory.declined',
      ip,
      payload: { reason: body.reason },
    })

    await dispatchWebhook(db, 'signatory.declined', sig.document_id, {
      signatory: { id: sig.id, name: sig.name, email: sig.email, reason: body.reason },
      document: { title: doc.title },
    })

    return ok({ declined: true, declined_at: declinedAt })
  }

  return err('Rota não encontrada', 'NOT_FOUND', 404)
})