import { Construction } from 'lucide-react'
import { useStore } from '@/shared/store/useStore'

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

export function gateFor(settings, key) {
  return settings?.featureGates?.[key] ?? DEFAULTS[key] ?? { enabled: true, message: '' }
}

export default function FeatureGate({ feature, children }) {
  const settings = useStore((s) => s.settings)
  const gate = gateFor(settings, feature)

  if (gate.enabled) return children

  return (
    <div className="grid place-items-center py-24 text-center animate-fadeUp">
      <div>
        <div className="h-16 w-16 rounded-2xl bg-warn-soft text-warn grid place-items-center mx-auto mb-4">
          <Construction size={30} />
        </div>
        <h2 className="text-lg font-semibold">Раздел недоступен</h2>
        <p className="text-sm text-muted mt-2 max-w-sm mx-auto whitespace-pre-line">
          {gate.message || 'Этот раздел временно отключён администратором.'}
        </p>
      </div>
    </div>
  )
}
