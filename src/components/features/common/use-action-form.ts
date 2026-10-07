'use client'
// The single place where useActionState is used for forms (08 7.2). The Action is called as a function, not through <form action>.
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { ActionResult, AppErrorShape } from '@/lib/errors'
import { message } from '@/lib/messages'
import { handleCommonError } from './handle-common-error'

export type ActionFormState<O> = ActionResult<O> | null

/** Client-side validation failure shaped like VALIDATION_FAILED (08 7.2). */
export function clientValidationFailed(clientError: Record<string, string>): { ok: false; error: AppErrorShape } {
  const fieldErrors: Record<string, string[]> = {}
  for (const [name, text] of Object.entries(clientError)) fieldErrors[name] = [text]
  return { ok: false, error: { code: 'VALIDATION_FAILED', message: message('common.validation_failed'), fieldErrors } }
}

export function isClientError<I>(v: I | { clientError: Record<string, string> }): v is { clientError: Record<string, string> } {
  return typeof v === 'object' && v !== null && 'clientError' in v
}

export interface UseActionFormOptions<I, O> {
  action: (input: I) => Promise<ActionResult<O>>
  toInput: (fd: FormData) => I | { clientError: Record<string, string> }
  onSuccess?: (data: O) => void
}

export function useActionForm<I, O>(opts: UseActionFormOptions<I, O>): {
  state: ActionFormState<O>
  pending: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  fieldError: (name: string) => string | undefined
} {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)

  const [state, dispatch, pending] = useActionState<ActionFormState<O>, FormData>(async (_prev, fd) => {
    const input = opts.toInput(fd)
    if (isClientError(input)) return clientValidationFailed(input.clientError)
    const r = await opts.action(input)
    if (r.ok) opts.onSuccess?.(r.data)
    else handleCommonError(r.error, router)
    return r
  }, null)

  // Move focus to the first field that has an error (08 7.3, 8 A-2).
  useEffect(() => {
    if (state === null || state.ok) return
    const names = Object.keys(state.error.fieldErrors ?? {})
    const form = formRef.current
    if (form === null) return
    for (const n of names) {
      const el = form.elements.namedItem(n)
      if (el instanceof HTMLElement) {
        el.focus()
        return
      }
    }
  }, [state])

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault() // not <form action>: React 19 would reset the form after the action
    if (pending) return
    formRef.current = e.currentTarget
    const fd = new FormData(e.currentTarget)
    startTransition(() => dispatch(fd))
  }

  const fieldError = (name: string): string | undefined => (state !== null && !state.ok ? state.error.fieldErrors?.[name]?.[0] : undefined)

  return { state, pending, onSubmit, fieldError }
}
