import { pageContext } from '@/server/page'

// 08 2.1: admin check once per /admin/* request. Each page still declares auth: 'admin' itself (06 9.0).
// A layout cannot know the requested path, so a login redirect from here returns to /admin; the pages' own pageContext carries the exact path.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await pageContext({ route: '/admin', path: '/admin', auth: 'admin' })
  return <>{children}</>
}
