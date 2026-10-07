'use client'
// 08 5.5 files tab: sort Select. A change rewrites ?sort= with router.replace. The values mirror FILE_SORTS of services/files.ts
// (that module is server-only, so the three literals are repeated here).
import { useRouter } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const SORT_OPTIONS = [
  { value: 'updated_desc', label: '更新日時（新しい順）' },
  { value: 'name_asc', label: '名前順' },
  { value: 'size_desc', label: 'サイズ（大きい順）' },
] as const
export type SortValue = (typeof SORT_OPTIONS)[number]['value']

export function sortHref(folderId: string, sort: SortValue): string {
  return `/folders/${folderId}?sort=${sort}`
}

export function FileSortSelect({ folderId, sort }: { folderId: string; sort: SortValue }) {
  const router = useRouter()
  return (
    <div className="mb-3 flex items-center gap-2">
      <Label htmlFor="file-sort">並べ替え</Label>
      <Select
        value={sort}
        onValueChange={(v) => {
          const next = SORT_OPTIONS.find((o) => o.value === v)
          if (next !== undefined) router.replace(sortHref(folderId, next.value))
        }}
      >
        <SelectTrigger id="file-sort" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
