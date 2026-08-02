import { Database, Download } from 'lucide-react'
import { Section, Button } from '@/shared/ui'

export default function DataSection({ cloud }) {

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
      </div>
    </Section>
  )
}
