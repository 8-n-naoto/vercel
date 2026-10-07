// 08 4.15. Always Japan time 'YYYY/MM/DD HH:mm' (no relative time: server and client would differ).
import { formatDateTime } from '@/lib/format'

export function DateTime({ iso }: { iso: string | null }) {
  if (iso === null) return <>{formatDateTime(null)}</>
  return <time dateTime={iso}>{formatDateTime(iso)}</time>
}
