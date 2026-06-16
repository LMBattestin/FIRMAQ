import { Layout }      from '@/components/Layout'
import { ErrorScreen } from '@/components/ErrorScreen'

export default function NotFound() {
  return (
    <Layout>
      <ErrorScreen code="not_found" />
    </Layout>
  )
}
