import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, GitPullRequest, LifeBuoy, Loader2, MessageSquarePlus, XCircle } from 'lucide-react'
import {
	apiCreateSupportTicket,
	apiListSupportTickets,
	hasApi,
	subscribeEvents,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { Badge, Button, Empty, Field, Modal, Textarea } from './ui'

// ── Автосбор клиентского контекста ─────────────────────────────────────────
// Отправляем то, что помогает Claude'у найти баг без переспрашивания клиента:
// какая страница, какое разрешение, что говорил браузер, версия сборки.
// buildHash берём из Vite env (нужно уметь ставить в CI через `--define`;
// если нет — просто пусто, не критично).
function collectContext() {
	const ctx = {
		viewport: `${window.innerWidth}x${window.innerHeight}`,
		locale: navigator.language,
		online: navigator.onLine,
		buildHash: import.meta.env?.VITE_BUILD_ID || null,
		mode: import.meta.env?.MODE || null,
	}
	// Sentry event id последней ошибки — если проект прицеплен и хук отработал.
	try {
		const sentry = window.Sentry
		if (sentry?.lastEventId) ctx.sentryEventId = sentry.lastEventId()
	} catch {}
	// Кольцевой буфер последних console.error (заполняется shim'ом ниже).
	if (Array.isArray(window.__skladConsoleErrors) && window.__skladConsoleErrors.length) {
		ctx.recentErrors = window.__skladConsoleErrors.slice(-5)
	}
	return ctx
}

// Ставим shim на console.error один раз за жизнь страницы — чтобы у нас был
// «чёрный ящик» последних 20 ошибок к моменту отправки тикета. Без риска
// уронить приложение: если shim упал, восстанавливаем оригинал.
function installConsoleShim() {
	if (window.__skladConsoleShimInstalled) return
	window.__skladConsoleShimInstalled = true
	window.__skladConsoleErrors = []
	const orig = window.console.error.bind(window.console)
	window.console.error = (...args) => {
		try {
			const msg = args
				.map(a => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeStr(a)))
				.join(' ')
				.slice(0, 500)
			window.__skladConsoleErrors.push({ at: new Date().toISOString(), msg })
			if (window.__skladConsoleErrors.length > 20) window.__skladConsoleErrors.shift()
		} catch {}
		orig(...args)
	}
}
function safeStr(v) {
	try { return JSON.stringify(v) } catch { return String(v) }
}

// ── Форматирование статуса ────────────────────────────────────────────────
const STATUS = {
	received:  { label: 'Принято',        tone: 'info',  hint: 'Обращение зарегистрировано, ждём анализа.' },
	analyzing: { label: 'Анализ',         tone: 'info',  hint: 'ИИ ищет причину в коде.' },
	pr_open:   { label: 'PR открыт',      tone: 'warn',  hint: 'Решение подготовлено, ждёт одобрения владельца.' },
	merged:    { label: 'Исправлено',     tone: 'ok',    hint: 'Патч одобрен и вошёл в релиз.' },
	rejected:  { label: 'Отклонено',      tone: 'muted', hint: 'Владелец отклонил предложенное исправление.' },
	failed:    { label: 'Не удалось',     tone: 'bad',   hint: 'Автоматика не смогла локализовать баг — обращение эскалируется вручную.' },
}
const STATUS_ICON = {
	received:  MessageSquarePlus,
	analyzing: Loader2,
	pr_open:   GitPullRequest,
	merged:    CheckCircle2,
	rejected:  XCircle,
	failed:    XCircle,
}

function StatusChip({ status }) {
	const s = STATUS[status] || STATUS.received
	const Icon = STATUS_ICON[status] || MessageSquarePlus
	const spinning = status === 'analyzing'
	return (
		<Badge tone={s.tone}>
			<Icon size={12} className={spinning ? 'animate-spin' : ''} />
			{s.label}
		</Badge>
	)
}

// ── Форма нового обращения ────────────────────────────────────────────────
function NewTicketForm({ onSent }) {
	const [description, setDescription] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [ok, setOk] = useState(null)

	const trimmed = description.trim()
	const canSubmit = !busy && trimmed.length >= 10 && trimmed.length <= 2000

	const submit = async () => {
		setBusy(true)
		setError('')
		try {
			const res = await apiCreateSupportTicket({
				description: trimmed,
				pageUrl: window.location.href,
				pageTitle: document.title,
				userAgent: navigator.userAgent,
				context: collectContext(),
			})
			if (!res.ok) {
				setError(res.error?.message || `Не удалось отправить (${res.error?.code || 'ошибка'})`)
			} else {
				setOk(res.body.ticket)
				setDescription('')
				onSent?.(res.body.ticket)
			}
		} finally {
			setBusy(false)
		}
	}

	if (ok) {
		return (
			<div className="text-center py-4">
				<div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-ok-soft text-ok grid place-items-center">
					<CheckCircle2 size={26} />
				</div>
				<p className="font-medium">Спасибо! Обращение принято.</p>
				<p className="text-[13px] text-muted mt-1 max-w-sm mx-auto">
					Мы сообщим сюда же, когда исправление будет в релизе. Статус — во вкладке «Мои обращения».
				</p>
				<div className="mt-4 flex justify-center gap-2">
					<Button variant="soft" onClick={() => setOk(null)}>Ещё одно</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<p className="text-[13px] text-muted leading-relaxed">
				Опишите, что не работает или ведёт себя странно. Мы автоматически прикрепим страницу,
				на которой вы сейчас находитесь, и техническую информацию — писать её вручную не нужно.
			</p>
			<Field label={`Что случилось? (${trimmed.length}/2000)`}>
				<Textarea
					rows={6}
					placeholder='Пример: «При открытии смены в кассе кнопка «Открыть смену» нажимается, но ничего не происходит, чек не открывается. Пробовал перезагрузить страницу — не помогло».'
					value={description}
					onChange={e => setDescription(e.target.value)}
					disabled={busy}
					maxLength={2000}
				/>
			</Field>
			<div className="rounded-xl bg-surface-2 border border-line px-3 py-2 text-[12px] text-muted">
				<div><b>Страница:</b> {document.title} — {window.location.pathname}{window.location.hash}</div>
				<div><b>Устройство:</b> {window.innerWidth}×{window.innerHeight}, {navigator.userAgent.split(') ')[0]?.slice(0, 80) || navigator.userAgent.slice(0, 80)})</div>
			</div>
			{error && (
				<div className="rounded-xl bg-bad-soft text-bad px-3 py-2 text-[13px]">{error}</div>
			)}
			<div className="flex justify-end gap-2">
				<Button onClick={submit} disabled={!canSubmit} icon={busy ? Loader2 : MessageSquarePlus}>
					{busy ? 'Отправка…' : 'Отправить'}
				</Button>
			</div>
		</div>
	)
}

// ── Список моих обращений ─────────────────────────────────────────────────
function MyTickets({ refreshToken }) {
	const [tickets, setTickets] = useState(null) // null = loading, [] = empty
	const [error, setError] = useState('')

	const load = useCallback(async () => {
		setError('')
		const res = await apiListSupportTickets({ mine: true, limit: 20 })
		if (!res.ok) {
			setError(res.error?.message || 'Не удалось загрузить обращения')
			setTickets([])
			return
		}
		setTickets(res.body.tickets || [])
	}, [])

	useEffect(() => { load() }, [load, refreshToken])

	if (tickets === null) {
		return (
			<div className="grid place-items-center py-14 text-muted">
				<Loader2 size={22} className="animate-spin" />
			</div>
		)
	}
	if (error) {
		return <div className="rounded-xl bg-bad-soft text-bad px-3 py-2 text-[13px]">{error}</div>
	}
	if (tickets.length === 0) {
		return (
			<Empty
				icon={MessageSquarePlus}
				title="Обращений пока нет"
				text="Когда вы отправите обращение, оно и его статус появятся здесь."
			/>
		)
	}
	return (
		<ul className="space-y-2.5">
			{tickets.map(t => {
				const s = STATUS[t.status] || STATUS.received
				return (
					<li key={t.id} className="rounded-xl border border-line bg-surface-2 p-3">
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0">
								<div className="text-[13px] text-ink line-clamp-2">{t.description}</div>
								<div className="text-[11px] text-muted mt-1">
									{new Date(t.createdAt).toLocaleString('ru-RU')}
									{t.pageTitle ? ` · ${t.pageTitle}` : ''}
								</div>
							</div>
							<StatusChip status={t.status} />
						</div>
						<div className="text-[12px] text-muted mt-2">{s.hint}</div>
						{t.aiExplanation && (
							<div className="text-[12px] text-ink mt-2 rounded-lg bg-surface-3 px-2.5 py-1.5">
								<b>Причина:</b> {t.aiExplanation}
								{t.aiFilePath ? <span className="text-muted"> · {t.aiFilePath}</span> : null}
							</div>
						)}
					</li>
				)
			})}
		</ul>
	)
}

// ── Основной виджет ───────────────────────────────────────────────────────
export default function SupportWidget() {
	const cloud = useStore(s => s.cloud)
	const cloudReady = useStore(s => s.cloudReady)
	const [open, setOpen] = useState(false)
	const [tab, setTab] = useState('new') // 'new' | 'my'
	const [refreshToken, setRefreshToken] = useState(0)
	const bump = useCallback(() => setRefreshToken(v => v + 1), [])

	useEffect(() => { installConsoleShim() }, [])

	// Realtime: сервер шлёт SSE event {type: 'support_ticket'} при изменении
	// статуса тикета (n8n открыл PR / владелец одобрил). Триггерим reload
	// списка, если модалка открыта на вкладке «Мои обращения».
	useEffect(() => {
		if (!hasApi || !cloud) return undefined
		return subscribeEvents(ev => {
			if (ev?.type === 'support_ticket') bump()
		})
	}, [cloud, bump])

	// В офлайн-режиме кнопки нет: сервер, куда слать, отсутствует.
	if (!hasApi || !cloud || !cloudReady) return null

	const tabCls = t => (t === tab
		? 'text-ink bg-surface-2 border-brand'
		: 'text-muted hover:text-ink border-transparent')

	return (
		<>
			<button
				type="button"
				onClick={() => { setOpen(true); setTab('new') }}
				title="Сообщить о проблеме"
				className="fixed z-30 bottom-4 right-4 h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-brand text-brand-ink grid place-items-center shadow-lg shadow-brand/30 hover:brightness-110 active:scale-95 transition"
				aria-label="Сообщить о проблеме"
			>
				<LifeBuoy size={22} strokeWidth={2.2} />
			</button>
			<Modal
				open={open}
				onClose={() => setOpen(false)}
				title="Помощь и обращения"
				wide
			>
				<div className="flex gap-1 mb-4 border-b border-line -mx-5 px-5 -mt-1 pb-0">
					<button
						type="button"
						onClick={() => setTab('new')}
						className={`h-10 px-3 text-sm font-medium border-b-2 -mb-px transition ${tabCls('new')}`}
					>
						Новое обращение
					</button>
					<button
						type="button"
						onClick={() => { setTab('my'); bump() }}
						className={`h-10 px-3 text-sm font-medium border-b-2 -mb-px transition ${tabCls('my')}`}
					>
						Мои обращения
					</button>
				</div>
				{tab === 'new'
					? <NewTicketForm onSent={() => { bump(); setTab('my') }} />
					: <MyTickets refreshToken={refreshToken} />}
			</Modal>
		</>
	)
}
