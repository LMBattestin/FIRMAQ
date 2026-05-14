import type { PanelData, VerifyPublicData } from './types'

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''

class ApiError extends Error {
  constructor(public message: string, public code: string, public status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = await res.json()
  if (!res.ok) throw new ApiError(data.message ?? 'Erro desconhecido', data.error ?? 'UNKNOWN', res.status)
  return data as T
}

// ── Painel do signatário ───────────────────────────────────────

export const panel = {
  load: (token: string) =>
    req<PanelData>('GET', `/s/${token}`),

  sendOtp: (token: string) =>
    req<{ sent: boolean; message: string }>('POST', `/s/${token}/send-otp`),

  verify: (token: string, otp: string, cpf?: string) =>
    req<{ session_token: string; verified: boolean }>('POST', `/s/${token}/verify`, { otp, cpf }),

  sign: (token: string, sessionToken: string, geolocation?: { lat: number; lng: number }) =>
    req<{ signed: boolean; signed_at: string; all_signed: boolean; message: string }>(
      'POST', `/s/${token}/sign`, { session_token: sessionToken, accepted: true, geolocation }
    ),

  decline: (token: string, sessionToken: string, reason: string) =>
    req<{ declined: boolean; declined_at: string }>(
      'POST', `/s/${token}/decline`, { session_token: sessionToken, reason }
    ),
}

// ── Verificação pública ────────────────────────────────────────

export const verify = {
  byToken: (auditToken: string) =>
    req<VerifyPublicData>('GET', `/verify/${auditToken}`),
}

export { ApiError }
