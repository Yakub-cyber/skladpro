import { useState } from 'react'
import { Moon, Palette, Sun } from 'lucide-react'
import { Section } from '@/shared/ui'

// Переключатель темы. Тема хранится в localStorage.sklad.theme и применяется
// через className='dark' на <html>. Начальное значение подхватывается в
// index.html до React (иначе на первый кадр видно светлую), см. main.jsx.
export default function AppearanceSection() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  )

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle('dark')
    localStorage.setItem('sklad.theme', isDark ? 'dark' : 'light')
    setDark(isDark)
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Palette size={16} className="text-brand" /> Внешний вид
        </span>
      }
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">Тема оформления</div>
          <div className="text-[13px] text-muted">Тёмная или светлая</div>
        </div>
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 h-10 px-4 rounded-xl bg-surface-2 hover:bg-surface-3 text-sm font-medium"
        >
          {dark ? <Moon size={16} /> : <Sun size={16} />}
          {dark ? 'Тёмная' : 'Светлая'}
        </button>
      </div>
    </Section>
  )
}
