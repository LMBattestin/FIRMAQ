'use client'
import { Layout }      from '@/components/Layout'
import { ErrorScreen } from '@/components/ErrorScreen'
import { Button }      from '@/components/ui/Button'

export default function Error({ reset }: { reset: () => void }) {
  return (
    <Layout>
      <ErrorScreen code="generic" />
      <div className="mt-6 text-center">
        <Button variant="secondary" onClick={reset}>Tentar novamente</Button>
      </div>
    </Layout>
  )
}
