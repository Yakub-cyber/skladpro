import { hasInvitationSecret, getInvitationRevision, onInvitationCaptured, clearInvitationSecret } from '../../lib/invitationSecret'
// Cloud lifecycle: session generation + local lifecycle epoch protect every async result.
import { uid } from '../../lib/id'
import { apiBootstrap, apiEnsureMe, apiGetSubscription, getAuthContext, isAuthContextCurrent,
  setActiveCompany, hasApi, getAuthConsistencyError } from '@/shared/api'
import { companyCache, readCompanyCache, emptyCloudData } from '../../lib/scopedCache'
import { stockConsumedFromStatus } from '../../lib/orders'
import { cloudLoadMerged, attachSync, pauseSync, resumeSync, activateCloudContext, stopCloudSync,
  getCloudSession, onAuthChange, cloudSignIn, cloudSignUp, cloudSignOut, getMembership,
  createCompanyCloud, acceptInvitation, checkRecovery, applyPasswordReset, subscribeToEvents } from '../../lib/cloud'

let storeRef = null
export function bindStore(store) { storeRef = store }
export const cloudInitialState = {
  authUserId: null, authAccountId: null, authEmail: null, cloud: hasApi, cloudReady: false,
  cloudError: null, syncPending: 0, syncQuarantined: 0, syncLegacy: 0, syncState: 'ok', syncError: null,
  invitationRevision: 0, _authInited: false, _bootBusy: false, needOnboarding: false, inviteError: null,
  recoveryMode: false, resetToken: null, companyId: null, companyName: null, serverSubscription: null,
}
export const createCloudSlice = (set, get) => {
  let lifecycle = 0, boot = null, sseUnsub = null, sseTimer = null
  function clearRealtime() {
    sseUnsub?.(); sseUnsub = null
    if (sseTimer) clearTimeout(sseTimer)
    sseTimer = null
  }
  function transition() {
    lifecycle++; clearRealtime(); stopCloudSync(); companyCache.activate(null)
    set({ ...emptyCloudData(), authUserId: null, authAccountId: null, authEmail: null,
      companyId: null, companyName: null, cloudReady: false, needOnboarding: false,
      serverSubscription: null, _bootBusy: false, cloudError: null })
  }
  const subscriptionData = (r) => r?.ok && r.body ? {
    subscription: r.body.subscription || null, effectivePlan: r.body.effectivePlan,
    limits: r.body.limits, trialDaysLeft: r.body.trialDaysLeft, plans: r.body.plans,
  } : null
  async function bootstrap() {
    if (!hasApi) return
    const context = getAuthContext()
    if (!context.userId) return
    const invitationRevision = getInvitationRevision()
    if (boot?.generation === context.generation && boot.invitationRevision === invitationRevision) return boot.promise
    transition()
    const epoch = lifecycle
    const current = () => epoch === lifecycle && isAuthContextCurrent(context)
    set({ _bootBusy: true })
    const run = async () => {
      let cached = null
      try {
        cached = readCompanyCache(context)
        const session = await getCloudSession()
        if (!current() || !session) return
        if (hasInvitationSecret()) {
          const invited = await acceptInvitation()
          if (!current()) return
          if (invited && invited !== context.companyId) {
            const selected = await setActiveCompany(invited)
            if (!selected.ok) throw new Error(selected.error?.message || 'Не удалось выбрать компанию приглашения')
            return get().bootstrapCloud()
          }
        }
        let membership
        try { membership = await getMembership(context) }
        catch (e) {
          if (!current()) return
          if (!cached || (e.status && e.status < 500)) throw e
          // Cache was created for this exact authenticated user/company only.
          membership = { company_id: context.companyId, role: cached.employees?.find((e) => e.userId === context.userId)?.role || 'stock' }
        }
        if (!current()) return
        if (!membership) {
          const created = await createCompanyCloud('Моя компания')
          if (!current()) return
          if (!created.ok) { set({ needOnboarding: true, authUserId: context.userId }); return }
          const selected = await setActiveCompany(created.companyId)
          if (!selected.ok) throw new Error(selected.error?.message || 'Company selection failed')
          return get().bootstrapCloud()
        }
        if (membership.company_id !== context.companyId) {
          const selected = await setActiveCompany(membership.company_id)
          if (!selected.ok) throw new Error(selected.error?.message || 'Company selection failed')
          return get().bootstrapCloud()
        }
        activateCloudContext(context)
        let fresh, offlineError = null
        try { fresh = await cloudLoadMerged(context) }
        catch (e) {
          if (!current()) return
          if (!cached || (e.status && e.status < 500)) throw e
          fresh = cached; offlineError = e.message
        }
        if (!current()) return
        const data = companyCache.overlayLocal(context, { ...emptyCloudData(), ...cached, ...fresh })
        data.settings = { ...(cached?.settings || emptyCloudData().settings), ...(fresh?.settings || {}) }
        const pins = new Map((cached?.employees || []).map((e) => [e.id, e.pin || '']))
        data.employees = (data.employees || []).map((e) => ({ ...e, pin: pins.get(e.id) || '' }))
        data.orders = (data.orders || []).map((o) => o.stockConsumed == null ? { ...o, stockConsumed: stockConsumedFromStatus(o.status) } : o)
        let me = data.employees.find((e) => e.userId === context.userId && !e.deletedAt)
        if (!me) { me = { id: uid('e'), name: membership.name || session.user.email?.split('@')[0] || 'Сотрудник', role: membership.role || 'stock', userId: context.userId, active: true, pin: '' }; data.employees.push(me) }
        me.role = membership.role // Server membership is authoritative for the signed-in user.
        if (!offlineError) {
          const ensured = await apiEnsureMe({ id: me.id, name: me.name, role: me.role }, context)
          if (!current()) return
          if (ensured.ok && ensured.body?.employee?.id && ensured.body.employee.id !== me.id) {
            const other = data.employees.find((e) => e.id === ensured.body.employee.id)
            if (other) { data.employees = data.employees.filter((e) => e !== me); me = other }
            else me.id = ensured.body.employee.id
          }
        }
        let subscription = null
        try { subscription = subscriptionData(await apiGetSubscription(context)) } catch { /* offline */ }
        if (!current()) return
        companyCache.activate(context)
        pauseSync()
        set({ ...data, companyId: context.companyId, companyName: membership.companies?.name || data.settings.company || 'Компания',
          authAccountId: context.userId, authUserId: me.id, authEmail: session.user.email || null,
          cloudReady: true, needOnboarding: false, cloudError: offlineError, serverSubscription: subscription })
        if (storeRef) { attachSync(storeRef); resumeSync(storeRef) }
        sseUnsub = subscribeToEvents((event) => {
          if (!current() || (event?.companyId && event.companyId !== context.companyId)) return
          if (sseTimer) clearTimeout(sseTimer)
          sseTimer = setTimeout(async () => {
            sseTimer = null
            if (!current()) return
            try {
              const next = await cloudLoadMerged(context)
              if (!current() || !next) return
              pauseSync()
              const patch = {}
              for (const k of ['orders', 'movements', 'audit', 'documents', 'customers', 'products', 'invoices', 'shifts']) if (Array.isArray(next[k])) patch[k] = next[k]
              set(companyCache.overlayLocal(context, { ...get(), ...patch }))
              if (storeRef) resumeSync(storeRef)
            } catch {
              if (current() && companyCache.error()) set({ cloudError: companyCache.error() })
            }
          }, 500)
        })
      } catch (e) {
        if (current()) { stopCloudSync(); companyCache.activate(null); set({ cloudError: e.message || String(e) }) }
      } finally { if (current()) set({ _bootBusy: false }) }
    }
    const promise = run()
    boot = { generation: context.generation, invitationRevision, promise }
    try { await promise } finally { if (boot?.promise === promise) boot = null }
  }
  return {
    initAuth: async () => {
      if (!hasApi || get()._authInited) return
      set({ _authInited: true })
      onInvitationCaptured(() => {
        set({ invitationRevision:getInvitationRevision(), cloudError:null })
        if (getAuthContext().userId) void get().bootstrapCloud()
      })
      onAuthChange((event, _session, metadata) => {
        if (event === 'SIGNED_OUT' && metadata?.reason !== 'BOOTSTRAP_RESET') clearInvitationSecret()
        if (event === 'AUTH_CHANGING' || event === 'SIGNED_OUT') transition()
        if (event === 'COMPANY_CHANGED') { clearInvitationSecret(); transition(); void get().bootstrapCloud() }
        if (event === 'AUTH_SYNC_ERROR') set({ cloudError: getAuthConsistencyError() })
      })
      const token = await checkRecovery()
      if (token) { set({ recoveryMode: true, resetToken: token }); return }
      const result = await apiBootstrap()
      if (result.session || result.offline) await get().bootstrapCloud()
    },
    bootstrapCloud: bootstrap,
    switchCompany: async (companyId) => {
      clearInvitationSecret()
      const result = await setActiveCompany(companyId)
      if (result.ok) await get().bootstrapCloud()
      return result
    },
    createCompany: async (name, userName) => {
      const context = getAuthContext(), epoch = lifecycle
      const current = () => epoch === lifecycle && isAuthContextCurrent(context)
      const result = await createCompanyCloud(name, userName)
      if (!current()) return { ok: false, code: 'CONTEXT_CHANGED', error: 'Сессия создания компании изменилась' }
      if (result.ok) {
        const selected = await setActiveCompany(result.companyId)
        if (!selected.ok) return selected
        // setActiveCompany legitimately advances generation; compare the selected identity.
        const next = getAuthContext()
        if (next.userId !== context.userId || next.companyId !== result.companyId ||
          next.generation !== context.generation + (context.companyId === result.companyId ? 0 : 1)) {
          return { ok: false, code: 'CONTEXT_CHANGED', error: 'Сессия создания компании изменилась' }
        }
        await get().bootstrapCloud()
      }
      return result
    },
    signIn: async (email, password) => {
      transition()
      const result = await cloudSignIn(email, password)
      if (result.ok) await get().bootstrapCloud()
      if (result.ok && hasInvitationSecret() && get().cloudError) return { ok:false,error:get().cloudError }
      return result
    },
    signUp: async (email, password, name, inviteToken) => {
      transition()
      const result = await cloudSignUp(email, password, name, inviteToken)
      if (result.ok && !result.needConfirm) await get().bootstrapCloud()
      if (result.ok && hasInvitationSecret() && get().cloudError) return { ok:false,error:get().cloudError }
      return result
    },
    cloudLogout: async () => { clearInvitationSecret(); transition(); return cloudSignOut() },
    refreshSubscription: async () => {
      const context = getAuthContext(), epoch = lifecycle
      try {
        const result = await apiGetSubscription(context)
        if (epoch === lifecycle && isAuthContextCurrent(context) && result.ok) set({ serverSubscription: subscriptionData(result) })
        return result
      } catch (e) { return { ok: false, error: e.message || 'network error' } }
    },
    completePasswordReset: async (password) => {
      const token = get().resetToken, epoch = lifecycle
      if (!token) return { ok: false, error: 'Токен сброса не найден' }
      const result = await applyPasswordReset(token, password)
      if (result.ok && epoch === lifecycle) {
        if (typeof window !== 'undefined') window.history.replaceState({}, '', window.location.pathname + window.location.search + '#/')
        set({ recoveryMode: false, resetToken: null })
      }
      return result
    },
  }
}
