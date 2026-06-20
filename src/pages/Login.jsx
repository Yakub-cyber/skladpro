import { useEffect, useState } from 'react'
import { Boxes, Delete, ArrowLeft, Lock, ShieldCheck } from 'lucide-react'
import { Avatar, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { roleInfo } from '../lib/constants'

export default function Login() {
  const employees = (useStore((s) => s.employees) || []).filter((e) => e.active)
  const login = useStore((s) => s.login)
  const [sel, setSel] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  const me = employees.find((e) => e.id === sel)

  // авто-проверка при вводе 4 цифр
  useEffect(() => {
    if (sel && pin.length === 4) {
      const res = login(sel, pin)
      if (!res.ok) {
        setError(res.error)
        setShake(true)
        setTimeout(() => {
          setPin('')
          setShake(false)
        }, 500)
      }
      // при успехе AuthGate сам отрисует приложение
    }
  }, [pin, sel, login])

  const press = (d) => {
    setError('')
    setPin((p) => (p.length < 4 ? p + d : p))
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg p-5">
      <div className="w-full max-w-sm">
        {/* Лого */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30 mb-3">
            <Boxes size={30} strokeWidth={2.2} />
          </div>
          <div className="text-xl font-semibold tracking-tight">
            Склад<span className="text-brand">Про</span>
          </div>
          <div className="text-[12px] text-muted mt-1">Вход в систему</div>
        </div>

        {!sel ? (
          /* Выбор сотрудника */
          <div className="card p-4 animate-fadeUp">
            <div className="text-[13px] text-muted mb-3 px-1">Выберите сотрудника</div>
            <div className="space-y-2">
              {employees.map((e) => {
                const r = roleInfo(e.role)
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      setSel(e.id)
                      setPin('')
                      setError('')
                    }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-line hover:border-brand/50 hover:bg-surface-2 transition text-left"
                  >
                    <Avatar name={e.name} color={r.color} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{e.name}</div>
                      <div className="text-[12px] text-muted">{r.label}</div>
                    </div>
                    <Lock size={15} className="text-muted" />
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          /* Ввод PIN */
          <div className={cx('card p-5 animate-fadeUp', shake && 'animate-shake')}>
            <button
              onClick={() => {
                setSel(null)
                setPin('')
                setError('')
              }}
              className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink mb-4"
            >
              <ArrowLeft size={15} /> Сменить сотрудника
            </button>

            <div className="flex flex-col items-center mb-5">
              <Avatar name={me.name} color={roleInfo(me.role).color} size={52} />
              <div className="font-medium mt-2">{me.name}</div>
              <div className="text-[12px] text-muted">{roleInfo(me.role).label}</div>
            </div>

            {/* индикатор PIN */}
            <div className="flex justify-center gap-3 mb-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={cx(
                    'w-3.5 h-3.5 rounded-full border-2 transition',
                    i < pin.length
                      ? 'bg-brand border-brand'
                      : error
                        ? 'border-bad'
                        : 'border-line',
                  )}
                />
              ))}
            </div>
            <div className="h-5 text-center text-[12px] text-bad mb-2">{error}</div>

            {/* клавиатура */}
            <div className="grid grid-cols-3 gap-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <PadBtn key={n} onClick={() => press(String(n))}>
                  {n}
                </PadBtn>
              ))}
              <div />
              <PadBtn onClick={() => press('0')}>0</PadBtn>
              <PadBtn onClick={() => setPin((p) => p.slice(0, -1))} className="text-muted">
                <Delete size={20} />
              </PadBtn>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-muted">
          <ShieldCheck size={13} /> Демо-PIN: 1111 · 2222 · 3333 · 4444
        </div>
      </div>
    </div>
  )
}

function PadBtn({ children, onClick, className }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'h-14 rounded-xl bg-surface-2 hover:bg-surface-3 active:scale-95 text-xl font-medium grid place-items-center transition',
        className,
      )}
    >
      {children}
    </button>
  )
}
