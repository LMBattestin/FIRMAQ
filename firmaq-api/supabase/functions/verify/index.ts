// supabase/functions/verify/index.ts
// Rotas públicas — sem API key
//
//  GET  /verify/:audit_token   → validar autenticidade por QR code / link
//  POST /verify/hash           → verificar integridade do arquivo por SHA-256

import { getServiceClient, ok, err, corsHeaders, sha256 } from '../_shared/lib.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url      = new URL(req.url)
  const segments = url.pathname.replace(/^\/verify\/?/, '').split('/')
  const param    = segments[0]   // audit_token  ou  'hash'
  const method   = req.method

  const db = getServiceClient()

  // ── POST /verify/hash ─────────────────────────────────────────
  // Recebe um arquivo PDF e verifica se o SHA-256 coincide
  // com algum documento registrado (original ou assinado)
  if (param === 'hash' && method === 'POST') {
    const form = await req.formData()
    const file = form.get('file') as File | null

    if (!file) return err('Arquivo obrigatório', 'MISSING_FILE', 422)

    const buf  = await file.arrayBuffer()
    const hash = await sha256(buf)

    const { data: doc } = await db
      .from('documents')
      .select('id, title, status, signature_type, created_at, audit_token')
      .or(`file_hash.eq.${hash},signed_file_hash.eq.${hash}`)
      .single()

    if (!doc) {
      return ok({
        valid: false,
        document_id: null,
        message: 'Nenhum documento registrado corresponde a este arquivo. Pode ter sido adulterado ou não foi assinado por esta plataforma.',
      })
    }

    return ok({
      valid: true,
      document_id: doc.id,
      document_title: doc.title,
      status: doc.status,
      signature_type: doc.signature_type,
      registered_at: doc.created_at,
      verify_url: `${Deno.env.get('SIGN_BASE_URL')}/verify/${doc.audit_token}`,
      message: 'Arquivo autêntico — hash SHA-256 confere com o registro original.',
    })
  }

  // ── GET /verify/:audit_token ──────────────────────────────────
  // Acessado via QR code ou link público
  if (param && param !== 'hash' && method === 'GET') {
    const { data: doc } = await db
      .from('documents')
      .select('id, title, status, signature_type, signing_mode, expires_at, completed_at, file_hash')
      .eq('audit_token', param)
      .single()

    if (!doc) return err('Documento não encontrado', 'NOT_FOUND', 404)

    // Busca signatários com dados públicos apenas
    const { data: sigs } = await db
      .from('signatories')
      .select('name, role, status, signed_at, cpf_last_digits, identity_verified')
      .eq('document_id', doc.id)
      .order('signing_order', { ascending: true })

    // Busca audit log resumido (eventos de assinatura apenas)
    const { data: signEvents } = await db
      .from('audit_logs')
      .select('event, created_at, ip_address')
      .eq('document_id', doc.id)
      .in('event', ['document.sent', 'signatory.signed', 'signatory.declined', 'document.completed'])
      .order('created_at', { ascending: true })

    const isValid = ['pending', 'completed'].includes(doc.status)

    return ok({
      valid: isValid,
      document: {
        title: doc.title,
        status: doc.status,
        signature_type: doc.signature_type,
        signing_mode: doc.signing_mode,
        file_hash: doc.file_hash,
        expires_at: doc.expires_at,
        completed_at: doc.completed_at,
        legal_basis: 'Lei nº 14.063/2020 | MP 2.200-2/2001',
      },
      signatories: (sigs ?? []).map((s) => ({
        name: s.name,
        role: s.role,
        status: s.status,
        signed_at: s.signed_at,
        cpf_suffix: s.cpf_last_digits ? `***.***.***-${s.cpf_last_digits}` : null,
        identity_verified: s.identity_verified,
      })),
      timeline: signEvents ?? [],
      verification_timestamp: new Date().toISOString(),
    })
  }

  return err('Rota não encontrada', 'NOT_FOUND', 404)
})