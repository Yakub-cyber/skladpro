import { useEffect, useState } from 'react'
import { Copy, KeyRound, Loader2, Plus, Trash2, Webhook } from 'lucide-react'
import { Section, Button, Field, Input, Badge, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import {
  hasApi,
  apiListApiKeys,
  apiCreateApiKey,
  apiRevokeApiKey,
  apiListWebhooks,
  apiCreateWebhook,
  apiUpdateWebhook,
  apiDeleteWebhook,
} from '@/shared/api'

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

export default function IntegrationsSection() {
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
            <button onClick={() => setFreshKey(null)} className="text-muted hover:text-ink p-1" title="Скрыть">✕</button>
          </div>
        </div>
      )}
      <div className="grid gap-2 mb-3">
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="1С обмен / amoCRM / …" />
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
                  className={cx('text-[12px] px-2.5 py-1 rounded-full border transition', on
                    ? 'bg-brand-soft border-brand/40 text-brand'
                    : 'bg-surface-2 border-line text-muted hover:text-ink')}
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
            <div key={k.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-2">
              <KeyRound size={16} className={k.active ? 'text-muted' : 'text-bad'} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">
                  {k.name}
                  {!k.active && <Badge tone="bad" className="ml-2">отозван</Badge>}
                </div>
                <div className="text-[11px] text-muted font-mono">{k.keyPreview}</div>
                <div className="text-[11px] text-muted">{(k.scopes || []).join(' · ')}</div>
              </div>
              {k.active && (
                <button onClick={() => revoke(k.id)} className="text-muted hover:text-bad p-1" title="Отозвать">
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
    const r = await apiCreateWebhook({ name: name.trim(), url: url.trim(), events: eventArr, active: true })
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
    const r = await apiUpdateWebhook(w.id, { name: w.name, url: w.url, events: w.events, active: !w.active })
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
            <button onClick={() => setFreshSecret(null)} className="text-muted hover:text-ink p-1" title="Скрыть">✕</button>
          </div>
        </div>
      )}
      <div className="grid gap-2 mb-3">
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Уведомить 1С" />
        </Field>
        <Field label="URL приёмника">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" />
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
                  className={cx('text-[12px] px-2.5 py-1 rounded-full border transition', on
                    ? 'bg-brand-soft border-brand/40 text-brand'
                    : 'bg-surface-2 border-line text-muted hover:text-ink')}
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
              <button onClick={() => toggle(w)} className="text-[12px] px-2 py-1 rounded bg-surface hover:bg-surface-3">
                {w.active ? 'Выключить' : 'Включить'}
              </button>
              <button onClick={() => remove(w.id)} className="text-muted hover:text-bad p-1" title="Удалить">
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
            <div className="text-[12px] font-semibold text-warn mb-1">Ключ показан один раз (локально).</div>
            <code className="text-[12px] font-mono px-2 py-1.5 rounded bg-surface break-all block">{freshKey.key}</code>
            <button onClick={() => setFreshKey(null)} className="text-[12px] text-muted mt-1">Скрыть</button>
          </div>
        )}
        <div className="flex gap-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Название ключа" />
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
                <button onClick={() => toggleWebhook(w.id)} className="text-[12px] px-2 py-1 rounded bg-surface hover:bg-surface-3">
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
