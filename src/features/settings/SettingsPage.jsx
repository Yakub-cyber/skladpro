import { useStore } from '@/shared/store/useStore'
import { useCurrentUser } from '@/app/layout/utils'
import { CompanySection } from './sections/CompanySection'
import RequisitesSection from './sections/RequisitesSection'
import PriceTypesSection from './sections/PriceTypesSection'
import PasswordSection from './sections/PasswordSection'
import AiSection from './sections/AiSection'
import AppearanceSection from './sections/AppearanceSection'
import DataSection from './sections/DataSection'
import IntegrationsSection from './sections/IntegrationsSection'
import GdprSection from './sections/GdprSection'
import FeatureGatesSection from './sections/FeatureGatesSection'

export default function Settings() {
  const cloud = useStore((s) => s.cloud)
  const companyName = useStore((s) => s.companyName)
  const me = useCurrentUser()

  return (
    <div className="animate-fadeUp max-w-3xl space-y-5">
      <h2 className="text-xl font-semibold tracking-tight">Настройки</h2>

      <CompanySection />
      <RequisitesSection />
      <PriceTypesSection />
      {cloud && <PasswordSection companyName={companyName} />}
      {me.role === 'admin' && <FeatureGatesSection />}
      <AiSection />
      <AppearanceSection />
      <DataSection cloud={cloud} />
      <IntegrationsSection />
      <GdprSection />
      <p className="text-center text-[12px] text-muted py-2">
        СкладПро · SaaS для управления складом и продажами
      </p>
    </div>
  )
}
