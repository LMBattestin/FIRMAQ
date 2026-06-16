'use client'
import { useState }        from 'react'
import { StepIndicator }   from '@/components/StepIndicator'
import { Welcome }         from '@/components/steps/Welcome'
import { VerifyIdentity }  from '@/components/steps/VerifyIdentity'
import { ReadDocument }    from '@/components/steps/ReadDocument'
import { ConfirmSign }     from '@/components/steps/ConfirmSign'
import { Success, Declined } from '@/components/steps/SuccessAndDeclined'
import type { PanelData, Step } from '@/lib/types'

interface SignFlowProps {
  token: string
  data:  PanelData
}

export function SignFlow({ token, data }: SignFlowProps) {
  const [step, setStep]               = useState<Step>(data.already_signed ? 'success' : 'welcome')
  const [sessionToken, setSessionToken] = useState('')
  const [allSigned, setAllSigned]     = useState(false)
  const [signedAt, setSignedAt]       = useState('')
  const [showDecline, setShowDecline] = useState(false)

  if (data.already_signed && step !== 'success') {
    return (
      <div className="py-8 text-center space-y-4">
        <div className="text-4xl">✅</div>
        <h2 className="text-lg font-semibold text-gray-900">Você já assinou este documento</h2>
        <p className="text-sm text-gray-500">Você receberá o documento final por e-mail quando todos os signatários assinarem.</p>
      </div>
    )
  }

  if (showDecline) {
    return (
      <>
        <StepIndicator current="read" />
        <Declined
          token={token}
          sessionToken={sessionToken}
          onBack={() => setShowDecline(false)}
          onConfirmed={() => { setShowDecline(false); setStep('welcome') }}
        />
      </>
    )
  }

  return (
    <>
      <StepIndicator current={step} />

      {step === 'welcome' && (
        <Welcome data={data} onStart={() => setStep('verify')} />
      )}

      {step === 'verify' && (
        <VerifyIdentity
          token={token}
          data={data}
          onVerified={st => { setSessionToken(st); setStep('read') }}
          onBack={() => setStep('welcome')}
        />
      )}

      {step === 'read' && (
        <ReadDocument
          data={data}
          onConfirm={() => setStep('confirm')}
          onDecline={() => setShowDecline(true)}
          onBack={() => setStep('verify')}
        />
      )}

      {step === 'confirm' && (
        <ConfirmSign
          token={token}
          data={data}
          sessionToken={sessionToken}
          onSigned={(all, at) => { setAllSigned(all); setSignedAt(at); setStep('success') }}
          onBack={() => setStep('read')}
        />
      )}

      {step === 'success' && (
        <Success
          documentTitle={data.document_title}
          signedAt={signedAt || new Date().toISOString()}
          allSigned={allSigned}
        />
      )}
    </>
  )
}
