// 08 4.13. Links keep the current query and only change `page`. Disabled ends are aria-disabled spans.
import Link from 'next/link'

export function totalPagesOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/** Non-numeric or < 1 -> 1 (06 1.5). */
export function parsePageParam(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v
  const n = s === undefined ? NaN : Number(s)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

function hrefFor(pathname: string, query: Record<string, string>, page: number): string {
  const p = new URLSearchParams(query)
  p.set('page', String(page))
  return `${pathname}?${p.toString()}`
}

export function Pagination({
  page,
  pageSize,
  total,
  pathname,
  query = {},
}: {
  page: number
  pageSize: number
  total: number
  pathname: string
  query?: Record<string, string>
}) {
  if (total === 0) return null
  const pages = totalPagesOf(total, pageSize)
  const cur = Math.min(Math.max(1, page), pages)
  const base = 'rounded-md border px-3 py-1 text-sm'
  return (
    <nav aria-label="ページ送り" className="flex items-center justify-center gap-3">
      {cur > 1 ? (
        <Link href={hrefFor(pathname, query, cur - 1)} className={base}>
          &lt; 前へ
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} opacity-50`}>
          &lt; 前へ
        </span>
      )}
      <span className="text-sm">
        {cur} / {pages}
      </span>
      {cur < pages ? (
        <Link href={hrefFor(pathname, query, cur + 1)} className={base}>
          次へ &gt;
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} opacity-50`}>
          次へ &gt;
        </span>
      )}
    </nav>
  )
}
