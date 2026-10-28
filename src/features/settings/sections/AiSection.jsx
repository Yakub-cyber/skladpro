import { Sparkles } from 'lucide-react'
import { Section } from '@/shared/ui'
import { AI_UNAVAILABLE_MESSAGE } from '@/shared/lib/ai'

export default function AiSection() {
  return <Section title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-brand" /> Искусственный интеллект</span>}
    subtitle="Локальные функции доступны без API-ключа и интернета.">
    <p role="status" className="text-sm text-muted">{AI_UNAVAILABLE_MESSAGE}</p>
    <p className="mt-2 text-sm text-muted">Ранее сохранённые настройки не удалены. Ключи из них не используются и не отправляются.</p>
  </Section>
}
