import { Badge, Section } from '@/shared/ui'
import { NAV } from '@/app/layout/nav'
import { ROLES } from '@/shared/lib/constants'

const PERM_LABEL = NAV.reduce((m, n) => {
  m[n.perm] = n.label
  return m
}, {})

export default function RolesGrid() {
  return (
    <Section title="Роли и права доступа">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {ROLES.map((r) => (
          <div key={r.key} className="rounded-xl border border-line p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 h-3 rounded-full" style={{ background: r.color }} />
              <span className="font-medium text-sm">{r.label}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {r.access === '*' ? (
                <Badge tone="brand">Полный доступ</Badge>
              ) : (
                r.access
                  .filter((p) => PERM_LABEL[p])
                  .map((p) => (
                    <span
                      key={p}
                      className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-muted"
                    >
                      {PERM_LABEL[p]}
                    </span>
                  ))
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
