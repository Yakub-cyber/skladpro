import { Database, Download, RotateCcw } from 'lucide-react'
import { Section, Button } from '@/shared/ui'
import { useConfirm } from '@/shared/components/Confirm'
import { useStore } from '@/shared/store/useStore'

// Управление локальными данными: бэкап в JSON и сброс к демо. Настоящий
// экспорт компании через сервер лежит в GdprSection (с одноразовым токеном
// и лимитом ссылки 48ч). Этот здесь — быстрый локальный дамп для отладки
// и переноса demo-данных между устройствами.
export default function DataSection({ cloud }) {
  const confirm = useConfirm()
  const resetDemo = useStore((s) => s.resetDemo)

  const exportData = () => {
    // F1-7: маскируем секреты перед выгрузкой. Раньше webhooks[].secret,
    // aiKey и полные apiKeys уходили в файл — экспорт превращался в утечку.
    // apiKeys теперь хранят только keyPreview, безопасны. webhook-secret и
    // aiKey заменяем на маркер '***'.
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
      // parse не удался — отдаём как есть, лучше файл с секретом, чем потерянный бэкап
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
    <Section
      title={
        <span className="flex items-center gap-2">
          <Database size={16} className="text-brand" /> Данные
        </span>
      }
      subtitle={
        cloud
          ? 'Данные синхронизируются с облаком между устройствами. Локальная копия — офлайн-кэш и быстрый доступ.'
          : 'Данные хранятся в браузере (localStorage). Задайте VITE_API_URL в .env, чтобы включить облачную синхронизацию.'
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
  )
}
