import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button, Field, Input, Modal, Select } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { ROLES } from '@/shared/lib/constants'

export default function AddEmployeeModal({ open, onClose }) {
  const addEmployee = useStore((s) => s.addEmployee)
  const [f, setF] = useState({ name: '', phone: '', role: 'stock', pin: '' })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const valid = f.name && /^\d{4}$/.test(f.pin)
  const save = () => {
    if (!valid) return
    addEmployee(f)
    setF({ name: '', phone: '', role: 'stock', pin: '' })
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый сотрудник"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={!valid} icon={Check}>Добавить</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Имя">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="ФИО" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Телефон">
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+7" />
          </Field>
          <Field label="Роль">
            <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="PIN для входа" hint="4 цифры — сотрудник будет вводить их при входе">
          <Input
            value={f.pin}
            onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="0000"
            inputMode="numeric"
          />
        </Field>
      </div>
    </Modal>
  )
}
