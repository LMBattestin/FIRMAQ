import { redirect } from 'next/navigation'

export default function Home() {
  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1>FIRMAQ API</h1>
      <p>Painel de assinatura funcionando.</p>
      <p>Acesse um link de assinatura no formato: <code>/s/TOKEN</code></p>
    </div>
  )
}