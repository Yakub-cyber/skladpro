// Independent of invitation capture/session state: old proofs must stay redacted
// even after their in-memory record is cleared or the navigation handler fails.
const sensitiveKey = /^(?:invite|inviteToken|invitationSecret|token|accessToken|refreshToken|authorization|password)$/i
export function sanitizeSensitiveText(value) {
 return String(value)
  .replace(/((?:invite|inviteToken)(?:=|%3d))[^&#\s"'<>]*/gi, '$1[REDACTED]')
  .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g, '[REDACTED]')
}
export function sanitizeSensitiveData(value, depth = 0, seen = new WeakSet(), path = [], sdk = false) {
 // These are SDK-generated identities, not application URLs or arbitrary extra data.
 const sdkId = sdk && ['event_id','contexts.trace.trace_id','sdkProcessingMetadata.dynamicSamplingContext.trace_id','sdkProcessingMetadata.dynamicSamplingContext.public_key'].includes(path.join('.'))
 if (sdkId && typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)) return value
 if (typeof value === 'string') return sanitizeSensitiveText(value)
 if (value == null || typeof value !== 'object') return value
 if (depth > 20 || seen.has(value)) return '[OMITTED]'
 seen.add(value)
 if (value instanceof Error) return {name:value.name,message:sanitizeSensitiveText(value.message),stack:sanitizeSensitiveText(value.stack || '')}
 if (Array.isArray(value)) return value.slice(0,1000).map((v,index) => sanitizeSensitiveData(v,depth+1,seen,[...path,String(index)],sdk))
 const result = Object.create(null)
 for (const key of Object.keys(value)) {
  const safeKey = sanitizeSensitiveText(key)
  result[safeKey] = sensitiveKey.test(key) ? '[REDACTED]' : sanitizeSensitiveData(value[key],depth+1,seen,[...path,key],sdk)
 }
 return result
}
// An unreadable/corrupt payload must never bypass filtering.
export function sanitizeTelemetryEvent(value) {
 try { return sanitizeSensitiveData(value) } catch { return null }
}

export function sanitizeSentryEvent(value) {
 try { return sanitizeSensitiveData(value,0,new WeakSet(),[],true) } catch { return null }
}
