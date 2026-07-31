import { useState } from 'react'
import { Check, KeyRound, Loader2, Sparkles } from 'lucide-react'
import { Section, Button, Field, Input, Select, Badge, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { askLLM, aiConfig, aiEnabled, AI_MODELS, ENV_AI_KEY } from '@/shared/lib/ai'

// Настройки ИИ-помощника: локальный режим работает без ключа (эвристики),
// облачный — реальный OpenAI через ProxyAPI (доступен из РФ). Ключ хранится
// только локально в localStorage (F1-7 маскирует его в JSON-экспорте,
// F4-4 обфусцирует в persist через secureStorage).
export default function AiSection() {
  const { settings, updateSettings } = useStore()
  const [aiTest, setAiTest] = useState(null) // null | 'loading' | {ok, msg}
  const set = (k, v) => updateSettings({ [k]: v })

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

  return (
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
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Endpoint (API URL)" hint="ProxyAPI для OpenAI. Можно указать свой прокси/провайдера." className="mt-3">
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
  )
}
