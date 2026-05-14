import type { Metadata } from 'next'
import { Layout }      from '@/components/Layout'
import { SignFlow }    from './SignFlow'
import { ErrorScreen } from '@/components/ErrorScreen'
import { panel, ApiError } from '@/lib/api'

interface Props { params: { token: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: 'Assinar documento' }
}

export default async function SignPage({ params }: Props) {
  const { token } = params

  let data
  let errorCode: 'expired' | 'cancelled' | 'not_found' | 'already_signed' | 'generic' = 'generic'

  try {
    data = await panel.load(token)
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 410) {
        // Determina razão pelo message
        if (e.message?.includes('expirou') || e.message?.includes('expirado')) errorCode = 'expired'
        else if (e.message?.includes('cancelado'))   errorCode = 'cancelled'
        else if (e.message?.includes('indisponível')) errorCode = 'cancelled'
        else errorCode = 'expired'
      } else if (e.status === 404) {
        errorCode = 'not_found'
      }
    }
  }

  return (
    <Layout>
      {data ? (
        <SignFlow token={token} data={data} />
      ) : (
        <ErrorScreen code={errorCode} />
      )}
    </Layout>
  )
}
