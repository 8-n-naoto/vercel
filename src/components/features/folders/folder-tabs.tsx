// 08 5.5 tab links. The visible set depends on `access` from folders.getDetail (RSC); hiding is UX, the server still authorizes (06).
import Link from 'next/link'

export const FOLDER_TABS = ['files', 'members', 'logs', 'settings'] as const
export type FolderTab = (typeof FOLDER_TABS)[number]
export type FolderAccess = 'admin' | 'member'

const LABELS: Record<FolderTab, string> = {
  files: 'ファイル',
  members: 'メンバー',
  logs: '閲覧ログ',
  settings: '設定',
}
const ADMIN_ONLY: readonly FolderTab[] = ['logs', 'settings']

export function visibleTabs(access: FolderAccess): FolderTab[] {
  return FOLDER_TABS.filter((t) => access === 'admin' || !ADMIN_ONLY.includes(t))
}

/** An unknown value, or an admin-only tab for a member, is 'files' (08 5.5, S05-1). */
export function parseFolderTab(v: string | string[] | undefined, access: FolderAccess): FolderTab {
  const s = Array.isArray(v) ? v[0] : v
  return visibleTabs(access).find((t) => t === s) ?? 'files'
}

export function FolderTabs({ folderId, current, access }: { folderId: string; current: FolderTab; access: FolderAccess }) {
  return (
    <nav aria-label="表示の切り替え" className="mb-4 flex flex-wrap gap-2 border-b pb-2">
      {visibleTabs(access).map((t) => (
        <Link
          key={t}
          href={t === 'files' ? `/folders/${folderId}` : `/folders/${folderId}?tab=${t}`}
          aria-current={t === current ? 'page' : undefined}
          className={`rounded-md border px-3 py-1 text-sm ${t === current ? 'bg-muted font-medium' : ''}`}
        >
          {LABELS[t]}
        </Link>
      ))}
    </nav>
  )
}
