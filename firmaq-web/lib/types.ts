export type SignatureType = 'simples' | 'avancada' | 'qualificada'
export type SignatoryRole = 'signer' | 'witness' | 'approver'
export type SigStatus     = 'pending' | 'viewed' | 'signed' | 'declined'
export type DocStatus     = 'draft' | 'pending' | 'completed' | 'cancelled' | 'expired'

export interface PanelData {
  signatory_name:    string
  signatory_email:   string
  signatory_role:    SignatoryRole
  document_title:    string
  signature_type:    SignatureType
  expires_at:        string
  already_signed:    boolean
  file_preview_url:  string
  identity_verified: boolean
  requires_cpf:      boolean
}

export interface VerifyPublicData {
  valid: boolean
  document: {
    title:          string
    status:         DocStatus
    signature_type: SignatureType
    signing_mode:   string
    file_hash:      string
    expires_at:     string
    completed_at:   string | null
    legal_basis:    string
  }
  signatories: {
    name:              string
    role:              SignatoryRole
    status:            SigStatus
    signed_at:         string | null
    cpf_suffix:        string | null
    identity_verified: boolean
  }[]
  timeline: { event: string; created_at: string; ip_address: string }[]
  verification_timestamp: string
}

export type Step = 'welcome' | 'verify' | 'read' | 'confirm' | 'success' | 'declined'
