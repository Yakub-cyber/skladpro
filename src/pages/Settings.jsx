import { useState } from 'react'
import {
  Building2,
  Sparkles,
  Palette,
  Database,
  Download,
  RotateCcw,
  Sun,
  Moon,
  Check,
  Smartphone,
  KeyRound,
  Tags,
  Plus,
  Trash2,
  Star,
  Loader2,
} from 'lucide-react'
import { Section, Button, Field, Input, Select, Badge, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { askLLM } from '../lib/ai'

export default function Settings() {
  const { settings, updateSettings, resetDemo } = useStore()
  const [saved, setSaved] = useState(false)
  const [aiTest, setAiTest] = useState(null) // null | 'loading' | {ok, msg}

  const testAI = async () => {
    if (!settings.aiKey) {
      setAiTest({ ok: false, msg: 'Сначала введите API-ключ' })
      return
    }
    setAiTest('loading')
    try {
      const r = await askLLM('Ответь одним словом по-русски: работает?', {
        apiKey: settings.aiKey,
        model: settings.aiModel,
      })
      setAiTest({ ok: true, msg: (r || 'OK').trim().slice(0, 80) })
    } catch (e) {
      setAiTest({ ok: false, msg: String(e.message || e).slice(0, 90) })
    }
  }
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  )

  const set = (k, v) => updateSettings({ [k]: v })
  const flash = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle('dark')
    localStorage.setItem('sklad.theme', isDark ? 'dark' : 'light')
    setDark(isDark)
  }

  const exportData = () => {
    const data = localStorage.getItem('sklad.db') || '{}'
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `skladpro-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reset = () => {
    if (confirm('Сбросить все данные и вернуть демо-набор? Текущие изменения будут удалены.')) {
      resetDemo()
    }
  }

  return (
    <div className="animate-fadeUp max-w-3xl space-y-5">
      <h2 className="text-xl font-semibold tracking-tight">Настройки</h2>

      {/* Компания */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Building2 size={16} className="text-brand" /> Организация
          </span>
        }
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Название компании">
            <Input
              value={settings.company}
              onChange={(e) => set('company', e.target.value)}
              onBlur={flash}
            />
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

      <PriceTypesSection />

      {/* ИИ */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand" /> Искусственный интеллект
          </span>
        }
        subtitle="Накладные из текста и аналитика работают локально. Ключ нужен только для облачного режима (сложный «грязный» текст)."
      >
        <div className="grid sm:grid-cols-[1fr_200px] gap-4">
          <Field label="API-ключ DeepSeek / OpenRouter" hint="Хранится только в этом браузере">
            <div className="relative">
              <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input
                type="password"
                value={settings.aiKey}
                onChange={(e) => set('aiKey', e.target.value)}
                placeholder="sk-..."
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Модель">
            <Select value={settings.aiModel} onChange={(e) => set('aiModel', e.target.value)}>
              <option value="deepseek-chat">deepseek-chat</option>
              <option value="deepseek-reasoner">deepseek-reasoner</option>
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <span className={cx('w-2 h-2 rounded-full', settings.aiKey ? 'bg-ok' : 'bg-warn')} />
            {settings.aiKey
              ? 'Облачный режим доступен'
              : 'Локальный режим (оффлайн) — без ключа, мгновенно'}
          </span>
          <Button
            size="sm"
            variant="soft"
            onClick={testAI}
            disabled={aiTest === 'loading'}
            icon={aiTest === 'loading' ? Loader2 : Sparkles}
            className={aiTest === 'loading' ? '[&>svg]:animate-spin' : ''}
          >
            Проверить подключение
          </Button>
          {aiTest && aiTest !== 'loading' && (
            <Badge tone={aiTest.ok ? 'ok' : 'bad'}>
              {aiTest.ok ? <Check size={12} /> : '×'} {aiTest.ok ? `Ответ: «${aiTest.msg}»` : aiTest.msg}
            </Badge>
          )}
        </div>
      </Section>

      {/* Внешний вид */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Palette size={16} className="text-brand" /> Внешний вид
          </span>
        }
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">Тема оформления</div>
            <div className="text-[13px] text-muted">Тёмная или светлая</div>
          </div>
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 h-10 px-4 rounded-xl bg-surface-2 hover:bg-surface-3 text-sm font-medium"
          >
            {dark ? <Moon size={16} /> : <Sun size={16} />}
            {dark ? 'Тёмная' : 'Светлая'}
          </button>
        </div>
      </Section>

      {/* Данные */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Database size={16} className="text-brand" /> Данные
          </span>
        }
        subtitle="Сейчас данные хранятся в браузере (localStorage). Слой данных готов к подключению реального API."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" icon={Download} onClick={exportData}>
            Экспорт в JSON
          </Button>
          <Button variant="ghost" icon={RotateCcw} className="text-bad" onClick={reset}>
            Сбросить к демо
          </Button>
        </div>
      </Section>

      {/* Дорожная карта */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Smartphone size={16} className="text-brand" /> Что дальше
          </span>
        }
      >
        <div className="space-y-2.5 text-sm">
          {[
            ['Веб-версия (сейчас)', 'React + Vite, работает оффлайн', true],
            ['Реальный бэкенд', 'Supabase/Node — общий API для веба и мобайла', false],
            ['Мобильное приложение', 'React Native: сборщик с маршрутом в кармане, сканер штрихкодов', false],
          ].map(([t, d, done]) => (
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

      <p className="text-center text-[12px] text-muted py-2">
        СкладПро · прототип складской системы с ИИ
      </p>
    </div>
  )
}

function PriceTypesSection() {
  const { priceTypes, addPriceType, updatePriceType, removePriceType, setDefaultPriceType } =
    useStore()
  const [name, setName] = useState('')

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
                onClick={() => removePriceType(t.id)}
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
