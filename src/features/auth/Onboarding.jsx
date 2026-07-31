import { useState } from 'react'
import { Building2, Loader2, LogOut, ShieldCheck } from 'lucide-react'
import { cx, Button, Field, Input } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'

// Онбординг: вошёл, но компании ещё нет.
//  - inviteError: показываем ошибку инвайта, чтобы приглашённый сотрудник
//    случайно не создал СВОЮ компанию (это была основная жалоба: сотрудник
//    заходил через регистрацию, попадал в форму «Создать компанию» и жал
//    OK — становился владельцем).
//  - без ошибки: обычная форма создания.
export default function Onboarding() {
  const createCompany = useStore((s) => s.createCompany)
  const cloudLogout = useStore((s) => s.cloudLogout)
  const inviteError = useStore((s) => s.inviteError)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!name.trim()) return setErr('Введите название компании')
    setBusy(true)
    setErr('')
    const r = await createCompany(name.trim())
    if (!r.ok) {
      setErr(r.error)
      setBusy(false)
    }
  }

  if (inviteError) {
    return (
      <div className="min-h-screen grid place-items-center bg-bg p-5">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-7">
            <div className="h-14 w-14 rounded-2xl bg-warn-soft text-warn grid place-items-center mb-3">
              <ShieldCheck size={28} strokeWidth={2.2} />
            </div>
            <div className="text-xl font-semibold tracking-tight text-center">
              Приглашение не найдено
            </div>
          </div>
          <div className="card p-5 space-y-3 text-[13px]">
            <p>{inviteError}</p>
            <p className="text-muted leading-relaxed">
              Попросите администратора выслать вам новую ссылку из раздела «Сотрудники → Пригласить».
              Регистрация по email работает только если он вас уже пригласил — иначе создастся
              новая отдельная компания вместо присоединения к существующей.
            </p>
            <button
              onClick={cloudLogout}
              className="w-full h-10 flex items-center justify-center gap-2 text-[13px] text-muted hover:text-ink border border-line rounded-lg"
            >
              <LogOut size={14} /> Выйти и войти под другим email
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg p-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-7">
          <div className="h-14 w-14 rounded-2xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30 mb-3">
            <Building2 size={28} strokeWidth={2.2} />
          </div>
          <div className="text-xl font-semibold tracking-tight">Создайте компанию</div>
          <div className="text-[12px] text-muted mt-1 text-center max-w-xs">
            Это ваше рабочее пространство — данные будут видны только вашим сотрудникам.
          </div>
        </div>

        <form onSubmit={submit} className="card p-5 animate-fadeUp">
          <Field label="Название компании">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Напр. «СтройОпт» или ИП Иванов"
              autoFocus
            />
          </Field>
          {err && <div className="text-[13px] text-bad mt-3">{err}</div>}
          <Button type="submit" disabled={busy} icon={busy ? Loader2 : Building2} className={cx('w-full mt-4', busy && '[&>svg]:animate-spin')}>
            {busy ? 'Создаём…' : 'Создать и начать'}
          </Button>
          <button
            type="button"
            onClick={cloudLogout}
            className="w-full mt-2 h-9 flex items-center justify-center gap-2 text-[13px] text-muted hover:text-ink"
          >
            <LogOut size={14} /> Выйти
          </button>
        </form>
      </div>
    </div>
  )
}
