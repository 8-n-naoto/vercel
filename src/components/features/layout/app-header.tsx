// 08 3.1 app header. `actor` comes from getActorOrNull() in the layout; null shows only the logo.
import Link from 'next/link'
import type { ActionResult } from '@/lib/errors'
import { AdminMenu } from './admin-menu'
import { NavLink } from './nav-link'
import { UserMenu } from './user-menu'

export interface HeaderActor {
  displayName: string
  role: 'admin' | 'user'
}

export function AppHeader({ actor, signOut }: { actor: HeaderActor | null; signOut?: () => Promise<ActionResult<unknown>> }) {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/folders" className="font-semibold">
          ファイル共有
        </Link>
        {actor ? (
          <>
            <NavLink href="/folders">フォルダ</NavLink>
            {actor.role === 'admin' ? <AdminMenu /> : null}
            <div className="ml-auto">
              <UserMenu displayName={actor.displayName} signOut={signOut} />
            </div>
          </>
        ) : null}
      </div>
    </header>
  )
}
