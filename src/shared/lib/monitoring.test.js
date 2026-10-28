import {describe,it,expect,vi,afterEach} from 'vitest'
const h=vi.hoisted(()=>({init:vi.fn(),capture:vi.fn()}))
vi.mock('@sentry/react',()=>({init:h.init,captureException:h.capture}))
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();vi.clearAllMocks()})
describe('Sentry remains active with independent privacy hooks',()=>{
 it('initializes even during an invitation and sanitizes before breadcrumb/event/transaction delivery',async()=>{
  vi.stubEnv('VITE_SENTRY_DSN','https://public@telemetry.test.invalid/1')
  vi.stubGlobal('window',{__invitationFlow:true,location:{hash:'#/?invite='+ 'a'.repeat(32)}})
  const {initMonitoring}=await import('./monitoring');initMonitoring();await vi.waitFor(()=>expect(h.init).toHaveBeenCalledOnce())
  const config=h.init.mock.calls[0][0],secret='a'.repeat(32),id='0123456789abcdef0123456789abcdef'
  for(const hook of ['beforeBreadcrumb','beforeSend','beforeSendTransaction']) {
   const event={event_id:id,request:{url:'https://app/#/?invite='+secret},extra:{token:secret,error:'bare '+secret},contexts:{trace:{trace_id:id}},sdkProcessingMetadata:{dynamicSamplingContext:{public_key:id,trace_id:id}}}
   const clean=config[hook](event)
   expect(JSON.stringify(clean)).not.toContain(secret)
   if(hook!=='beforeBreadcrumb'){expect(clean.event_id).toBe(id);expect(clean.contexts.trace.trace_id).toBe(id);expect(clean.sdkProcessingMetadata.dynamicSamplingContext.public_key).toBe(id)}
  }
 })
 it('continues to report ordinary errors rather than disabling monitoring globally',async()=>{
  vi.stubEnv('VITE_SENTRY_DSN','https://public@telemetry.test.invalid/1')
  const {initMonitoring,reportError}=await import('./monitoring');initMonitoring();await vi.waitFor(()=>expect(h.init).toHaveBeenCalledOnce())
  reportError(Error('ordinary failure'),{componentStack:'Component'})
  expect(h.capture).toHaveBeenCalledOnce()
  expect(h.init.mock.calls[0][0].beforeSend({message:'ordinary failure'}).message).toBe('ordinary failure')
 })
})
