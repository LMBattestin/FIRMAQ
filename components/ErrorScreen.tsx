interface ErrorScreenProps {
  code: 'expired' | 'cancelled' | 'not_found' | 'already_signed' | 'generic'
  title?: string
  message?: string
}

const ERRORS = {
  expired: {
    emoji: '⏰',
    title: 'Este link expirou',
    message: 'O prazo para assinatura deste documento encerrou. Entre em contato com quem enviou o documento para obter um novo link.',
  },
  cancelled: {
    emoji: '🚫',
    title: 'Documento cancelado',
    message: 'Este documento foi cancelado pelo remetente e não pode mais ser assinado.',
  },
  not_found: {
    emoji: '🔍',
    title: 'Link inválido',
    message: 'Este link de assinatura não existe ou já foi removido. Verifique o e-mail que recebeu e tente novamente.',
  },
  already_signed: {
    emoji: '✅',
    title: 'Você já assinou',
    message: 'Sua assinatura já foi registrada neste documento. Você receberá o documento final por e-mail quando todos assinarem.',
  },
  generic: {
    emoji: '😕',
    title: 'Algo deu errado',
    message: 'Ocorreu um erro inesperado. Por favor, tente novamente ou entre em contato com o suporte.',
  },
}

export function ErrorScreen({ code, title, message }: ErrorScreenProps) {
  const e = ERRORS[code]
  return (
    <div className="text-center py-16 px-4 animate-fade-in">
      <div className="text-5xl mb-4">{e.emoji}</div>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">{title ?? e.title}</h1>
      <p className="text-gray-500 text-sm leading-relaxed max-w-xs mx-auto">{message ?? e.message}</p>
    </div>
  )
}
