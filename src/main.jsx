import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initMonitoring } from './lib/monitoring'
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
