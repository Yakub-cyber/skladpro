import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// На GitHub Pages проект живёт в подпути /skladpro/.
// Для локального dev оставляем '/'.
export default defineConfig(({ command }) => ({
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
}))
