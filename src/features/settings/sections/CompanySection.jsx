import { useState } from 'react'
import { Building2, Check, Smartphone } from 'lucide-react'
import { Section, Field, Input, Select, Badge, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'

// Первый блок «Организация» — название компании и валюта. Валюта пробрасывается
// в money() через currency-подписку в App.jsx (см. useStore((s) => s.settings?.currency)).
export function CompanySection() {
  const { settings, updateSettings } = useStore()
  const [saved, setSaved] = useState(false)
  const set = (k, v) => updateSettings({ [k]: v })
  const flash = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Building2 size={16} className="text-brand" /> Организация
        </span>
      }
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Название компании">
          <Input value={settings.company} onChange={(e) => set('company', e.target.value)} onBlur={flash} />
        </Field>
        <Field label="Валюта">
          <Select value={settings.currency} onChange={(e) => set('currency', e.target.value)}>
            <option value="₽">₽ — Рубль</option>
            <option value="₸">₸ — Тенге</option>
            <option value="$">$ — Доллар</option>
            <option value="сум">сум — Сум</option>
          </Select>
        </Field>
      </div>
      {saved && (
        <Badge tone="ok" className="mt-3">
          <Check size={12} /> Сохранено
        </Badge>
      )}
    </Section>
  )
}

// Дорожная карта — статичный чек-лист «что готово / что дальше».
// Вынесен в отдельный компонент чтобы не путать с реальными настройками.
const ROADMAP_ITEMS = [
  ['Веб-версия', 'React + Vite, работает оффлайн', true],
  ['Облачный бэкенд', 'Собственный self-hosted Fastify + PostgreSQL', true],
  ['PWA', 'Установка на телефон, офлайн-режим, сканер камерой', false],
  ['Мобильное приложение', 'React Native: сборщик с маршрутом в кармане, сканер ТСД', false],
]

export function RoadmapSection() {
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Smartphone size={16} className="text-brand" /> Что дальше
        </span>
      }
    >
      <div className="space-y-2.5 text-sm">
        {ROADMAP_ITEMS.map(([t, d, done]) => (
          <div key={t} className="flex items-center gap-3">
            <span
              className={cx(
                'h-6 w-6 rounded-full grid place-items-center shrink-0 text-[11px]',
                done ? 'bg-ok text-white' : 'bg-surface-3 text-muted',
              )}
            >
              {done ? <Check size={13} /> : '•'}
            </span>
            <div>
              <span className="font-medium">{t}</span>
              <span className="text-muted"> — {d}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
