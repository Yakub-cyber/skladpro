const MAX = 200

const ring = []

export function pushEvent(type, data) {
  const event = {
    ts: new Date().toISOString(),
    type,
    traceId: data?.traceId || null,
    ...data,
  }
  if (ring.length >= MAX) ring.shift()
  ring.push(event)
  return event
}

export function getEvents() {
  return ring.slice()
}

export function getLastError() {
  for (let i = ring.length - 1; i >= 0; i--) {
    if (ring[i].type.endsWith('_error') || ring[i].type === 'sync_op_fail') return ring[i]
  }
  return null
}

export function buildDiagText(extra = {}) {
  const lines = [
    `SkladPro Web Diagnostics`,
    `time: ${new Date().toISOString()}`,
  ]
  if (extra.version) lines.push(`version: ${extra.version}`)
  if (extra.companyId) lines.push(`company: ${extra.companyId}`)
  if (extra.queuePending != null) lines.push(`queue_pending: ${extra.queuePending}`)
  if (extra.queueState) lines.push(`queue_state: ${extra.queueState}`)
  if (extra.lastSync) lines.push(`last_sync: ${extra.lastSync}`)
  lines.push('')
  const recent = ring.slice(-30)
  if (recent.length) {
    lines.push(`--- last ${recent.length} events ---`)
    for (const e of recent) {
      const { ts, type, traceId, ...rest } = e
      const tid = traceId ? ` [${traceId.slice(0, 8)}]` : ''
      const detail = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''
      lines.push(`${ts} ${type}${tid}${detail}`)
    }
  }
  return lines.join('\n')
}
