import { useEffect, useState } from 'react'
import { Construction } from 'lucide-react'
import { useStore } from '@/shared/store/useStore'
import { API_URL } from '@/shared/api'

const DEFAULTS = {
  storefront: { enabled: true, message: '' },
  invoices:   { enabled: true, message: '' },
  analytics:  { enabled: true, message: '' },
  assistant:  { enabled: true, message: '' },
}

export const GATE_LABELS = {
  storefront: 'Интернет-витрина',
  invoices:   'Накладные (ИИ)',
  analytics:  'Отчёты (ИИ)',
  assistant:  'ИИ-ассистент',
}

const SERVER_KEY_MAP = {
  storefront: { gate: 'gateStorefront', msg: 'gateStorefrontMsg' },
  invoices:   { gate: 'gateInvoices',   msg: 'gateInvoicesMsg' },
  analytics:  { gate: 'gateAnalytics',  msg: 'gateAnalyticsMsg' },
  assistant:  { gate: 'gateAssistant',  msg: 'gateAssistantMsg' },
}

let _serverConfig = null
let _serverConfigPromise = null

function fetchServerConfig() {
  if (_serverConfig) return Promise.resolve(_serverConfig)
  if (_serverConfigPromise) return _serverConfigPromise
  if (!API_URL) return Promise.resolve(null)
  _serverConfigPromise = fetch(`${API_URL}/v1/public/config`)
    .then(r => r.ok ? r.json() : null)
    .then(cfg => { _serverConfig = cfg; return cfg })
    .catch(() => null)
  return _serverConfigPromise
}

export function gateFor(settings, key) {
  return settings?.featureGates?.[key] ?? DEFAULTS[key] ?? { enabled: true, message: '' }
}

export default function FeatureGate({ feature, children }) {
  const settings = useStore((s) => s.settings)
  const localGate = gateFor(settings, feature)
  const [serverBlocked, setServerBlocked] = useState(null)

  useEffect(() => {
    fetchServerConfig().then(cfg => {
      if (!cfg) return
      const keys = SERVER_KEY_MAP[feature]
      if (keys && cfg[keys.gate]) {
        setServerBlocked(cfg[keys.msg] || '')
      }
    })
  }, [feature])

  if (serverBlocked !== null) {
    return (
      <div className="grid place-items-center py-24 text-center animate-fadeUp">
        <div>
          <div className="h-16 w-16 rounded-2xl bg-warn-soft text-warn grid place-items-center mx-auto mb-4">
            <Construction size={30} />
          </div>
          <h2 className="text-lg font-semibold">Раздел недоступен</h2>
          <p className="text-sm text-muted mt-2 max-w-sm mx-auto whitespace-pre-line">
            {serverBlocked || 'Этот раздел временно отключён.'}
          </p>
        </div>
      </div>
    )
  }

  if (!localGate.enabled) {
    return (
      <div className="grid place-items-center py-24 text-center animate-fadeUp">
        <div>
          <div className="h-16 w-16 rounded-2xl bg-warn-soft text-warn grid place-items-center mx-auto mb-4">
            <Construction size={30} />
          </div>
          <h2 className="text-lg font-semibold">Раздел недоступен</h2>
          <p className="text-sm text-muted mt-2 max-w-sm mx-auto whitespace-pre-line">
            {localGate.message || 'Этот раздел временно отключён администратором.'}
          </p>
        </div>
      </div>
    )
  }

  return children
}
