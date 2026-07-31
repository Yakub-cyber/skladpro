import { useState } from 'react'
import { useStore } from '@/shared/store/useStore'
import Landing from '@/features/landing/LandingPage'
import Connect from '@/features/connect/ConnectPage'
import PinLogin from './components/PinLogin'
import CloudLogin from './components/CloudLogin'

// Router-обёртка для непубличной части «до входа».
//  - authMode=null       → Landing (публичная витрина, hero, тарифы).
//  - authMode='signin'   → форма входа (облачная или PIN — по флагу cloud).
//  - authMode='signup'   → форма регистрации.
//  - showConnect=true    → страница Connect (модули + оплата, вне auth).
// Кнопки Landing и Connect бросают события сюда — единая точка ветвления.
export default function Login() {
  const cloud = useStore((s) => s.cloud)
  const [authMode, setAuthMode] = useState(null)
  const [showConnect, setShowConnect] = useState(false)

  if (authMode) {
    return cloud
      ? <CloudLogin initialMode={authMode} onBack={() => setAuthMode(null)} />
      : <PinLogin onBack={() => setAuthMode(null)} />
  }
  if (showConnect) {
    return <Connect onStart={() => setAuthMode('signin')} onBack={() => setShowConnect(false)} />
  }
  return (
    <Landing
      onStart={() => setAuthMode('signin')}
      onRegister={() => setAuthMode('signup')}
      onConnect={() => setShowConnect(true)}
    />
  )
}

// Реэкспорт для App.jsx — он делает `import Login, { Onboarding, ResetPassword }`.
// Держим публичный контракт стабильным, чтобы не менять App.jsx.
export { default as Onboarding } from './Onboarding'
export { default as ResetPassword } from './ResetPassword'
