import { useState } from 'react'
import { Building2, Check } from 'lucide-react'
import { Button, Field, Input, Modal, Select } from '@/shared/ui'

export default function AccountModal({ onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('cash')

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Building2 size={18} className="text-brand" /> Новый счёт
        </span>
      }
    >
      <div className="space-y-3">
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, «Касса магазина №2»"
            autoFocus
          />
        </Field>
        <Field label="Тип">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="cash">Касса (наличные)</option>
            <option value="bank">Расчётный счёт</option>
          </Select>
        </Field>
        <div className="flex gap-2 pt-1">
          <Button
            icon={Check}
            className="flex-1"
            disabled={!name.trim()}
            onClick={() => {
              onSubmit({ name: name.trim(), kind })
              onClose()
            }}
          >
            Создать
          </Button>
          <Button variant="soft" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  )
}
