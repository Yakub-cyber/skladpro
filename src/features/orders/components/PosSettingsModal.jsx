import { useState } from 'react'
import { Check, Settings2, Printer } from 'lucide-react'
import { Modal, Button, Field, Select } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { DEFAULT_POS } from '@/features/orders/pos'

// Настройки кассового оборудования. Живут в settings.pos, поэтому
// применяются на всех рабочих местах компании. Хранит: автопечать,
// ширину чековой ленты, звук сканера и режим сканера.
export default function PosSettingsModal({ onClose }) {
  const settings = useStore((s) => s.settings) || {}
  const updateSettings = useStore((s) => s.updateSettings)
  const cur = settings.pos || DEFAULT_POS
  const [f, setF] = useState(cur)

  const patch = (k, v) => setF((s) => ({ ...s, [k]: v }))

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Settings2 size={18} className="text-brand" /> Оборудование кассы
        </span>
      }
    >
      <div className="space-y-3">
        <Field
          label="Принтер чеков"
          hint="Печать открывается в отдельном окне браузера — выберите там свой термопринтер."
        >
          <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-2 border border-line cursor-pointer">
            <input
              type="checkbox"
              checked={!!f.autoPrint}
              onChange={(e) => patch('autoPrint', e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            <Printer size={16} className="text-muted" />
            <span className="text-[13px]">Печатать чек сразу после оплаты</span>
          </label>
        </Field>

        <Field label="Ширина чековой ленты">
          <Select
            value={String(f.receiptWidth)}
            onChange={(e) => patch('receiptWidth', Number(e.target.value))}
          >
            <option value="58">58 мм — компактный принтер</option>
            <option value="80">80 мм — стандартный</option>
          </Select>
        </Field>

        <Field
          label="Сканер штрихкодов"
          hint="USB-сканер работает как клавиатура — просто наведите фокус на поле поиска и сканируйте. Камера — резервный вариант для планшета."
        >
          <Select value={f.scanMode} onChange={(e) => patch('scanMode', e.target.value)}>
            <option value="keyboard">USB-сканер (клавиатурный ввод)</option>
            <option value="camera">Камера устройства</option>
          </Select>
        </Field>

        <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-2 border border-line cursor-pointer">
          <input
            type="checkbox"
            checked={!!f.scanSound}
            onChange={(e) => patch('scanSound', e.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          <span className="text-[13px]">Звуковой сигнал при сканировании</span>
        </label>

        <div className="flex gap-2 pt-1">
          <Button
            icon={Check}
            className="flex-1"
            onClick={() => {
              updateSettings({ pos: f })
              onClose()
            }}
          >
            Сохранить
          </Button>
          <Button variant="soft" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  )
}
