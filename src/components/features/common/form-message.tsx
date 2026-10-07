// FormError / FieldError / FormSuccess (08 4.1). Text comes from the server (error.message); it is never built from the code here.
import type { AppErrorShape } from '@/lib/errors'
import { formatRetryAfter } from '@/lib/format'

/** Whole-form error. UNAUTHENTICATED shows nothing (the page navigates to /login). */
export function FormError({ error, knownFields }: { error: AppErrorShape | null | undefined; knownFields?: readonly string[] }) {
  if (!error || error.code === 'UNAUTHENTICATED') return null
  const text = error.code === 'RATE_LIMITED' && error.retryAfterSec !== undefined ? `${error.message}${formatRetryAfter(error.retryAfterSec)}` : error.message
  // Field errors for names that have no input on the screen would otherwise be invisible (08 7.3).
  const orphan = knownFields
    ? Object.entries(error.fieldErrors ?? {})
        .filter(([name]) => !knownFields.includes(name))
        .map(([, msgs]) => msgs[0])
        .filter((m): m is string => m !== undefined)
    : []
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p>{text}</p>
      {orphan.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  )
}

/** Field error under an input. Pair the input with aria-invalid and aria-describedby="{name}-error". */
export function FieldError({ name, message }: { name: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={`${name}-error`} className="text-sm text-destructive">
      {message}
    </p>
  )
}

export function FormSuccess({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <div role="status" className="rounded-lg border border-green-600/30 bg-green-50 px-3 py-2 text-sm text-green-900">
      {children}
    </div>
  )
}
