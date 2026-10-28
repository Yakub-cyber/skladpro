import React, { Component } from 'react'

function isRouteImportError(error) {
  return error?.name === 'ChunkLoadError' || /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .+ failed|unable to preload css/i.test(error?.message || '')
}

// React.lazy retains a rejected promise. Reload the exact route for a fresh
// module graph, preserving its receipt ID and without invoking another sale.
export default class RouteImportBoundary extends Component {
  static isImportError = isRouteImportError
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  retry = () => window.location.reload()
  render() {
    if (!this.state.error) return this.props.children
    if (!isRouteImportError(this.state.error)) throw this.state.error
    return (
      <div role="alert" className="card p-6 max-w-lg mx-auto space-y-3">
        <h2 className="text-lg font-semibold">Не удалось открыть страницу</h2>
        <p className="text-sm text-muted">Проверьте подключение и повторите загрузку. Сохранённые операции не удаляются; повторная загрузка страницы не создаёт новую продажу.</p>
        <button onClick={this.retry} className="h-10 px-4 rounded-xl bg-brand text-brand-ink font-medium">Повторить загрузку</button>
      </div>
    )
  }
}
