import { redirect } from 'next/navigation'
import { pageContext } from '@/server/page'

// 08 2.1: "/" only redirects to the folder list. The user auth declaration makes an unauthenticated visitor go to /login first (06 9.0).
export default async function Home() {
  await pageContext({ route: '/', path: '/', auth: 'user' })
  redirect('/folders')
}
