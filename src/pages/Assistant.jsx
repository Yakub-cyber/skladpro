import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Send, Loader2, Bot, User, Settings as SettingsIcon, Lightbulb } from 'lucide-react'
import { Card, Button, Badge, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { askLLM, aiConfig, aiEnabled, analyticsInsights } from '../lib/ai'
import { buildAssistantContext, buildAssistantPrompt } from '../lib/assistant'

const SUGGESTIONS = [
  'Что заканчивается на складе?',
  'Кто должен денег и сколько?',
  'Собери заявку на закупку по дефициту',
  'Топ-5 товаров по продажам',
  'Какой товар лежит без движения?',
]

export default function Assistant() {
  const settings = useStore((s) => s.settings)
  const enabled = aiEnabled(settings)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const ask = async (q) => {
    const question = (q ?? input).trim()
    if (!question || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: question }])
    setBusy(true)
    try {
      const s = useStore.getState()
      const ctx = buildAssistantContext(s, { currency: s.settings?.currency || '₽' })
      const answer = await askLLM(buildAssistantPrompt(ctx, question), aiConfig(settings))
      setMessages((m) => [...m, { role: 'assistant', text: answer || 'Пустой ответ.' }])
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `⚠ Ошибка запроса к ИИ: ${String(e.message || e)}`, error: true },
      ])
    }
    setBusy(false)
  }

  return (
    <div className="animate-fadeUp max-w-3xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles size={20} className="text-brand" /> ИИ-ассистент
        </h2>
        <p className="text-sm text-muted">
          Спросите о своём складе на обычном языке — ответ по вашим остаткам, заказам и долгам.
        </p>
      </div>

      {!enabled && <LocalMode />}

      {/* Лента сообщений */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pr-1">
        {messages.length === 0 && enabled && (
          <div className="text-center py-8">
            <div className="h-14 w-14 rounded-2xl bg-brand-soft text-brand grid place-items-center mx-auto mb-3">
              <Bot size={28} />
            </div>
            <p className="text-sm text-muted mb-4">С чего начнём? Например:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="text-[13px] px-3 h-9 rounded-xl bg-surface-2 border border-line text-muted hover:text-ink hover:border-brand/40 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cx('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
            <div
              className={cx(
                'h-8 w-8 rounded-lg grid place-items-center shrink-0',
                m.role === 'user' ? 'bg-surface-3 text-ink' : 'bg-brand-soft text-brand',
              )}
            >
              {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div
              className={cx(
                'rounded-2xl px-4 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap leading-relaxed',
                m.role === 'user'
                  ? 'bg-brand text-brand-ink'
                  : m.error
                    ? 'bg-bad-soft text-bad'
                    : 'bg-surface-2',
              )}
            >
              {m.text}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 bg-brand-soft text-brand">
              <Bot size={16} />
            </div>
            <div className="rounded-2xl px-4 py-3 bg-surface-2">
              <Loader2 size={16} className="animate-spin text-muted" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Ввод */}
      {enabled && (
        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ask()
              }
            }}
            rows={1}
            placeholder="Спросите про остатки, заказы, долги…"
            className="flex-1 resize-none max-h-32 px-4 py-2.5 rounded-xl bg-surface-2 border border-line text-sm outline-none focus:border-brand/50"
          />
          <Button icon={busy ? Loader2 : Send} disabled={busy || !input.trim()} onClick={() => ask()}
            className={busy ? '[&>svg]:animate-spin' : ''}>
            <span className="hidden sm:inline">Спросить</span>
          </Button>
        </div>
      )}
    </div>
  )
}

// Экран, когда облачный ИИ выключен: подсказка + локальные инсайты.
function LocalMode() {
  const products = useStore((s) => s.products)
  const orders = useStore((s) => s.orders)
  const insights = analyticsInsights({ products, orders })

  return (
    <div className="space-y-4 mb-4">
      <Card className="p-4 flex items-start gap-3 border-brand/30 bg-brand-soft/40">
        <SettingsIcon size={18} className="text-brand mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-sm">Облачный ИИ-чат выключен</div>
          <p className="text-[13px] text-muted mt-0.5">
            Чтобы задавать вопросы текстом, добавьте API-ключ в Настройках. А пока — локальные
            подсказки без интернета:
          </p>
        </div>
        <Link to="/settings">
          <Button size="sm" variant="soft">
            Настроить
          </Button>
        </Link>
      </Card>

      {insights.length ? (
        insights.map((it) => (
          <Card key={it.id} className="p-4 flex items-start gap-3">
            <Lightbulb size={18} className="text-brand mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-sm flex items-center gap-2">
                {it.title}
                <Badge tone={it.severity === 'bad' ? 'bad' : it.severity === 'warn' ? 'warn' : 'ok'}>
                  {it.severity === 'bad' ? 'важно' : it.severity === 'warn' ? 'внимание' : 'ок'}
                </Badge>
              </div>
              <p className="text-[13px] text-muted mt-1 leading-relaxed">{it.text}</p>
            </div>
          </Card>
        ))
      ) : (
        <p className="text-sm text-muted text-center py-4">Пока нет подсказок — данные в норме.</p>
      )}
    </div>
  )
}
