// 08 5.5 logs tab table (pure display, Server Component). The viewer of a share link is "{label}（…{tokenHint}）"; the whole token never reaches here.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { AccessLogRow } from '@/lib/dto'
import { formatDateTime } from '@/lib/format'
import { ACCESS_PURPOSE_LABELS, ACCESS_RESULT_LABELS, ACCESS_VIA_LABELS, DENY_REASON_LABELS } from '@/lib/messages'

export const NO_LABEL_TEXT = '（ラベルなし）'

export function viewerText(v: AccessLogRow['viewer']): string {
  if (v.kind === 'user') return v.displayName
  return `${v.label === '' ? NO_LABEL_TEXT : v.label}（…${v.tokenHint}）`
}

/** granted + delivered -> 済, granted + not delivered -> 未, denied -> empty. */
export function deliveredText(row: Pick<AccessLogRow, 'result' | 'delivered'>): string {
  if (row.result !== 'granted') return ''
  return row.delivered ? '済' : '未'
}

export function AccessLogTable({ items }: { items: readonly AccessLogRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>日時</TableHead>
          <TableHead>ファイル</TableHead>
          <TableHead>経路</TableHead>
          <TableHead>閲覧者</TableHead>
          <TableHead>目的</TableHead>
          <TableHead>結果</TableHead>
          <TableHead>理由</TableHead>
          <TableHead>配信</TableHead>
          <TableHead>詳細</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{formatDateTime(r.occurredAt)}</TableCell>
            <TableCell>{r.file.displayName}</TableCell>
            <TableCell>{ACCESS_VIA_LABELS[r.via]}</TableCell>
            <TableCell>{viewerText(r.viewer)}</TableCell>
            <TableCell>{ACCESS_PURPOSE_LABELS[r.purpose]}</TableCell>
            <TableCell>{ACCESS_RESULT_LABELS[r.result]}</TableCell>
            <TableCell>{r.denyReason ? DENY_REASON_LABELS[r.denyReason] : ''}</TableCell>
            <TableCell>{deliveredText(r)}</TableCell>
            <TableCell>
              <details>
                <summary className="cursor-pointer text-sm">表示</summary>
                <dl className="mt-1 text-xs text-muted-foreground">
                  <dt>IP</dt>
                  <dd className="break-all">{r.ip ?? '—'}</dd>
                  <dt>User-Agent</dt>
                  <dd className="break-all">{r.userAgent ?? '—'}</dd>
                </dl>
              </details>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
