// supabase/functions/pdf-engine/index.ts
// Motor de geração do PDF assinado final
//
//  POST /pdf-engine   { document_id }
//  Chamado internamente por sign-panel após document.completed
//  Usa pdf-lib (via esm.sh) — roda 100% em Deno, sem dependências externas
//
//  Resultado:
//    - Insere texto de assinatura em cada campo definido
//    - Adiciona página final de manifesto jurídico
//    - Insere QR code de verificação (como texto URL — versão simplificada)
//    - Salva em Storage: documents/signed/{document_id}.pdf
//    - Envia PDF por e-mail a todos os signatários

import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import {
  getServiceClient, requireApiKey, ok, err, corsHeaders, sha256,
  sendEmail, emailTemplates, auditLog,
} from '../_shared/lib.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authErr = requireApiKey(req)
  if (authErr) return authErr

  const { document_id } = await req.json() as { document_id: string }
  if (!document_id) return err('document_id obrigatório', 'VALIDATION_ERROR', 422)

  const db  = getServiceClient()
  const now = new Date()

  // ── Carrega dados completos do documento ─────────────────────
  const { data: doc } = await db
    .from('documents')
    .select('*, signatories(*), signatures(*), signature_fields(*)')
    .eq('id', document_id)
    .single()

  if (!doc) return err('Documento não encontrado', 'NOT_FOUND', 404)
  if (doc.status !== 'completed') return err('Documento não está completo', 'INVALID_STATUS', 409)

  // ── Baixa o PDF original do Storage ──────────────────────────
  const { data: fileData, error: downloadErr } = await db.storage
    .from('documents')
    .download(doc.file_path)

  if (downloadErr || !fileData) {
    return err('Erro ao baixar PDF original', 'STORAGE_ERROR', 500)
  }

  const originalBytes = await fileData.arrayBuffer()

  // ── Carrega PDF com pdf-lib ───────────────────────────────────
  const pdfDoc = await PDFDocument.load(originalBytes)
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const pages  = pdfDoc.getPages()

  const signatories = doc.signatories  as Record<string, unknown>[]
  const signatures  = doc.signatures   as Record<string, unknown>[]
  const fields      = doc.signature_fields as Record<string, unknown>[]

  // ── Aplica assinaturas visuais nos campos definidos ───────────
  for (const field of fields) {
    if (field.field_type !== 'signature') continue

    const pageIndex = (field.page as number) - 1
    if (pageIndex < 0 || pageIndex >= pages.length) continue

    const page = pages[pageIndex]
    const { height: pageH } = page.getSize()

    // Encontra a assinatura correspondente a este campo
    const sig = signatures.find(
      (s) => s.field_id === field.id ||
             (s.signatory_id &&
              (signatories.find((sg) => sg.id === s.signatory_id)?.field_ids as string[] ?? []).includes(field.id as string))
    )
    const signatory = sig
      ? signatories.find((s) => s.id === sig.signatory_id)
      : null

    // Caixa de assinatura: borda fina
    const x      = field.x as number
    const y      = pageH - (field.y as number) - (field.height as number)  // PDF coords: bottom-left origin
    const w      = field.width  as number
    const h      = field.height as number

    page.drawRectangle({
      x, y, width: w, height: h,
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 0.5,
      color: rgb(0.98, 0.98, 1),
    })

    if (signatory && sig) {
      const name       = signatory.name as string
      const cpfSuffix  = signatory.cpf_last_digits ? `CPF: ***.***.***-${signatory.cpf_last_digits}` : ''
      const signedAt   = new Date(sig.created_at as string).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      const role       = (signatory.role as string) === 'witness' ? 'Testemunha' : 'Signatário'

      // Nome em bold
      page.drawText(name, {
        x: x + 4, y: y + h - 14,
        size: 8, font: fontB, color: rgb(0.1, 0.1, 0.1),
        maxWidth: w - 8,
      })

      // Linha 2: papel + CPF
      page.drawText(`${role}${cpfSuffix ? ' · ' + cpfSuffix : ''}`, {
        x: x + 4, y: y + h - 24,
        size: 6.5, font, color: rgb(0.4, 0.4, 0.4),
        maxWidth: w - 8,
      })

      // Linha 3: data/hora
      page.drawText(signedAt + ' BRT', {
        x: x + 4, y: y + h - 34,
        size: 6.5, font, color: rgb(0.4, 0.4, 0.4),
      })

      // Linha 4: base legal
      page.drawText('Ass. eletr. avançada · Lei 14.063/2020', {
        x: x + 4, y: y + h - 44,
        size: 6, font, color: rgb(0.55, 0.55, 0.55),
      })
    } else {
      // Campo não preenchido (não deveria ocorrer pós-completion)
      page.drawText('Assinatura pendente', {
        x: x + 4, y: y + h - 16,
        size: 7, font, color: rgb(0.7, 0.4, 0.4),
      })
    }
  }

  // ── Página final: manifesto jurídico ─────────────────────────
  const manifestPage = pdfDoc.addPage([595.28, 841.89])  // A4
  const { width: mW, height: mH } = manifestPage.getSize()
  const margin = 50

  // Cabeçalho
  manifestPage.drawRectangle({
    x: 0, y: mH - 60, width: mW, height: 60,
    color: rgb(0.05, 0.05, 0.05),
  })

  manifestPage.drawText('MANIFESTO DE ASSINATURA ELETRÔNICA', {
    x: margin, y: mH - 28,
    size: 13, font: fontB, color: rgb(1, 1, 1),
  })

  manifestPage.drawText('Gerado automaticamente com validade jurídica — Lei nº 14.063/2020', {
    x: margin, y: mH - 46,
    size: 8, font, color: rgb(0.8, 0.8, 0.8),
  })

  let curY = mH - 90

  // Dados do documento
  const drawLabel = (label: string, value: string, y: number) => {
    manifestPage.drawText(label + ':', {
      x: margin, y, size: 8, font: fontB, color: rgb(0.3, 0.3, 0.3),
    })
    manifestPage.drawText(value, {
      x: margin + 110, y, size: 8, font, color: rgb(0.1, 0.1, 0.1),
    })
  }

  const drawSection = (title: string, y: number) => {
    manifestPage.drawText(title.toUpperCase(), {
      x: margin, y, size: 8, font: fontB, color: rgb(0.4, 0.4, 0.4),
    })
    manifestPage.drawLine({
      start: { x: margin, y: y - 4 },
      end:   { x: mW - margin, y: y - 4 },
      thickness: 0.5, color: rgb(0.85, 0.85, 0.85),
    })
    return y - 18
  }

  curY = drawSection('Documento', curY)
  drawLabel('Título',        doc.title, curY);                   curY -= 14
  drawLabel('ID',            doc.id, curY);                      curY -= 14
  drawLabel('Hash SHA-256',  doc.file_hash, curY);               curY -= 14
  drawLabel('Status',        'Assinado por todos', curY);        curY -= 14
  drawLabel('Tipo assin.',   'Eletrônica Avançada', curY);       curY -= 14
  drawLabel('Concluído em',  now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' BRT', curY)
  curY -= 26

  // Signatários
  curY = drawSection('Signatários e assinaturas', curY)

  for (const sig of signatories) {
    const sigRecord = signatures.find((s) => s.signatory_id === sig.id)
    const roleLabel = sig.role === 'witness' ? 'Testemunha' : 'Signatário'
    const verif     = sig.identity_verified ? 'OTP e-mail + CPF validado' : 'OTP e-mail'

    manifestPage.drawText(`${roleLabel.toUpperCase()}: ${sig.name as string}`, {
      x: margin, y: curY, size: 8.5, font: fontB, color: rgb(0.1, 0.1, 0.1),
    })
    curY -= 13

    drawLabel('E-mail',    sig.email as string, curY);   curY -= 11
    if (sig.cpf_last_digits) {
      drawLabel('CPF',       `***.***.***-${sig.cpf_last_digits as string}`, curY); curY -= 11
    }
    drawLabel('Verificação', verif, curY);                curY -= 11
    if (sigRecord) {
      drawLabel('Assinado em', new Date(sigRecord.created_at as string).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' BRT', curY)
      curY -= 11
      drawLabel('IP',          sigRecord.ip_address as string ?? 'não registrado', curY)
      curY -= 11
      drawLabel('Hash no momento', (sigRecord.hash_at_signing as string).slice(0, 32) + '...', curY)
      curY -= 11
    }

    // Linha separadora entre signatários
    manifestPage.drawLine({
      start: { x: margin, y: curY + 4 },
      end:   { x: mW - margin, y: curY + 4 },
      thickness: 0.3, color: rgb(0.92, 0.92, 0.92),
    })
    curY -= 14
  }

  curY -= 10
  curY = drawSection('Verificação e validade', curY)

  const auditToken  = doc.audit_token as string
  const verifyUrl   = `${Deno.env.get('SIGN_BASE_URL')}/verify/${auditToken}`

  drawLabel('URL de verificação', verifyUrl, curY);  curY -= 14
  drawLabel('Token de auditoria', auditToken, curY); curY -= 14
  drawLabel('Base legal', 'Lei 14.063/2020 · Lei 13.874/2019 · CC Art. 107 · LGPD (Lei 13.709/2018)', curY)
  curY -= 26

  // Rodapé
  manifestPage.drawRectangle({
    x: 0, y: 0, width: mW, height: 35,
    color: rgb(0.96, 0.96, 0.96),
  })
  manifestPage.drawText(
    `Este manifesto é parte integrante e inseparável do documento. Autenticidade verificável em: ${verifyUrl}`,
    { x: margin, y: 14, size: 6.5, font, color: rgb(0.5, 0.5, 0.5), maxWidth: mW - margin * 2 }
  )

  // ── Gera bytes do PDF final ───────────────────────────────────
  const signedBytes = await pdfDoc.save()
  const signedPath  = `documents/signed/${document_id}.pdf`

  // ── Salva no Storage ──────────────────────────────────────────
  const { error: uploadErr } = await db.storage
    .from('documents')
    .upload(signedPath, signedBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadErr) {
    console.error('Storage upload error (signed):', uploadErr)
    return err('Erro ao salvar PDF assinado', 'STORAGE_ERROR', 500)
  }

  // Atualiza o caminho do arquivo assinado no banco
  await db.from('documents')
    .update({ signed_file_path: signedPath, signed_file_hash: await sha256(signedBytes.buffer) })
    .eq('id', document_id)

  await auditLog(db, { document_id, event: 'pdf.generated' })

  // ── Envia PDF por e-mail a todos os envolvidos ────────────────
  // URL pré-assinada com validade de 24h para o e-mail
  const { data: signed24h } = await db.storage
    .from('documents')
    .createSignedUrl(signedPath, 24 * 60 * 60)

  const downloadUrl = signed24h?.signedUrl ?? verifyUrl

  for (const sig of signatories) {
    const { subject, html } = emailTemplates.completed({
      name: sig.name as string,
      documentTitle: doc.title,
      downloadUrl,
    })
    await sendEmail({ to: sig.email as string, subject, html })
  }

  return ok({
    generated: true,
    signed_file_path: signedPath,
    pages: pdfDoc.getPageCount(),
  })
})