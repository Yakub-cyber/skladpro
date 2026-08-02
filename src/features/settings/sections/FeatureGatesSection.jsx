import { ShieldAlert, ToggleLeft, ToggleRight } from 'lucide-react'
import { Section, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { GATE_LABELS, gateFor } from '@/shared/components/FeatureGate'

const GATE_KEYS = ['storefront', 'invoices', 'analytics', 'assistant']

export default function FeatureGatesSection() {
  const { settings, updateSettings } = useStore()

  const toggle = (key) => {
    const cur = gateFor(settings, key)
    updateSettings({
      featureGates: {
        ...settings.featureGates,
        [key]: { ...cur, enabled: !cur.enabled },
      },
    })
  }

  const setMessage = (key, message) => {
    const cur = gateFor(settings, key)
    updateSettings({
      featureGates: {
        ...settings.featureGates,
        [key]: { ...cur, message },
      },
    })
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-warn" /> Управление доступом к разделам
        </span>
      }
      subtitle="Отключите раздел — пользователи увидят ваше сообщение вместо содержимого."
    >
      <div className="space-y-3">
        {GATE_KEYS.map((key) => {
          const gate = gateFor(settings, key)
          return (
            <div key={key} className="rounded-xl bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{GATE_LABELS[key]}</span>
                <button
                  onClick={() => toggle(key)}
                  className="text-2xl transition-colors hover:opacity-80"
                  title={gate.enabled ? 'Включено — нажмите чтобы отключить' : 'Отключено — нажмите чтобы включить'}
                >
                  {gate.enabled
                    ? <ToggleRight size={32} className="text-ok" />
                    : <ToggleLeft size={32} className="text-muted" />}
                </button>
              </div>
              {!gate.enabled && (
                <textarea
                  value={gate.message}
                  onChange={(e) => setMessage(key, e.target.value)}
                  placeholder="Сообщение для пользователей (например: «В разработке, скоро будет доступно»)"
                  rows={2}
                  className={cx(
                    'mt-2 w-full px-3 py-2 rounded-lg bg-bg border border-line text-sm text-ink',
                    'placeholder:text-muted/60 outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 transition resize-y',
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}
