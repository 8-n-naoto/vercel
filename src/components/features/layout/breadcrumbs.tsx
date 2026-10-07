// 08 3.1 breadcrumbs. Every item links to its parent screen except the last one.
import Link from 'next/link'

export interface Crumb {
  label: string
  href?: string
}

export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  if (items.length === 0) return null
  return (
    <nav aria-label="パンくず" className="mb-3 text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${i}-${c.label}`} className="flex items-center gap-1">
              {last || !c.href ? (
                <span aria-current={last ? 'page' : undefined}>{c.label}</span>
              ) : (
                <Link href={c.href} className="underline underline-offset-4">
                  {c.label}
                </Link>
              )}
              {last ? null : <span aria-hidden="true">&gt;</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
