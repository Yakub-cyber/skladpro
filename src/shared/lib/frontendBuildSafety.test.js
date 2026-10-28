import { describe, it, expect, vi, afterEach } from 'vitest'
import { assertFrontendEnvironment, assertPublicOutput, frontendBuildSafety } from '../../../scripts/frontendBuildSafety'
import { askLLM, aiEnabled, aiConfig, aiParseInvoice, parseInvoiceText } from './ai'

afterEach(() => vi.unstubAllGlobals())
describe('frontend secret boundary', () => {
  it.each(['VITE_AI_KEY', 'VITE_OPENAI_API_KEY', 'VITE_JWT_SECRET', 'VITE_DATABASE_URL', 'VITE_ARBITRARY_TOKEN'])('rejects %s without exposing its value', name => {
    expect(() => assertFrontendEnvironment({ [name]: 'private-test-value' })).toThrow('FRONTEND_FORBIDDEN_ENV')
  })
  it.each(['OPENAI_API_KEY', 'JWT_SECRET', 'DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AI_SUPPORT_HMAC_SECRET'])('rejects server-side %s in the build environment', name => {
    expect(() => assertFrontendEnvironment({ [name]: 'private-test-value' })).toThrow('FRONTEND_SERVER_SECRET_ENV')
  })
  it('allows public configuration and rejects a forbidden name even with an empty value', () => {
    expect(() => assertFrontendEnvironment({ VITE_API_URL: 'https://api.test.invalid', VITE_SENTRY_DSN: '', VITE_YM_ID: '123', PATH: 'public' })).not.toThrow()
    expect(() => assertFrontendEnvironment({ VITE_AI_KEY: '' })).toThrow()
  })
  it('checks generated chunks/assets and explicit defines', () => {
    const plugin = frontendBuildSafety(), code = 'const token = "sk-' + 'x'.repeat(40) + '"'
    expect(() => plugin.generateBundle.handler({}, { a: { type: 'chunk', code } })).toThrow('FRONTEND_SECRET_IN_OUTPUT')
    expect(() => plugin.generateBundle.handler({}, { a: { type: 'asset', fileName: 'index.html', source: code } })).toThrow()
    expect(() => plugin.configResolved({ env: {}, define: { 'process.env.JWT_SECRET': 'private-test-value' } })).toThrow('FRONTEND_FORBIDDEN_DEFINE')
    expect(() => assertPublicOutput('public application code')).not.toThrow()
  })
  it('never uses saved user credentials or calls a provider without a safe backend', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const settings = Object.freeze({ aiKey: 'saved-user-test-value', aiModel: 'custom', aiBaseUrl: 'https://provider.test.invalid' })
    expect(aiEnabled(settings)).toBe(false); expect(aiConfig(settings)).toEqual({})
    await expect(askLLM('private question', settings)).rejects.toMatchObject({ code: 'AI_BACKEND_UNAVAILABLE' })
    expect(fetch).not.toHaveBeenCalled(); expect(settings.aiKey).toBe('saved-user-test-value')
  })
  it('keeps invoice parsing local, even with a legacy provider configuration', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect(await aiParseInvoice('Молоток 3 шт', [], { apiKey: 'saved-user-test-value' })).toEqual(parseInvoiceText('Молоток 3 шт', []))
    expect(fetch).not.toHaveBeenCalled()
  })
})
