'use client'
// 08 3.1 user menu. Log out calls auth.signOut (WP-2.1) and goes to /login even when it fails with UNAUTHENTICATED.
// Until that Action exists the layout passes no `signOut`, and the item is not rendered.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ActionResult } from '@/lib/errors'

export function UserMenu({ displayName, signOut }: { displayName: string; signOut?: () => Promise<ActionResult<unknown>> }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          {displayName} ▼
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/account">アカウント設定</Link>
        </DropdownMenuItem>
        {signOut ? (
          <DropdownMenuItem
            disabled={pending}
            onSelect={() =>
              startTransition(async () => {
                await signOut() // a redirecting Action does not return on success
                router.push('/login')
              })
            }
          >
            ログアウト
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
