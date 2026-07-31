import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from '@/shared/components/ErrorBoundary'
import { initMonitoring } from '@/shared/lib/monitoring'
import './index.css'

initMonitoring() // Sentry: no-op без VITE_SENTRY_DSN

// Тёмная тема по умолчанию (если пользователь не выбрал иное)
const saved = localStorage.getItem('sklad.theme')
if (saved === 'light') {
  document.documentElement.classList.remove('dark')
} else {
  document.documentElement.classList.add('dark')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

// D2: регистрация PWA service worker. В dev браузер сам подставит /sw.js,
// на GH Pages сработает подпуть /skladpro/. Регистрируем после mount, чтобы
// не тормозить первый рендер. В development SW нам мешает (кэширует
// изменения) — регистрируем только в production build.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || '/'
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(() => {})
  })
}
