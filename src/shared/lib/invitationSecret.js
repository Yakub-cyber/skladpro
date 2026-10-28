// Credentials live only here and in the early, nonenumerable handoff closure.
let proof = null, revision = 0
const listeners = new Set()
const bridge = typeof window !== 'undefined' ? window.__invitationBridge : null
function consume() {
 const value = bridge?.take()
 if (!value) return
 const token = typeof value.token === 'string' && value.token ? value.token : null
 // A deliberate reopening is a new attempt; paired DOM events see an already cleaned URL.
 proof = token ? { token, revision: ++revision } : null
 if (!token) revision++
 const capturedRevision = revision
 queueMicrotask(() => {
  if (revision === capturedRevision) for (const listener of listeners) listener()
 })
}
bridge?.subscribe(consume)
consume()
export const hasInvitationSecret = () => !!proof
export const getInvitationSecret = () => proof?.token ?? null
export const getInvitationProof = () => proof && { ...proof }
export const getInvitationRevision = () => revision
export const isInvitationProofCurrent = value => !!value && proof?.revision === value.revision && proof?.token === value.token
export const onInvitationCaptured = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export function clearInvitationSecret(expected) {
 if (expected && !isInvitationProofCurrent(expected)) return false
 proof = null; revision++; bridge?.clear()
 return true
}
export function requireInvitationTransport() {
 if (typeof location !== 'undefined' && location.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(location.hostname))
  throw new Error('Откройте приглашение через HTTPS')
 const apiUrl = import.meta.env?.VITE_API_URL
 if (apiUrl) {
  const target = new URL(apiUrl, typeof location !== 'undefined' ? location.origin : undefined)
  if (target.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(target.hostname))
   throw new Error('Сервис приглашений должен использовать HTTPS')
 }
}
