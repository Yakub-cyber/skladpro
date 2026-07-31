import { Boxes } from 'lucide-react'

export default function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-9 w-9 rounded-xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30">
        <Boxes size={20} strokeWidth={2.3} />
      </div>
      <div className="leading-none">
        <div className="font-semibold tracking-tight text-[15px]">
          Склад<span className="text-brand">Про</span>
        </div>
        <div className="text-[10px] text-muted mt-0.5 tracking-wide uppercase">
          AI Warehouse
        </div>
      </div>
    </div>
  )
}
