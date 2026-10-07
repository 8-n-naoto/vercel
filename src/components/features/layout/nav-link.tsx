'use client'
// Header link that marks the current section with aria-current="page" (08 3.1).
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const current = pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link href={href} aria-current={current ? 'page' : undefined} className="text-sm underline-offset-4 hover:underline aria-[current=page]:font-semibold">
      {children}
    </Link>
  )
}
