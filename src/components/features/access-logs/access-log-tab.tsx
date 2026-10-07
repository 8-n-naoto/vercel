// 08 5.5 logs tab body (Server Component): filter form + table + Pagination, or the empty state.
import { EmptyState } from '@/components/features/common/empty-state'
import { Pagination } from '@/components/features/common/pagination'
import type { AccessLogRow, Page } from '@/lib/dto'
import { FOLDER_TEXT } from '@/lib/messages'
import { AccessLogFilter, type LogPeriod } from './access-log-filter'
import { AccessLogTable } from './access-log-table'

/** The query carried by the page links: only the values that are set. */
export function logsQuery(f: { period: LogPeriod; file: string; result: string; via: string }): Record<string, string> {
  const query: Record<string, string> = { tab: 'logs', period: f.period }
  if (f.file) query.file = f.file
  if (f.result) query.result = f.result
  if (f.via) query.via = f.via
  return query
}

export function AccessLogTab({
  folderId,
  list,
  files,
  period,
  file,
  result,
  via,
}: {
  folderId: string
  list: Page<AccessLogRow>
  files: readonly { id: string; displayName: string }[]
  period: LogPeriod
  file: string
  result: string
  via: string
}) {
  return (
    <div>
      <AccessLogFilter period={period} file={file} result={result} via={via} files={files} />
      {list.items.length === 0 ? (
        <EmptyState>{FOLDER_TEXT.logsEmpty}</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <AccessLogTable items={list.items} />
          <Pagination
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            pathname={`/folders/${folderId}`}
            query={logsQuery({ period, file, result, via })}
          />
        </div>
      )}
    </div>
  )
}
