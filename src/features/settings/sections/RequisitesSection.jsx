import { Building2 } from 'lucide-react'
import { Section, Field, Input, Select } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'

// Реквизиты компании — подставляются в печатные формы «Счёт на оплату»,
// ТОРГ-12 и УПД (см. shared/lib/print/templates). Все поля необязательны.
const FIELDS = [
  ['name', 'Полное наименование', 'ООО «СкладПро»'],
  ['inn', 'ИНН', '1650000000'],
  ['kpp', 'КПП', '165001001'],
  ['ogrn', 'ОГРН / ОГРНИП', '1021600000000'],
  ['address', 'Юридический адрес', 'г. Казань, ул. …'],
  ['city', 'Город составления', 'Казань'],
  ['phone', 'Телефон', '+7 843 000-00-00'],
  ['email', 'E-mail', 'info@company.ru'],
  ['bank', 'Банк', 'ПАО Сбербанк'],
  ['bik', 'БИК', '049205603'],
  ['account', 'Расчётный счёт', '40702810…'],
  ['corrAccount', 'Корр. счёт', '30101810…'],
  ['director', 'Руководитель', 'Иванов И. И.'],
  ['accountant', 'Бухгалтер', 'Петрова П. П.'],
]

export default function RequisitesSection() {
  const { settings, updateSettings } = useStore()
  const r = settings.requisites || {}
  const setR = (k, v) => updateSettings({ requisites: { ...r, [k]: v } })

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Building2 size={16} className="text-brand" /> Реквизиты для счёта
        </span>
      }
      subtitle="Подставляются в печатную форму «Счёт на оплату». Все поля необязательны."
    >
      <div className="grid sm:grid-cols-2 gap-4">
        {FIELDS.map(([k, label, ph]) => (
          <Field key={k} label={label}>
            <Input value={r[k] || ''} onChange={(e) => setR(k, e.target.value)} placeholder={ph} />
          </Field>
        ))}
        <Field label="Ставка НДС">
          <Select
            value={String(r.vatRate ?? 20)}
            onChange={(e) => setR('vatRate', Number(e.target.value))}
          >
            <option value="20">20%</option>
            <option value="10">10%</option>
            <option value="0">Без НДС</option>
          </Select>
        </Field>
      </div>
    </Section>
  )
}
