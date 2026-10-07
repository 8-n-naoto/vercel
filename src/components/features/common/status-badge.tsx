// 08 4.12 / 07 11. Label and colour for a state. Colour is never the only signal: the label text is always rendered (08 8 A-6).
import { Badge } from '@/components/ui/badge'
import type { FileDisplayState, InviteState, ShareLinkState } from '@/lib/domain'
import { formatMonthDayTime } from '@/lib/format'
import { FILE_DISPLAY_STATE_LABELS, INVITE_STATE_LABELS, SHARE_LINK_STATE_LABELS, USER_STATUS_LABELS } from '@/lib/messages'
import { cn } from '@/lib/utils'

type Tone = 'green' | 'blue' | 'yellow' | 'gray'

// Text colours keep AA contrast on their tinted backgrounds (08 8 A-11).
const TONE_CLASS: Record<Tone, string> = {
  green: 'bg-green-100 text-green-900',
  blue: 'bg-blue-100 text-blue-900',
  yellow: 'bg-yellow-100 text-yellow-900',
  gray: 'bg-gray-100 text-gray-800',
}

export type StatusBadgeProps =
  | { kind: 'file'; value: FileDisplayState; viewStartsAt?: string | null }
  | { kind: 'link'; value: ShareLinkState }
  | { kind: 'invite'; value: InviteState }
  | { kind: 'user'; value: 'enabled' | 'disabled' }

/** Pure: label and tone for a badge. Exported for tests. */
export function statusBadgeView(p: StatusBadgeProps): { label: string; tone: Tone } {
  switch (p.kind) {
    case 'file': {
      const base = FILE_DISPLAY_STATE_LABELS[p.value]
      if (p.value === 'public') return { label: base, tone: 'green' }
      if (p.value === 'not_started') {
        const label = p.viewStartsAt ? `${base}（${formatMonthDayTime(p.viewStartsAt)}〜）` : base
        return { label, tone: 'blue' }
      }
      return { label: base, tone: 'gray' }
    }
    case 'link': {
      const label = SHARE_LINK_STATE_LABELS[p.value]
      if (p.value === 'active') return { label, tone: 'green' }
      if (p.value === 'limit_reached') return { label, tone: 'yellow' }
      return { label, tone: 'gray' }
    }
    case 'invite':
      return { label: INVITE_STATE_LABELS[p.value], tone: p.value === 'open' ? 'green' : 'gray' }
    case 'user':
      return { label: USER_STATUS_LABELS[p.value], tone: p.value === 'enabled' ? 'green' : 'gray' }
  }
}

export function StatusBadge(props: StatusBadgeProps) {
  const { label, tone } = statusBadgeView(props)
  return (
    <Badge variant="outline" className={cn('border-transparent', TONE_CLASS[tone])}>
      {label}
    </Badge>
  )
}
