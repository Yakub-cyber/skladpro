import { useState } from 'react'
import { AlertTriangle, Download, FileDown, Loader2, ShieldAlert, UserX } from 'lucide-react'
import { Section, Button, Field, Input } from '@/shared/ui'
import {
  hasApi,
  apiCreateExport,
  apiGetExportStatus,
  apiDeleteAccount,
  apiCancelDeleteAccount,
} from '@/shared/api'

// U2: GDPR / 152-ФЗ — экспорт данных и удаление аккаунта. Обе операции
// доступны только admin (сервер сам вернёт 403 иначе). Экспорт — async job,
// polling status до ready → download-token в отдельной вкладке. Удаление —
// grace 30 дней с password_confirm и возможностью отменить.
export default function GdprSection() {
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
              <div className="font-semibold text-bad">Аккаунт помечен на удаление</div>
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
            JSON со всеми товарами, клиентами, заказами, документами и настройками компании.
            Готовится 1-2 минуты, ссылка на скачивание действует 48 часов.
          </div>
          {!exportJob && (
            <Button icon={Download} onClick={startExport}>Запустить экспорт</Button>
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
              <button onClick={() => setExportJob(null)} className="ml-3 text-[12px] text-muted hover:text-ink">
                Скрыть
              </button>
            </div>
          )}
          {exportJob && exportJob.status === 'failed' && (
            <div className="p-3 rounded-xl bg-bad-soft border border-bad/30 text-[13px] text-bad">
              Не удалось подготовить экспорт: {exportJob.error || 'неизвестная ошибка'}.
              <button onClick={() => setExportJob(null)} className="ml-2 underline">Скрыть</button>
            </div>
          )}
          {exportErr && <div className="mt-2 text-[13px] text-bad">{exportErr}</div>}
        </div>

        {/* Удаление аккаунта */}
        {!deletePending && (
          <div>
            <div className="text-[13px] font-semibold mb-2 flex items-center gap-2 text-bad">
              <UserX size={14} /> Удаление аккаунта
            </div>
            <div className="text-[12px] text-muted mb-2">
              Все данные компании (товары, заказы, клиенты) будут удалены. 30 дней на отмену — за это время можно вернуть всё.
            </div>
            {!showDeleteDialog ? (
              <Button variant="ghost" icon={UserX} className="text-bad" onClick={() => setShowDeleteDialog(true)}>
                Удалить аккаунт и все данные
              </Button>
            ) : (
              <div className="p-3 rounded-xl bg-bad-soft border border-bad/30 space-y-2">
                <div className="text-[13px] font-semibold text-bad">Подтвердите удаление</div>
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
                    Я понимаю, что через 30 дней все данные компании будут физически удалены и не подлежат восстановлению.
                  </span>
                </label>
                {deleteErr && <div className="text-[13px] text-bad">{deleteErr}</div>}
                <div className="flex gap-2">
                  <Button variant="ghost" className="text-bad" onClick={doDelete} disabled={deleteBusy}>
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
