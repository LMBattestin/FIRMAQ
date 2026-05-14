import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) + ' (BRT)'
}

export function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'expirado'
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(hours / 24)
  if (days > 1)  return `${days} dias`
  if (days === 1) return '1 dia'
  if (hours > 1) return `${hours} horas`
  return 'menos de 1 hora'
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  return user.slice(0, 2) + '***@' + domain
}

export function roleLabel(role: string): string {
  return role === 'witness' ? 'Testemunha' : role === 'approver' ? 'Aprovador' : 'Signatário'
}

export function sigTypeLabel(type: string): string {
  if (type === 'avancada')    return 'Avançada (CPF + Código)'
  if (type === 'qualificada') return 'Qualificada (ICP-Brasil)'
  return 'Simples (Código por e-mail)'
}
