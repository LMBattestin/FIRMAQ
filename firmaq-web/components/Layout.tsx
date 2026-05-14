import { cn } from '@/lib/utils'

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'FIRMAQ'
const LOGO_URL  = process.env.NEXT_PUBLIC_LOGO_URL ?? ''

interface LayoutProps {
  children: React.ReactNode
  maxWidth?: 'sm' | 'md'
}

export function Layout({ children, maxWidth = 'sm' }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-2">
          {LOGO_URL ? (
            <img src={LOGO_URL} alt={APP_NAME} className="h-7 w-auto" />
          ) : (
            <>
              <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-gray-900">{APP_NAME}</span>
            </>
          )}
          <div className="ml-auto">
            <span className="text-xs text-gray-400">Assinatura segura</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className={cn('flex-1 w-full mx-auto px-4 py-6 pb-8', maxWidth === 'sm' ? 'max-w-lg' : 'max-w-2xl')}>
        {children}
      </main>

      {/* Footer */}
      <footer className="py-4 px-4 text-center">
        <p className="text-xs text-gray-400">
          Assinatura com validade jurídica plena pela{' '}
          <a
            href="https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-gray-600 transition-colors"
          >
            Lei nº 14.063/2020
          </a>
        </p>
      </footer>
    </div>
  )
}
