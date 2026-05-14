'use client'
import { useState, useEffect } from 'react'
import { Button }   from '@/components/ui/Button'
import { OTPInput } from '@/components/ui/index'
import { panel }    from '@/lib/api'
import { maskEmail } from '@/lib/utils'
import type { PanelData } from '@/lib/types'

interface VerifyProps {
  token:       string
  data:        PanelData
  onVerified:  (sessionToken: string) => void
  onBack:      () => void
}

type Phase = 'request' | 'code' | 'cpf_code'

function validateCpf(cpf: string): boolean {
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

function formatCpf(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
         .replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')
         .replace(/(\d{3})(\d{3})/, '$1.$2')
}

export function VerifyIdentity({ token, data, onVerified, onBack }: VerifyProps) {
  const [phase, setPhase]         = useState<Phase>('request')
  const [cpf, setCpf]             = useState('')
  const [otp, setOtp]             = useState('')
  const [otpMsg, setOtpMsg]       = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [countdown, setCountdown] = useState(0)
  const [cpfError, setCpfError]   = useState('')

  const isAdvanced = data.signature_type === 'avancada'

  // Countdown para reenvio
  useEffect(() => {
    if (!countdown) return
    const id = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [countdown])

  async function requestOtp() {
    setLoading(true); setError('')
    try {
      const res = await panel.sendOtp(token)
      setOtpMsg(res.message)
      setPhase(isAdvanced ? 'cpf_code' : 'code')
      setCountdown(60)
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string }
      if (err.code === 'RATE_LIMITED') setError('Muitas tentativas. Aguarde alguns minutos.')
      else setError('Não foi possível enviar o código. Tente novamente.')
    } finally { setLoading(false) }
  }

  async function handleVerify() {
    setError(''); setCpfError('')

    if (isAdvanced) {
      const raw = cpf.replace(/\D/g, '')
      if (!validateCpf(raw)) { setCpfError('CPF inválido. Verifique e tente novamente.'); return }
    }
    if (otp.length < 6) { setError('Digite os 6 dígitos do código.'); return }

    setLoading(true)
    try {
      const raw = cpf.replace(/\D/g, '')
      const res = await panel.verify(token, otp, isAdvanced ? raw : undefined)
      onVerified(res.session_token)
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string }
      if (err.code === 'INVALID_OTP')   setError('Código incorreto ou expirado. Verifique e tente novamente.')
      else if (err.code === 'CPF_MISMATCH') setCpfError('Este CPF não corresponde ao cadastrado para sua assinatura.')
      else if (err.code === 'INVALID_CPF') setCpfError('CPF inválido. Verifique os números e tente novamente.')
      else if (err.code === 'TOKEN_BLOCKED') setError('Muitas tentativas incorretas. O link foi bloqueado por segurança. Entre em contato com o remetente.')
      else setError('Não foi possível verificar. Tente novamente.')
      setOtp('')
    } finally { setLoading(false) }
  }

  if (phase === 'request') {
    return (
      <div className="animate-fade-in space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Verificar sua identidade</h2>
          <p className="text-sm text-gray-500">
            Para garantir a segurança da assinatura, precisamos confirmar que é você.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 shadow-sm">
          <div className="flex gap-3 items-start">
            <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Código por e-mail</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Enviaremos um código de 6 dígitos para <strong>{maskEmail(data.signatory_email)}</strong>
              </p>
            </div>
          </div>

          {isAdvanced && (
            <div className="flex gap-3 items-start border-t border-gray-50 pt-4">
              <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Confirmação de CPF</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Você também precisará informar seu CPF para validação
                </p>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

        <div className="space-y-3 safe-bottom">
          <Button fullWidth onClick={requestOtp} loading={loading}>
            Enviar código de verificação
          </Button>
          <Button fullWidth variant="ghost" onClick={onBack}>Voltar</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">
          {isAdvanced ? 'CPF e código de verificação' : 'Código de verificação'}
        </h2>
        <p className="text-sm text-gray-500">{otpMsg}</p>
      </div>

      {isAdvanced && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="cpf-input">
            Seu CPF
          </label>
          <input
            id="cpf-input"
            type="text"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={e => setCpf(formatCpf(e.target.value))}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-base text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
            aria-describedby={cpfError ? 'cpf-error' : undefined}
            aria-invalid={!!cpfError}
          />
          {cpfError && <p id="cpf-error" className="mt-2 text-xs text-red-600">{cpfError}</p>}
          <p className="mt-2 text-xs text-gray-400">Deve ser o mesmo CPF vinculado a este contrato</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
          Digite o código de 6 dígitos
        </label>
        <OTPInput
          value={otp}
          onChange={setOtp}
          disabled={loading}
          error={!!error}
        />
        {error && <p className="mt-3 text-sm text-red-600 text-center">{error}</p>}

        <div className="mt-4 text-center">
          {countdown > 0 ? (
            <p className="text-xs text-gray-400">Reenviar código em {countdown}s</p>
          ) : (
            <button
              onClick={requestOtp}
              disabled={loading}
              className="text-xs text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors disabled:opacity-50"
            >
              Não recebeu o código? Reenviar
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 safe-bottom">
        <Button
          fullWidth
          onClick={handleVerify}
          loading={loading}
          disabled={otp.length < 6 || (isAdvanced && cpf.replace(/\D/g, '').length < 11)}
        >
          Confirmar identidade
        </Button>
        <Button fullWidth variant="ghost" onClick={() => { setPhase('request'); setOtp(''); setError('') }}>
          Voltar
        </Button>
      </div>
    </div>
  )
}
