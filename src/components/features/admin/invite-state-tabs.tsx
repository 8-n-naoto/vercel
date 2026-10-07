// 08 5.10 state switch links. The query parameter "state" is one of INVITE_STATES; anything else (or nothing) means all.
import Link from 'next/link'
import { INVITE_STATES, type InviteState } from '@/lib/domain'
import { INVITE_STATE_LABELS } from '@/lib/messages'

export function parseInviteState(v: string | string[] | undefined): InviteState | undefined {
  const s = Array.isArray(v) ? v[0] : v
  return INVITE_STATES.find((x) => x === s)
}

export function InviteStateTabs({ current, pathname }: { current: InviteState | undefined; pathname: string }) {
  const items: { label: string; value: InviteState | undefined }[] = [
    { label: 'すべて', value: undefined },
    ...INVITE_STATES.map((s) => ({ label: INVITE_STATE_LABELS[s], value: s })),
  ]
  return (
    <nav aria-label="状態の切り替え" className="mb-3 flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.value ? `${pathname}?state=${i.value}` : pathname}
          aria-current={i.value === current ? 'page' : undefined}
          className={`rounded-md border px-3 py-1 text-sm ${i.value === current ? 'bg-muted font-medium' : ''}`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  )
}
