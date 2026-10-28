import {describe,it,expect} from 'vitest'
import {sanitizeTelemetryEvent,sanitizeSensitiveText} from './sensitiveTelemetry'
import {pushEvent,getEvents,buildDiagText} from './diagRing'
describe('independent telemetry boundary',()=>{
 const secret='a'.repeat(32),url='https://app.test/#/?email=person@example.test&invite='+secret
 it('redacts URL, breadcrumbs, nested values, keys and bare proof even after it was cleared',()=>{
  const value={request:{url},breadcrumbs:[{data:{from:url,to:encodeURIComponent(url)}}],extra:{deep:{error:'proof '+secret,token:secret,[secret]:url}}}
  const clean=sanitizeTelemetryEvent(value)
  expect(JSON.stringify(clean)).not.toContain(secret);expect(value.request.url).toBe(url)
  expect(clean.request.url).toContain('[REDACTED]')
  expect(sanitizeSensitiveText('https://app/#/?invite=short-proof&email=x')).not.toContain('short-proof')
 })
 it('drops unreadable events and safely handles cycles/deep values',()=>{
  const bad={};Object.defineProperty(bad,'x',{enumerable:true,get(){throw Error('unreadable')}})
  expect(sanitizeTelemetryEvent(bad)).toBe(null)
  const cycle={url};cycle.self=cycle;expect(JSON.stringify(sanitizeTelemetryEvent(cycle))).not.toContain(secret)
  let deep={url};for(let i=0;i<30;i++)deep={deep};expect(JSON.stringify(sanitizeTelemetryEvent(deep))).not.toContain(secret)
 })
 it('filters diagnostic events before retention and export',()=>{
  pushEvent('navigation',{url,nested:{token:secret},error:new Error(url)})
  expect(JSON.stringify(getEvents())).not.toContain(secret);expect(buildDiagText({companyId:url})).not.toContain(secret)
 })
})
