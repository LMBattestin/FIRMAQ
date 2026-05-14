import type { Metadata, Viewport } from 'next'
import './globals.css'

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'FIRMAQ'

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Assine documentos com validade jurídica plena — Lei 14.063/2020.',
  robots: 'noindex, nofollow',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
