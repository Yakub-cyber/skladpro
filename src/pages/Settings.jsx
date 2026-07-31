import { useEffect, useState } from 'react'
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
  Webhook,
  Copy,
  ShieldAlert,
  FileDown,
  UserX,
  AlertTriangle,
} from 'lucide-react'
import { Section, Button, Field, Input, Select, Badge, cx } from '@/shared/ui'
import { useConfirm } from '@/shared/components/Confirm'
import { useStore } from '@/shared/store/useStore'
import { askLLM, aiConfig, aiEnabled, AI_MODELS, ENV_AI_KEY } from '@/shared/lib/ai'
import { changePassword } from '@/shared/lib/cloud'
import {
  hasApi,
  apiListApiKeys,
  apiCreateApiKey,
  apiRevokeApiKey,
  apiListWebhooks,
  apiCreateWebhook,
  apiUpdateWebhook,
  apiDeleteWebhook,
  apiCreateExport,
  apiGetExportStatus,
  apiDeleteAccount,
  apiCancelDeleteAccount,
} from '@/shared/api'

export default function Settings() {
  const { settings, updateSettings, resetDemo, cloud, companyName } = useStore()
  const confirm = useConfirm()
  const [saved, setSaved] = useState(false)
  const [aiTest, setAiTest] = useState(null) // null | 'loading' | {ok, msg}

  const testAI = async () => {
    if (!aiEnabled(settings)) {
      setAiTest({ ok: false, msg: 'Сначала введите API-ключ' })
      return
    }
    setAiTest('loading')
    try {
      const r = await askLLM('Ответь одним словом по-русски: работает?', aiConfig(settings))
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
    // F1-7: маскируем секреты перед выгрузкой. Раньше `webhooks[].secret`
    // (whsec_…), `aiKey` (ProxyAPI) и полные `apiKeys` уходили в файл —
    // экспорт превращался в утечку. `apiKeys` теперь без key-preview
    // хранят только keyPreview, поэтому уже безопасны, а вот webhook-secret
    // и aiKey — заменяем на маркер `***`.
    let payload = localStorage.getItem('sklad.db') || '{}'
    try {
      const parsed = JSON.parse(payload)
      if (parsed?.state?.settings) {
        const s = parsed.state.settings
        if (s.aiKey) s.aiKey = '***'
        if (Array.isArray(s.webhooks)) {
          s.webhooks = s.webhooks.map((w) => ({ ...w, secret: '***' }))
        }
      }
      payload = JSON.stringify(parsed, null, 2)
    } catch {
      // если parse не удался — отдаём как есть, лучше файл с секретом,
      // чем потерянный бэкап (кейс edge)
    }
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `skladpro-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reset = async () => {
    const ok = await confirm({
      title: 'Сбросить все данные?',
      body: 'Текущие товары, заказы, клиенты, документы и настройки будут стёрты. Вернётся демо-набор.',
      details: 'Действие безвозвратно. Сделайте бэкап через «Скачать резервную копию», если он вам ещё пригодится.',
      tone: 'danger',
      okLabel: 'Сбросить',
      requireInput: 'СБРОСИТЬ',
    })
    if (ok) resetDemo()
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

      <RequisitesSection />

      <PriceTypesSection />

      {cloud && <PasswordSection companyName={companyName} />}

      {/* ИИ */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand" /> Искусственный интеллект
          </span>
        }
        subtitle="Разбор накладных и аналитика работают локально без ключа. Ключ включает облачный режим — реальный ИИ (OpenAI) через ProxyAPI из РФ."
      >
        <div className="grid sm:grid-cols-[1fr_200px] gap-4">
          <Field label="API-ключ ProxyAPI" hint={ENV_AI_KEY ? 'Ключ задан в .env — можно оставить поле пустым' : 'Хранится только в этом браузере, в код не попадает'}>
            <div className="relative">
              <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input
                type="password"
                value={settings.aiKey}
                onChange={(e) => set('aiKey', e.target.value)}
                placeholder={ENV_AI_KEY ? 'использую ключ из .env' : 'sk-...'}
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Модель">
            <Select value={settings.aiModel} onChange={(e) => set('aiModel', e.target.value)}>
              {AI_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Endpoint (API URL)"
          hint="ProxyAPI для OpenAI. Можно указать свой прокси/провайдера."
          className="mt-3"
        >
          <Input
            value={settings.aiBaseUrl || ''}
            onChange={(e) => set('aiBaseUrl', e.target.value)}
            placeholder="https://api.proxyapi.ru/openai/v1"
          />
        </Field>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <span className={cx('w-2 h-2 rounded-full', aiEnabled(settings) ? 'bg-ok' : 'bg-warn')} />
            {aiEnabled(settings)
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
        subtitle={
          cloud
            ? 'Данные синхронизируются с облаком (Supabase) между устройствами. Локальная копия — офлайн-кэш и быстрый доступ.'
            : 'Данные хранятся в браузере (localStorage). Задайте ключи Supabase в .env, чтобы включить облачную синхронизацию.'
        }
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

      <IntegrationsSection />

      <GdprSection />

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
            ['Веб-версия', 'React + Vite, работает оффлайн', true],
            ['Облачный бэкенд', 'Supabase: мультитенант, роли, синхронизация — готово', true],
            ['PWA', 'Установка на телефон, офлайн-режим, сканер камерой', false],
            ['Мобильное приложение', 'React Native: сборщик с маршрутом в кармане, сканер ТСД', false],
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

function PasswordSection({ companyName }) {
  const [oldPass, setOldPass] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const submit = async () => {
    if (!oldPass) return setMsg({ ok: false, m: 'Введите текущий пароль' })
    if (pass.length < 8) return setMsg({ ok: false, m: 'Минимум 8 символов' })
    setBusy(true)
    // Новый бэкенд требует старый пароль для смены (защита от «зашёл на девайс — сменил»).
    const r = await changePassword(pass, oldPass)
    setBusy(false)
    setMsg(r.ok ? { ok: true, m: 'Пароль изменён — придётся войти заново на всех устройствах' } : { ok: false, m: r.error })
    if (r.ok) { setPass(''); setOldPass('') }
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <KeyRound size={16} className="text-brand" /> Безопасность · пароль
        </span>
      }
      subtitle={companyName ? `Облачный аккаунт · компания «${companyName}»` : 'Смена пароля от аккаунта'}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Текущий пароль" className="flex-1 min-w-[180px]">
          <Input type="password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </Field>
        <Field label="Новый пароль" hint="Минимум 8 символов" className="flex-1 min-w-[180px]">
          <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </Field>
        <Button onClick={submit} disabled={busy || !pass || !oldPass}>
          {busy ? 'Сохраняем…' : 'Сменить пароль'}
        </Button>
      </div>
      {msg && (
        <Badge tone={msg.ok ? 'ok' : 'bad'} className="mt-3">
          {msg.ok && <Check size={12} />} {msg.m}
        </Badge>
      )}
    </Section>
  )
}

function RequisitesSection() {
  const { settings, updateSettings } = useStore()
  const r = settings.requisites || {}
  const setR = (k, v) => updateSettings({ requisites: { ...r, [k]: v } })
  const fields = [
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
        {fields.map(([k, label, ph]) => (
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

function PriceTypesSection() {
  const { priceTypes, addPriceType, updatePriceType, removePriceType, setDefaultPriceType } =
    useStore()
  const confirm = useConfirm()
  const askRemove = async (t) => {
    const ok = await confirm({
      title: `Удалить тип цены «${t.name}»?`,
      body: 'У товаров, где для этого типа задана цена, значение перестанет отображаться. Восстановить нельзя.',
      tone: 'danger',
      okLabel: 'Удалить',
    })
    if (ok) removePriceType(t.id)
  }
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

// U1: интеграции — API-ключи и webhook-endpoints через СЕРВЕРНЫЕ эндпоинты.
// До U1 всё жило в локальном сторе и никогда не выстреливало — теперь ключи
// проходят auth-плагин по X-API-Key, webhook'и уходят на webhook-dispatcher.
// Legacy fallback (!hasApi) сохраняет старый UI на локальном сторе —
// нужен для offline-режима и тестов useStore.
const KNOWN_SCOPES = [
  { key: 'products:read', label: 'Товары — чтение' },
  { key: 'products:write', label: 'Товары — запись' },
  { key: 'customers:read', label: 'Клиенты — чтение' },
  { key: 'customers:write', label: 'Клиенты — запись' },
  { key: 'orders:read', label: 'Заказы — чтение' },
  { key: 'orders:write', label: 'Заказы — запись' },
  { key: 'documents:read', label: 'Документы — чтение' },
  { key: 'documents:write', label: 'Документы — запись' },
]
const KNOWN_EVENTS = [
  { key: 'sale.created', label: 'Продажа пробита' },
  { key: 'order.status_changed', label: 'Статус заказа изменён' },
  { key: 'return.created', label: 'Оформлен возврат' },
  { key: 'payment.created', label: 'Клиент внёс оплату' },
  { key: 'fiscal.ready', label: 'Чек ККТ готов (FN/FD/FP)' },
]

function IntegrationsSection() {
  if (!hasApi) return <IntegrationsSectionLegacy />
  return <IntegrationsSectionCloud />
}

function IntegrationsSectionCloud() {
  const [keys, setKeys] = useState([])
  const [webhooks, setWebhooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [globalErr, setGlobalErr] = useState('')
  const reload = async () => {
    setLoading(true)
    setGlobalErr('')
    const [rK, rW] = await Promise.all([apiListApiKeys(), apiListWebhooks()])
    if (rK.ok) setKeys(rK.body.keys || [])
    else if (rK.status === 402) setGlobalErr('Требуется апгрейд плана: доступ к API-ключам не входит в текущий тариф.')
    else if (rK.status === 403) setGlobalErr('Настройки интеграций доступны только админу и менеджеру.')
    else setGlobalErr(rK.body?.error?.message || 'Не удалось загрузить ключи')
    if (rW.ok) setWebhooks(rW.body.endpoints || [])
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Webhook size={16} className="text-brand" /> Интеграции (API + webhooks)
        </span>
      }
      subtitle="Для подключения сторонних сервисов (1С, маркетплейсы, CRM). Ключ проходит через X-API-Key, webhook'и получают POST с HMAC-подписью."
    >
      {globalErr && (
        <div className="mb-3 p-3 rounded-xl bg-bad-soft border border-bad/30 text-[13px] text-bad">
          {globalErr}
        </div>
      )}
      <div className="space-y-5">
        <ApiKeysSubSection
          keys={keys}
          loading={loading}
          onCreated={(k) => setKeys((prev) => [{
            id: k.id,
            name: k.name,
            prefix: k.prefix,
            keyPreview: `sk_live_${k.prefix}_${'*'.repeat(8)}...`,
            scopes: k.scopes,
            active: true,
            createdAt: k.createdAt,
          }, ...prev])}
          onRevoked={(id) => setKeys((prev) => prev.filter((x) => x.id !== id))}
        />
        <WebhooksSubSection
          webhooks={webhooks}
          loading={loading}
          onCreated={(w) => setWebhooks((prev) => [w, ...prev])}
          onChanged={(w) => setWebhooks((prev) => prev.map((x) => (x.id === w.id ? { ...x, ...w } : x)))}
          onDeleted={(id) => setWebhooks((prev) => prev.filter((x) => x.id !== id))}
        />
      </div>
    </Section>
  )
}

function ApiKeysSubSection({ keys, loading, onCreated, onRevoked }) {
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState({ 'products:read': true })
  const [freshKey, setFreshKey] = useState(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const scopeArr = Object.keys(selectedScopes).filter((k) => selectedScopes[k])
  const toggleScope = (k) => setSelectedScopes((s) => ({ ...s, [k]: !s[k] }))

  const createKey = async () => {
    setErr('')
    if (!name.trim()) return setErr('Введите название')
    if (scopeArr.length === 0) return setErr('Выберите хотя бы один scope')
    setBusy(true)
    const r = await apiCreateApiKey(name.trim(), scopeArr)
    setBusy(false)
    if (!r.ok) {
      setErr(r.body?.error?.message || 'Не удалось создать ключ')
      return
    }
    setFreshKey({ name: r.body.name, key: r.body.key })
    onCreated(r.body)
    setName('')
    setSelectedScopes({ 'products:read': true })
  }

  const revoke = async (id) => {
    const r = await apiRevokeApiKey(id)
    if (!r.ok) return
    onRevoked(id)
  }

  const copyKey = () => {
    if (!freshKey) return
    navigator.clipboard?.writeText(freshKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <div className="text-[13px] font-semibold mb-2">API-ключи</div>
      {freshKey && (
        <div className="mb-3 p-3 rounded-xl bg-warn-soft border border-warn/30">
          <div className="text-[12px] font-semibold text-warn mb-1">
            Ключ показан один раз. Сохраните его — потом не восстановить.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] font-mono px-2 py-1.5 rounded bg-surface break-all">
              {freshKey.key}
            </code>
            <Button size="sm" variant="soft" icon={Copy} onClick={copyKey}>
              {copied ? 'Скопировано' : 'Копировать'}
            </Button>
            <button
              onClick={() => setFreshKey(null)}
              className="text-muted hover:text-ink p-1"
              title="Скрыть"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div className="grid gap-2 mb-3">
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="1С обмен / amoCRM / …"
          />
        </Field>
        <div>
          <div className="text-[12px] text-muted mb-1.5">Права доступа (scopes)</div>
          <div className="flex flex-wrap gap-1.5">
            {KNOWN_SCOPES.map((s) => {
              const on = !!selectedScopes[s.key]
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleScope(s.key)}
                  className={cx(
                    'text-[12px] px-2.5 py-1 rounded-full border transition',
                    on
                      ? 'bg-brand-soft border-brand/40 text-brand'
                      : 'bg-surface-2 border-line text-muted hover:text-ink',
                  )}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={Plus} onClick={createKey} disabled={busy}>
            {busy ? 'Создаём…' : 'Создать ключ'}
          </Button>
          {err && <div className="text-[13px] text-bad">{err}</div>}
        </div>
      </div>
      {loading ? (
        <div className="text-[13px] text-muted italic flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Загружаем список…
        </div>
      ) : keys.length === 0 ? (
        <div className="text-[13px] text-muted italic">Пока нет ключей.</div>
      ) : (
        <div className="space-y-1.5">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-2"
            >
              <KeyRound size={16} className={k.active ? 'text-muted' : 'text-bad'} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">
                  {k.name}
                  {!k.active && <Badge tone="bad" className="ml-2">отозван</Badge>}
                </div>
                <div className="text-[11px] text-muted font-mono">{k.keyPreview}</div>
                <div className="text-[11px] text-muted">
                  {(k.scopes || []).join(' · ')}
                </div>
              </div>
              {k.active && (
                <button
                  onClick={() => revoke(k.id)}
                  className="text-muted hover:text-bad p-1"
                  title="Отозвать"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WebhooksSubSection({ webhooks, loading, onCreated, onChanged, onDeleted }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState({ 'sale.created': true })
  const [freshSecret, setFreshSecret] = useState(null)  // { name, secret }
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const eventArr = Object.keys(selectedEvents).filter((k) => selectedEvents[k])
  const toggleEvent = (k) => setSelectedEvents((s) => ({ ...s, [k]: !s[k] }))

  const create = async () => {
    setErr('')
    if (!name.trim()) return setErr('Введите название')
    if (!/^https?:\/\//.test(url.trim())) return setErr('URL должен начинаться с http:// или https://')
    if (eventArr.length === 0) return setErr('Выберите хотя бы одно событие')
    setBusy(true)
    const r = await apiCreateWebhook({
      name: name.trim(),
      url: url.trim(),
      events: eventArr,
      active: true,
    })
    setBusy(false)
    if (!r.ok) {
      setErr(r.body?.error?.message || 'Не удалось создать webhook')
      return
    }
    setFreshSecret({ name: r.body.name, secret: r.body.secret })
    onCreated(r.body)
    setName('')
    setUrl('')
    setSelectedEvents({ 'sale.created': true })
  }

  const toggle = async (w) => {
    const r = await apiUpdateWebhook(w.id, {
      name: w.name,
      url: w.url,
      events: w.events,
      active: !w.active,
    })
    if (r.ok) onChanged({ id: w.id, active: !w.active })
  }

  const remove = async (id) => {
    const r = await apiDeleteWebhook(id)
    if (r.ok) onDeleted(id)
  }

  const copySecret = () => {
    if (!freshSecret) return
    navigator.clipboard?.writeText(freshSecret.secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <div className="text-[13px] font-semibold mb-2">Webhook-endpoints</div>
      {freshSecret && (
        <div className="mb-3 p-3 rounded-xl bg-ok-soft border border-ok/30">
          <div className="text-[12px] font-semibold text-ok mb-1">
            Секрет для проверки HMAC-подписи (X-Skladpro-Signature).
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] font-mono px-2 py-1.5 rounded bg-surface break-all">
              {freshSecret.secret}
            </code>
            <Button size="sm" variant="soft" icon={Copy} onClick={copySecret}>
              {copied ? 'Скопировано' : 'Копировать'}
            </Button>
            <button
              onClick={() => setFreshSecret(null)}
              className="text-muted hover:text-ink p-1"
              title="Скрыть"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div className="grid gap-2 mb-3">
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Уведомить 1С" />
        </Field>
        <Field label="URL приёмника">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hook"
          />
        </Field>
        <div>
          <div className="text-[12px] text-muted mb-1.5">События</div>
          <div className="flex flex-wrap gap-1.5">
            {KNOWN_EVENTS.map((e) => {
              const on = !!selectedEvents[e.key]
              return (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => toggleEvent(e.key)}
                  className={cx(
                    'text-[12px] px-2.5 py-1 rounded-full border transition',
                    on
                      ? 'bg-brand-soft border-brand/40 text-brand'
                      : 'bg-surface-2 border-line text-muted hover:text-ink',
                  )}
                >
                  {e.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={Plus} onClick={create} disabled={busy}>
            {busy ? 'Создаём…' : 'Добавить webhook'}
          </Button>
          {err && <div className="text-[13px] text-bad">{err}</div>}
        </div>
      </div>
      {loading ? (
        <div className="text-[13px] text-muted italic flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Загружаем список…
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-[13px] text-muted italic">
          Пока нет webhook-endpoints. Добавьте URL и мы будем слать туда POST при выбранных событиях (с HMAC-подписью).
        </div>
      ) : (
        <div className="space-y-1.5">
          {webhooks.map((w) => (
            <div key={w.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-2">
              <Webhook size={16} className={w.active ? 'text-ok' : 'text-muted'} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{w.name}</div>
                <div className="text-[11px] text-muted font-mono truncate">{w.url}</div>
                <div className="text-[11px] text-muted">
                  {(w.events || []).join(' · ')} · {w.active ? 'активен' : 'выключен'}
                </div>
              </div>
              <button
                onClick={() => toggle(w)}
                className="text-[12px] px-2 py-1 rounded bg-surface hover:bg-surface-3"
              >
                {w.active ? 'Выключить' : 'Включить'}
              </button>
              <button
                onClick={() => remove(w.id)}
                className="text-muted hover:text-bad p-1"
                title="Удалить"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Legacy fallback без сервера (offline / demo). Ничего никуда не улетает —
// показываем UI-обвязку над локальным стором, чтобы прежние тесты и demo-режим
// не сломались, но пользователь сразу видит, что это заглушка.
function IntegrationsSectionLegacy() {
  const settings = useStore((s) => s.settings) || {}
  const addApiKey = useStore((s) => s.addApiKey)
  const removeApiKey = useStore((s) => s.removeApiKey)
  const addWebhook = useStore((s) => s.addWebhook)
  const removeWebhook = useStore((s) => s.removeWebhook)
  const toggleWebhook = useStore((s) => s.toggleWebhook)
  const [label, setLabel] = useState('')
  const [freshKey, setFreshKey] = useState(null)
  const [whUrl, setWhUrl] = useState('')

  const keys = settings.apiKeys || []
  const webhooks = settings.webhooks || []

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Webhook size={16} className="text-brand" /> Интеграции (API + webhooks)
        </span>
      }
      subtitle="Работаем без сервера — ключи и webhooks локальные, реальных вызовов не будет. Задайте VITE_API_URL в .env для настоящих интеграций."
    >
      <div className="space-y-4">
        {freshKey && (
          <div className="p-3 rounded-xl bg-warn-soft border border-warn/30">
            <div className="text-[12px] font-semibold text-warn mb-1">
              Ключ показан один раз (локально).
            </div>
            <code className="text-[12px] font-mono px-2 py-1.5 rounded bg-surface break-all block">
              {freshKey.key}
            </code>
            <button onClick={() => setFreshKey(null)} className="text-[12px] text-muted mt-1">
              Скрыть
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Название ключа"
          />
          <Button
            icon={Plus}
            onClick={() => {
              const res = addApiKey(label.trim() || 'Ключ', ['read'])
              setFreshKey({ key: res.key })
              setLabel('')
            }}
          >
            Создать ключ
          </Button>
        </div>
        {keys.length > 0 && (
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-2">
                <KeyRound size={16} className="text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{k.label}</div>
                  <div className="text-[11px] text-muted font-mono">{k.keyPreview}</div>
                </div>
                <button onClick={() => removeApiKey(k.id)} className="text-muted hover:text-bad p-1">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input value={whUrl} onChange={(e) => setWhUrl(e.target.value)} placeholder="https://…" />
          <Button
            icon={Plus}
            onClick={() => {
              if (!/^https?:\/\//.test(whUrl.trim())) return
              addWebhook(whUrl.trim(), ['order.created'])
              setWhUrl('')
            }}
          >
            Webhook
          </Button>
        </div>
        {webhooks.length > 0 && (
          <div className="space-y-1.5">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-2">
                <Webhook size={16} className={w.active ? 'text-ok' : 'text-muted'} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-mono truncate">{w.url}</div>
                </div>
                <button
                  onClick={() => toggleWebhook(w.id)}
                  className="text-[12px] px-2 py-1 rounded bg-surface hover:bg-surface-3"
                >
                  {w.active ? 'Выключить' : 'Включить'}
                </button>
                <button onClick={() => removeWebhook(w.id)} className="text-muted hover:text-bad p-1">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

// U2: GDPR / 152-ФЗ — экспорт данных и удаление аккаунта. Обе операции
// доступны только admin (сервер сам вернёт 403 иначе). Экспорт — async job,
// polling status до ready → download-token в отдельной вкладке. Удаление —
// grace 30 дней с password_confirm и возможностью отменить.
function GdprSection() {
  // Обёртка на !hasApi — early return вне тела с хуками (react-hooks/rules-of-hooks).
  if (!hasApi) return null
  return <GdprSectionCloud />
}

function GdprSectionCloud() {
  const [exportJob, setExportJob] = useState(null)  // { id, status, downloadUrl, error }
  const [exportErr, setExportErr] = useState('')
  const [deletePending, setDeletePending] = useState(null)  // { graceUntil }
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteAck, setDeleteAck] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

  const startExport = async () => {
    setExportErr('')
    const r = await apiCreateExport()
    if (!r.ok) {
      setExportErr(r.body?.error?.message || 'Не удалось запустить экспорт')
      return
    }
    setExportJob({ id: r.body.jobId, status: r.body.status })
    // polling каждые 3 сек до готовности или 10 минут макс
    const deadline = Date.now() + 10 * 60 * 1000
    const poll = async () => {
      if (Date.now() > deadline) return
      const s = await apiGetExportStatus(r.body.jobId)
      if (!s.ok) return
      const job = s.body.job
      setExportJob({
        id: job.id,
        status: job.status,
        downloadUrl: job.downloadUrl ? apiBase + job.downloadUrl : null,
        error: job.error,
        sizeBytes: job.sizeBytes,
      })
      if (job.status === 'pending') setTimeout(poll, 3000)
    }
    setTimeout(poll, 1500)
  }

  const doDelete = async () => {
    setDeleteErr('')
    if (!deletePassword) return setDeleteErr('Введите текущий пароль для подтверждения')
    if (!deleteAck) return setDeleteErr('Подтвердите, что понимаете последствия')
    setDeleteBusy(true)
    const r = await apiDeleteAccount(deletePassword)
    setDeleteBusy(false)
    if (!r.ok) {
      setDeleteErr(r.body?.error?.message || 'Не удалось удалить аккаунт')
      return
    }
    setDeletePending({ graceUntil: r.body.graceUntil })
    setShowDeleteDialog(false)
    setDeletePassword('')
    setDeleteAck(false)
  }

  const cancelDelete = async () => {
    const r = await apiCancelDeleteAccount()
    if (r.ok) setDeletePending(null)
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-brand" /> Мои данные (152-ФЗ / GDPR)
        </span>
      }
      subtitle="Полный экспорт данных компании и удаление аккаунта. Оба действия доступны только администратору."
    >
      {deletePending && (
        <div className="mb-4 p-4 rounded-xl bg-bad-soft border border-bad/30">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-bad shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-bad">
                Аккаунт помечен на удаление
              </div>
              <div className="text-[13px] text-muted mt-0.5">
                Данные будут физически стёрты{' '}
                <span className="font-medium text-ink">
                  {new Date(deletePending.graceUntil).toLocaleDateString('ru-RU')}
                </span>
                . До этого момента вы можете отменить удаление.
              </div>
              <Button size="sm" variant="soft" className="mt-2" onClick={cancelDelete}>
                Отменить удаление
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-5">
        {/* Экспорт */}
        <div>
          <div className="text-[13px] font-semibold mb-2 flex items-center gap-2">
            <FileDown size={14} /> Экспорт данных
          </div>
          <div className="text-[12px] text-muted mb-2">
            JSON со всеми товарами, клиентами, заказами, документами и настройками
            компании. Готовится 1-2 минуты, ссылка на скачивание действует 48 часов.
          </div>
          {!exportJob && (
            <Button icon={Download} onClick={startExport}>
              Запустить экспорт
            </Button>
          )}
          {exportJob && exportJob.status === 'pending' && (
            <div className="p-3 rounded-xl bg-info-soft border border-info/30 flex items-center gap-2 text-[13px]">
              <Loader2 size={14} className="animate-spin text-info" />
              Готовим экспорт… Обычно 1-2 минуты.
            </div>
          )}
          {exportJob && exportJob.status === 'ready' && exportJob.downloadUrl && (
            <div className="p-3 rounded-xl bg-ok-soft border border-ok/30">
              <div className="text-[13px] font-medium text-ok mb-1.5">
                Экспорт готов
                {exportJob.sizeBytes ? ` (${(exportJob.sizeBytes / 1024).toFixed(1)} КБ)` : ''}
              </div>
              <a
                href={exportJob.downloadUrl}
                download
                className="inline-flex items-center gap-1.5 text-[13px] text-brand hover:underline"
              >
                <Download size={14} /> Скачать JSON
              </a>
              <button
                onClick={() => setExportJob(null)}
                className="ml-3 text-[12px] text-muted hover:text-ink"
              >
                Скрыть
              </button>
            </div>
          )}
          {exportJob && exportJob.status === 'failed' && (
            <div className="p-3 rounded-xl bg-bad-soft border border-bad/30 text-[13px] text-bad">
              Не удалось подготовить экспорт: {exportJob.error || 'неизвестная ошибка'}.
              <button onClick={() => setExportJob(null)} className="ml-2 underline">
                Скрыть
              </button>
            </div>
          )}
          {exportErr && (
            <div className="mt-2 text-[13px] text-bad">{exportErr}</div>
          )}
        </div>

        {/* Удаление аккаунта */}
        {!deletePending && (
          <div>
            <div className="text-[13px] font-semibold mb-2 flex items-center gap-2 text-bad">
              <UserX size={14} /> Удаление аккаунта
            </div>
            <div className="text-[12px] text-muted mb-2">
              Все данные компании (товары, заказы, клиенты) будут удалены. 30 дней
              на отмену — за это время можно вернуть всё.
            </div>
            {!showDeleteDialog ? (
              <Button
                variant="ghost"
                icon={UserX}
                className="text-bad"
                onClick={() => setShowDeleteDialog(true)}
              >
                Удалить аккаунт и все данные
              </Button>
            ) : (
              <div className="p-3 rounded-xl bg-bad-soft border border-bad/30 space-y-2">
                <div className="text-[13px] font-semibold text-bad">
                  Подтвердите удаление
                </div>
                <Field label="Текущий пароль">
                  <Input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Введите пароль от аккаунта"
                  />
                </Field>
                <label className="flex items-start gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={deleteAck}
                    onChange={(e) => setDeleteAck(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Я понимаю, что через 30 дней все данные компании будут
                    физически удалены и не подлежат восстановлению.
                  </span>
                </label>
                {deleteErr && <div className="text-[13px] text-bad">{deleteErr}</div>}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    className="text-bad"
                    onClick={doDelete}
                    disabled={deleteBusy}
                  >
                    {deleteBusy ? 'Удаляем…' : 'Да, удалить аккаунт'}
                  </Button>
                  <Button
                    variant="soft"
                    onClick={() => {
                      setShowDeleteDialog(false)
                      setDeletePassword('')
                      setDeleteAck(false)
                      setDeleteErr('')
                    }}
                  >
                    Отменить
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}
