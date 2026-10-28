import { describe,it,expect,vi,beforeEach } from 'vitest'
const h=vi.hoisted(()=>({pending:true,revision:1,captureListener:null,authListener:null,accept:vi.fn(),select:vi.fn(),create:vi.fn(),context:{userId:'u1',companyId:'c1',generation:1}}))
vi.mock('../../lib/invitationSecret',()=>({hasInvitationSecret:()=>h.pending,getInvitationRevision:()=>h.revision,onInvitationCaptured:fn=>{h.captureListener=fn;return ()=>{}},clearInvitationSecret:()=>{h.pending=false}}))
vi.mock('@/shared/api',()=>({hasApi:true,getAuthContext:()=>({...h.context}),isAuthContextCurrent:()=>true,setActiveCompany:(...args)=>h.select(...args),getAuthConsistencyError:()=>null,
 apiBootstrap:async()=>({session:null}),apiEnsureMe:async()=>({ok:true}),apiGetSubscription:async()=>({ok:false})}))
vi.mock('../../lib/scopedCache',()=>({readCompanyCache:()=>null,emptyCloudData:()=>({employees:[],orders:[],settings:{}}),companyCache:{activate:()=>{},overlayLocal:(_context,data)=>data,error:()=>null}}))
vi.mock('../../lib/cloud',()=>({
 acceptInvitation:(...args)=>h.accept(...args),createCompanyCloud:(...args)=>h.create(...args),
 getCloudSession:async()=>({user:{email:'test@example.test'}}),getMembership:async()=>({company_id:'c1',role:'manager'}),cloudLoadMerged:async()=>({}),
 cloudSignIn:async()=>({ok:true}),cloudSignUp:async()=>({ok:true}),cloudSignOut:vi.fn(),
 stopCloudSync:()=>{},activateCloudContext:()=>{},pauseSync:()=>{},resumeSync:()=>{},attachSync:()=>{},subscribeToEvents:()=>()=>{},onAuthChange:fn=>{h.authListener=fn},checkRecovery:async()=>null,applyPasswordReset:vi.fn(),
}))
import {createCloudSlice,cloudInitialState} from './cloudSlice'
function store(){let state={...cloudInitialState};const set=patch=>{state={...state,...patch}};const get=()=>state;Object.assign(state,createCloudSlice(set,get));return get}
beforeEach(()=>{vi.clearAllMocks();h.pending=true;h.revision=1;h.captureListener=null;h.authListener=null;h.accept.mockImplementation(async()=>{h.pending=false;return 'c1'})})
describe('invitation bootstrap',()=>{
 it('accepts an invitation to the already selected company without recursive bootstrap',async()=>{
  const get=store();await get().bootstrapCloud()
  expect(h.accept).toHaveBeenCalledOnce();expect(h.select).not.toHaveBeenCalled();expect(h.create).not.toHaveBeenCalled()
  expect(get().cloudReady).toBe(true);expect(get().companyId).toBe('c1')
 })
 it('shows acceptance errors and does not silently create a new company',async()=>{
  h.accept.mockRejectedValue(Error('Приглашение отозвано'))
  const get=store(),result=await get().signIn('test@example.test','test-password')
  expect(result.ok).toBe(false);expect(result.error).toBe('Приглашение отозвано')
  expect(get().authUserId).toBe(null);expect(h.create).not.toHaveBeenCalled()
 })
 it('does not try to accept without a secret',async()=>{
  h.pending=false;const get=store();await get().bootstrapCloud();expect(h.accept).not.toHaveBeenCalled()
 })
 it('starts the existing bootstrap when a new proof arrives in a running session',async()=>{
  h.pending=false;const get=store();await get().initAuth()
  h.pending=true;h.revision++;h.captureListener()
  await vi.waitFor(()=>expect(get().cloudReady).toBe(true));expect(h.accept).toHaveBeenCalledOnce()
 })
 it('clears proof on logout, explicit company switch and remote signout',async()=>{
  const get=store();await get().initAuth();await get().cloudLogout();expect(h.pending).toBe(false)
  h.pending=true;h.select.mockResolvedValue({ok:false});await get().switchCompany('other');expect(h.pending).toBe(false)
  h.pending=true;h.authListener('SIGNED_OUT');expect(h.pending).toBe(false)
 })
 it('does not let an old invitation response switch the newer navigation context',async()=>{
  h.pending=false;const get=store();await get().initAuth();let resolve
  h.accept.mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockImplementationOnce(async()=>{h.pending=false;return 'c1'})
  h.pending=true;h.revision++;h.captureListener();await vi.waitFor(()=>expect(h.accept).toHaveBeenCalledTimes(1))
  h.revision++;h.captureListener();await vi.waitFor(()=>expect(get().cloudReady).toBe(true))
  resolve('old-company');await Promise.resolve();await Promise.resolve()
  expect(h.select).not.toHaveBeenCalledWith('old-company');expect(get().companyId).toBe('c1')
 })

 it('keeps an initial proof for registration when bootstrap merely has no saved session',async()=>{
  const get=store();await get().initAuth();h.authListener('SIGNED_OUT',null,{reason:'BOOTSTRAP_RESET'})
  expect(h.pending).toBe(true)
  await get().signUp('test@example.test','test-password','Name');expect(h.accept).toHaveBeenCalledOnce();expect(get().cloudReady).toBe(true)
 })

})
