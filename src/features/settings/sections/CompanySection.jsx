import { useState } from 'react'
import { Building2, Check } from 'lucide-react'
import { Section, Field, Input, Select, Badge } from '@/shared/ui'
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

