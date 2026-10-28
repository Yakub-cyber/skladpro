// Only explicitly public configuration may be exposed by Vite. Never print values.
const PUBLIC = new Set(['VITE_API_URL', 'VITE_SENTRY_DSN', 'VITE_YM_ID'])
const SERVER_SECRETS = new Set(['AI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PROXYAPI_KEY',
  'JWT_SECRET', 'DATABASE_URL', 'SMTP_URL', 'AI_SUPPORT_HMAC_SECRET', 'N8N_WEBHOOK_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY', 'FIREBASE_PRIVATE_KEY', 'YOOKASSA_SECRET_KEY', 'FISCAL_KMS_KEY'])
const error = code => { throw new Error(code) }

export function assertFrontendEnvironment(env) {
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('VITE_') && !PUBLIC.has(name)) error('FRONTEND_FORBIDDEN_ENV')
    if (SERVER_SECRETS.has(name) && value) error('FRONTEND_SERVER_SECRET_ENV')
  }
}

export function assertPublicOutput(text) {
  if (/VITE_AI_KEY|(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY)|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b|(?:postgres(?:ql)?|smtps?):\/\/[^\s"'/:]+:[^\s"'@]+@/.test(text)) {
    error('FRONTEND_SECRET_IN_OUTPUT')
  }
}

export function frontendBuildSafety() {
  return {
    name: 'skladpro-public-build-safety',
    enforce: 'post',
    configResolved(config) {
      assertFrontendEnvironment(config.env)
      // Catch explicit define-based injection, including otherwise unexposed server env.
      for (const [key, value] of Object.entries(config.define || {})) {
        const name = key.split('.').at(-1)
        if (SERVER_SECRETS.has(name) || name === 'VITE_AI_KEY') error('FRONTEND_FORBIDDEN_DEFINE')
        assertPublicOutput(typeof value === 'string' ? value : JSON.stringify(value))
      }
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const item of Object.values(bundle)) {
          if (item.type === 'chunk') assertPublicOutput(item.code)
          else if (/\.(?:html|js|mjs|json|map|css|txt)$/.test(item.fileName)) {
            assertPublicOutput(typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source))
          }
        }
      },
    },
  }
}
