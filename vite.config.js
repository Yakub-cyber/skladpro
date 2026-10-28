import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectOfflineResources } from './scripts/offlineManifest.js'
import { assertFrontendEnvironment, frontendBuildSafety } from './scripts/frontendBuildSafety.js'

// Позволяет писать `import X from '@/shared/ui'` вместо `../../../shared/ui`.
// Alias `@` резолвится в src/ — работает в vite dev/build и в vitest.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcPath = path.resolve(__dirname, 'src')

// На GitHub Pages проект живёт в подпути /skladpro/.
// Для локального dev оставляем '/'.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  assertFrontendEnvironment(env)
  const buildId = String(Date.now())
  const apiOrigin = env.VITE_API_URL
    ? new URL(env.VITE_API_URL).origin
    : ''
  const offlineWorker = {
    name: 'skladpro-offline-resources',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const resources = collectOfflineResources(bundle)
        const template = fs.readFileSync(path.join(__dirname, 'public/sw.template.js'), 'utf8')
        this.emitFile({ type: 'asset', fileName: 'offline-manifest.json', source: JSON.stringify({ version: buildId, resources }, null, 2) })
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: template
          .replace('__BUILD_ID__', buildId)
          .replace('__API_ORIGIN__', apiOrigin)
          .replace('/*__PRECACHE_URLS__*/ []', JSON.stringify(resources)) })
      },
    },
  }
  return {
    base: '/',
    plugins: [react(), tailwindcss(), ...(command === 'build' ? [offlineWorker, frontendBuildSafety()] : [])],
    resolve: {
      alias: {
        '@': srcPath,
      },
    },
    server: {
      host: true,
      port: 5180,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'lucide': ['lucide-react'],
          },
        },
      },
    },
    // Vitest: юнит-тесты чистой логики (lib/*). DOM не требуется.
    test: {
      environment: 'node',
      include: ['src/**/*.{test,spec}.{js,jsx}'],
    },
  }
})
