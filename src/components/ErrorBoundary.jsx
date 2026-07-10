import { Component } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'

// Глобальная «сеть безопасности»: ловит ошибки рендера в дереве и показывает
// понятный экран вместо белого. Класс — потому что error boundary нельзя
// написать на хуках. Детали ошибки видны только в dev-сборке.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Точка для будущего Sentry (ROADMAP, Фаза 0). Пока — в консоль.
    console.error('Необработанная ошибка приложения:', error, info?.componentStack)
  }

  handleReload = () => {
    // Сбрасываем на дашборд и перезагружаем — чаще всего лечит частный сбой.
    window.location.hash = '#/'
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-bg text-ink grid place-items-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="h-16 w-16 rounded-2xl bg-bad-soft text-bad grid place-items-center mx-auto mb-5">
            <TriangleAlert size={30} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Что-то пошло не так</h1>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            Произошёл сбой при отображении страницы. Данные склада не потеряны —
            они сохранены локально и в облаке. Попробуйте перезагрузить.
          </p>
          {import.meta.env.DEV && (
            <pre className="mt-4 text-left text-[12px] text-bad bg-surface-2 border border-line rounded-xl p-3 overflow-auto max-h-48 whitespace-pre-wrap">
              {String(error?.stack || error?.message || error)}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            className="mt-6 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-brand text-brand-ink font-medium hover:opacity-90 transition"
          >
            <RotateCcw size={17} /> Перезагрузить
          </button>
        </div>
      </div>
    )
  }
}
