// ──────────────────────────────────────────────────────────────────────────
//  Мониторинг ошибок (Sentry). Включается ТОЛЬКО если задан VITE_SENTRY_DSN
//  (пустой/отсутствующий DSN = полностью выключено, ничего не грузится).
//  SDK подтягивается динамическим import — не утяжеляет главный чанк и не
//  попадает в критический путь загрузки.
// ──────────────────────────────────────────────────────────────────────────

let sentry = null // SDK после ленивой загрузки (null = выключен/не загрузился)

export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        // Только ошибки, без трассировки производительности (не раздуваем квоту)
        tracesSampleRate: 0,
        environment: import.meta.env.MODE,
      })
      sentry = Sentry
    })
    .catch((e) => console.warn('Sentry не загрузился:', e?.message || e))
}

// Ручная отправка (ErrorBoundary). До загрузки SDK — тихий no-op:
// ошибка в любом случае уходит в console.error рядом с вызовом.
export function reportError(error, info) {
  sentry?.captureException(error, {
    extra: info?.componentStack ? { componentStack: info.componentStack } : undefined,
  })
}
