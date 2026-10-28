import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach,describe,it,expect,vi } from 'vitest'
const html=readFileSync(new URL('../../../index.html',import.meta.url),'utf8')
const capture=html.match(/<script>([\s\S]*?)<\/script>/)[1]
function runtime(hash='',fail=false) {
 let url=new URL('https://app.example.test/'+hash)
 const handlers={},window={addEventListener:(name,fn)=>{(handlers[name] ||= []).push(fn)}}
 const location={};for(const name of ['href','origin','hash','pathname','search'])Object.defineProperty(location,name,{get:()=>url[name]})
 window.location=location
 const history={state:null,replaceState:vi.fn((_state,_title,value)=>{if(fail)throw Error('blocked');url=new URL(value,url)}),pushState:vi.fn((_state,_title,value)=>{url=new URL(value,url)})}
 runInNewContext(capture,{location,window,history,URL,URLSearchParams})
 return {window,history,location,navigate(value,event='hashchange'){url=new URL(value,url);for(const fn of handlers[event]||[])fn()}}
}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules()})
describe('invitation secret boundary',()=>{
 it('captures initial proof before analytics and never stores it on an enumerable global',async()=>{
  const token='a'.repeat(32),r=runtime('#/?email=person%40example.test&invite='+token)
  expect(r.location.href).not.toContain(token);expect(r.location.hash).toBe('#/?email=person%40example.test')
  expect(Object.keys(r.window)).not.toContain('__invitationBridge')
  vi.stubGlobal('window',r.window);const secret=await import('./invitationSecret')
  expect(secret.getInvitationSecret()).toBe(token);expect(r.window.__invitationBridge.take()).toBe(null)
  secret.clearInvitationSecret();expect(secret.hasInvitationSecret()).toBe(false)
  expect(html.indexOf('window.__invitationFlow')).toBeLessThan(html.indexOf('mc.yandex.ru'))
 })
 it.each(['hashchange','popstate'])('captures %s once, replaces older proof and clears it safely',async event=>{
  const r=runtime();vi.stubGlobal('window',r.window);const secret=await import('./invitationSecret'),listener=vi.fn();secret.onInvitationCaptured(listener)
  r.navigate('#/?invite='+ 'a'.repeat(32),event);r.navigate(r.location.href,event);await Promise.resolve()
  expect(listener).toHaveBeenCalledOnce();const first=secret.getInvitationProof()
  r.navigate('#/?invite='+ 'b'.repeat(32),event);await Promise.resolve()
  expect(secret.getInvitationSecret()).toBe('b'.repeat(32));expect(secret.isInvitationProofCurrent(first)).toBe(false)
  expect(secret.clearInvitationSecret(first)).toBe(false)
  secret.clearInvitationSecret();expect(secret.hasInvitationSecret()).toBe(false)
  r.navigate('#/?invite='+ 'a'.repeat(32),event);expect(secret.getInvitationSecret()).toBe('a'.repeat(32))
 })
 it.each(['pushState','replaceState'])('sanitizes SPA %s before history mutation',async method=>{
  const r=runtime();vi.stubGlobal('window',r.window);const secret=await import('./invitationSecret')
  r.history[method]({router:true},'', '/#/orders?invite='+ 'c'.repeat(32))
  expect(r.location.href).not.toContain('c'.repeat(32));expect(secret.getInvitationSecret()).toBe('c'.repeat(32))
 })
 it('does not retain the previous proof if cleaning a new URL fails',async()=>{
  const r=runtime('#/?invite='+ 'a'.repeat(32),true);vi.stubGlobal('window',r.window);const secret=await import('./invitationSecret')
  expect(secret.hasInvitationSecret()).toBe(false);expect(r.window.__invitationFlow).toBe(true)
 })
 it('does not notify two acceptors for duplicate navigation events',async()=>{
  const r=runtime();vi.stubGlobal('window',r.window);const secret=await import('./invitationSecret'),listener=vi.fn();secret.onInvitationCaptured(listener)
  r.navigate('#/?invite='+ 'a'.repeat(32),'popstate');r.navigate(r.location.href,'hashchange');await Promise.resolve()
  expect(listener).toHaveBeenCalledOnce()
 })
 it('rejects insecure page or actual API destination without a persistent fallback',async()=>{
  vi.stubGlobal('location',{protocol:'http:',hostname:'example.test',origin:'http://example.test'})
  const secret=await import('./invitationSecret');expect(()=>secret.requireInvitationTransport()).toThrow('HTTPS')
  vi.stubGlobal('location',{protocol:'https:',hostname:'example.test',origin:'https://example.test'});vi.stubEnv('VITE_API_URL','http://remote-api.example.test')
  expect(()=>secret.requireInvitationTransport()).toThrow('HTTPS')
  vi.stubEnv('VITE_API_URL','https://api.example.test');expect(()=>secret.requireInvitationTransport()).not.toThrow();expect(secret.hasInvitationSecret()).toBe(false)
 })
 it('treats explicitly reopening the same failed link as a fresh retry',async()=>{
  const r=runtime();vi.stubGlobal('window',r.window);const secret=await import('./invitationSecret'),listener=vi.fn();secret.onInvitationCaptured(listener)
  r.navigate('#/?invite='+ 'a'.repeat(32));await Promise.resolve();const old=secret.getInvitationProof()
  r.navigate('#/?invite='+ 'a'.repeat(32));await Promise.resolve()
  expect(listener).toHaveBeenCalledTimes(2);expect(secret.isInvitationProofCurrent(old)).toBe(false)
 })

})
