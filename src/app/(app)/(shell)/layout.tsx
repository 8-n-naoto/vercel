// 08 3.1 app layout (S04-S07, S10-S14). `(shell)` separates it from `(app)/view`, which has no navigation (08 2.1, 3.3).
import { AppHeader } from '@/components/features/layout/app-header'
import { getActorOrNull } from '@/server/authz/session'

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActorOrNull() // navigation only; never an authorization basis (06 9.1)
  return (
    <>
      <AppHeader actor={actor ? { displayName: actor.displayName, role: actor.role } : null} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</div>
    </>
  )
}
