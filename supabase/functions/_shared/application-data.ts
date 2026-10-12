export type ApplicationStatus = 'draft' | 'ready' | 'sending' | 'sent' | 'failed' | 'delivery_unknown' | 'external'
export type Application = {
  id: string; owner_id: string; job_id: string; resume_id: string | null; recipient: string; recipient_verified: boolean;
  subject: string; body: string; status: ApplicationStatus; revision: number; sender_email: string | null;
  gmail_generation: string | null; resume_name: string | null; resume_bytes: number | null; resume_sha256: string | null;
  attempt_id: string | null; gmail_message_id: string | null; error_code: string | null; reconciliation_note: string | null;
  reconciled_at: string | null; created_at: string; updated_at: string; ready_at: string | null; sending_at: string | null;
  sent_at: string | null; external_sent_at: string | null;
}
export function validRecipient(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)) return false
  const [local, domain] = value.split('@')
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && domain.split('.').every(label => label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'))
}
export function validEmailText(subject: unknown, body: unknown) {
  return typeof subject === 'string' && subject.trim().length > 0 && subject.length <= 200 && !Array.from(subject).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    && typeof body === 'string' && body.trim().length > 0 && body.length <= 20000 && !body.includes('\0')
}
