// 08 5.5 logs tab filter: a plain GET form (no client JS). It always carries tab=logs; page is dropped so a new filter starts at page 1.
import { Button } from '@/components/ui/button'
import { ACCESS_RESULTS, ACCESS_VIAS } from '@/lib/domain'
import { ACCESS_RESULT_LABELS, ACCESS_VIA_LABELS } from '@/lib/messages'

export const LOG_PERIODS = [
  { value: '1d', label: '24 時間', ms: 24 * 3600_000 },
  { value: '7d', label: '7 日', ms: 7 * 24 * 3600_000 },
  { value: '30d', label: '30 日', ms: 30 * 24 * 3600_000 },
  { value: 'all', label: 'すべて', ms: null },
] as const
export type LogPeriod = (typeof LOG_PERIODS)[number]['value']
export const DEFAULT_LOG_PERIOD: LogPeriod = '7d'

/** Invalid or missing -> 7d. */
export function parseLogPeriod(v: string | string[] | undefined): LogPeriod {
  const s = Array.isArray(v) ? v[0] : v
  return LOG_PERIODS.find((p) => p.value === s)?.value ?? DEFAULT_LOG_PERIOD
}

/** `from` (ISO) for a period, or undefined for "all". */
export function periodFrom(period: LogPeriod, now: Date): string | undefined {
  const ms = LOG_PERIODS.find((p) => p.value === period)?.ms ?? null
  return ms === null ? undefined : new Date(now.getTime() - ms).toISOString()
}

const SELECT_CLASS = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

export function AccessLogFilter({
  period,
  file,
  result,
  via,
  files,
}: {
  period: LogPeriod
  file: string
  result: string
  via: string
  files: readonly { id: string; displayName: string }[]
}) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="tab" value="logs" />
      <Field id="log-period" label="期間">
        <select id="log-period" name="period" defaultValue={period} className={SELECT_CLASS}>
          {LOG_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="log-file" label="ファイル">
        <select id="log-file" name="file" defaultValue={file} className={SELECT_CLASS}>
          <option value="">すべて</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field id="log-result" label="結果">
        <select id="log-result" name="result" defaultValue={result} className={SELECT_CLASS}>
          <option value="">すべて</option>
          {ACCESS_RESULTS.map((r) => (
            <option key={r} value={r}>
              {ACCESS_RESULT_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="log-via" label="経路">
        <select id="log-via" name="via" defaultValue={via} className={SELECT_CLASS}>
          <option value="">すべて</option>
          {ACCESS_VIAS.map((v) => (
            <option key={v} value={v}>
              {ACCESS_VIA_LABELS[v]}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit">絞り込む</Button>
    </form>
  )
}
