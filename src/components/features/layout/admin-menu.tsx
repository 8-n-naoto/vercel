'use client'
// 08 3.1 admin menu. Rendered only for admins (UX only; authorization is on the server).
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const ITEMS = [
  { href: '/admin/invites', label: '招待' },
  { href: '/admin/users', label: 'ユーザー' },
  { href: '/admin/folders', label: 'フォルダ（全体）' },
  { href: '/admin/audit', label: 'ダッシュボード・監査ログ' },
] as const

export function AdminMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          管理 ▼
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ITEMS.map((i) => (
          <DropdownMenuItem key={i.href} asChild>
            <Link href={i.href}>{i.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
