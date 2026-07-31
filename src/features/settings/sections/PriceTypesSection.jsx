import { useState } from 'react'
import { Tags, Plus, Star, Trash2 } from 'lucide-react'
import { Section, Button, Input, cx } from '@/shared/ui'
import { useConfirm } from '@/shared/components/Confirm'
import { useStore } from '@/shared/store/useStore'

// Категории цен (опт / в долг / на месте / …). В заказе выбирается категория —
// цены пересчитываются. Один тип помечен как «по умолчанию» (нельзя удалить
// пока он такой; сначала пометить другой).
export default function PriceTypesSection() {
  const { priceTypes, addPriceType, updatePriceType, removePriceType, setDefaultPriceType } = useStore()
  const confirm = useConfirm()
  const [name, setName] = useState('')

  const askRemove = async (t) => {
    const ok = await confirm({
      title: `Удалить тип цены «${t.name}»?`,
      body: 'У товаров, где для этого типа задана цена, значение перестанет отображаться. Восстановить нельзя.',
      tone: 'danger',
      okLabel: 'Удалить',
    })
    if (ok) removePriceType(t.id)
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Tags size={16} className="text-brand" /> Категории цен
        </span>
      }
      subtitle="Типы цен (опт, в долг, на месте…). В заказе выбираете категорию — цены пересчитываются."
    >
      <div className="space-y-2">
        {priceTypes.map((t) => (
          <div key={t.id} className="flex items-center gap-2 p-2 rounded-xl bg-surface-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color }} />
            <input
              value={t.name}
              onChange={(e) => updatePriceType(t.id, { name: e.target.value })}
              className="flex-1 min-w-0 bg-transparent text-sm font-medium outline-none"
            />
            <button
              onClick={() => setDefaultPriceType(t.id)}
              title="Сделать по умолчанию"
              className={cx(
                'h-8 px-2 rounded-lg flex items-center gap-1 text-[12px] shrink-0',
                t.default ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-3',
              )}
            >
              <Star size={13} className={t.default ? 'fill-current' : ''} />
              {t.default ? 'по умолч.' : ''}
            </button>
            {!t.default && (
              <button
                onClick={() => askRemove(t)}
                className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-bad shrink-0"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Новая категория, напр. «Опт от 100к»"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              addPriceType({ name: name.trim() })
              setName('')
            }
          }}
        />
        <Button
          icon={Plus}
          disabled={!name.trim()}
          onClick={() => {
            addPriceType({ name: name.trim() })
            setName('')
          }}
        >
          Добавить
        </Button>
      </div>
    </Section>
  )
}
