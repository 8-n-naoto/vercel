// Common handling of Action errors (08 7.3). Display of message / retryAfterSec is done by FormError (08 4.1).
import type { AppErrorShape } from '@/lib/errors'

export interface RouterLike {
  push: (href: string) => void
}

/** Login URL that returns to the page the user was on. Pure, so it can be tested. */
export function loginRedirectUrl(pathnameWithSearch: string): string {
  return `/login?next=${encodeURIComponent(pathnameWithSearch)}`
}

/** Side effects only. UNAUTHENTICATED -> /login?next=<current location>; every other code is shown by the form. Client only. */
export function handleCommonError(error: AppErrorShape, router: RouterLike): void {
  if (error.code === 'UNAUTHENTICATED') {
    router.push(loginRedirectUrl(window.location.pathname + window.location.search))
  }
}
