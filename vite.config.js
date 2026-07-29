import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

// На GitHub Pages проект живёт в подпути /skladpro/.
// Для локального dev оставляем '/'.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // F3-3/F3-4: service worker должен знать про VITE_API_URL (чтобы не
  // кэшировать ответы бэкенда) и обновлять кэш при каждой сборке.
  // Простейший способ: генерируем sw.js в public/ на этапе конфига,
  // подставляя origin API и метку сборки. Vite при build скопирует его
  // как есть в dist/.
  const buildId = command === 'build' ? String(Date.now()) : 'dev'
  const apiOrigin = env.VITE_API_URL
    ? new URL(env.VITE_API_URL).origin
    : ''
  const swTemplate = path.resolve('public', 'sw.template.js')
  const swOut = path.resolve('public', 'sw.js')
  if (fs.existsSync(swTemplate)) {
    const raw = fs.readFileSync(swTemplate, 'utf8')
    const rendered = raw
      .replace(/__BUILD_ID__/g, buildId)
      .replace(/__API_ORIGIN__/g, apiOrigin)
    // Пишем только если поменялось — избегаем шум в dev-hot-reload.
    let old = ''
    try {
      old = fs.readFileSync(swOut, 'utf8')
    } catch {}
    if (old !== rendered) fs.writeFileSync(swOut, rendered)
  }
  return {
    base: command === 'build' ? '/skladpro/' : '/',
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5180,
    },
    // Vitest: юнит-тесты чистой логики (lib/*). DOM не требуется.
    test: {
      environment: 'node',
      include: ['src/**/*.{test,spec}.{js,jsx}'],
    },
  }
})
