'use client'
// 08 5.10 S10 InviteForm. On success the one-time URL is held in this component's state only (D04-2) and the form is emptied by remounting it.
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { adminCreateInvite } from '@/app/_actions/admin'
import { FieldError, FormError } from '@/components/features/common/form-message'
import { OneTimeUrlDialog } from '@/components/features/common/one-time-url-dialog'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm, type ActionFormState } from '@/components/features/common/use-action-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { UserRole } from '@/lib/domain'
import { USER_ROLE_LABELS } from '@/lib/messages'

// 08 9.4 S10-N1
export const INVITE_NOTE = '※ 同じメールアドレスの未使用の招待は自動的に取り消されます'
export const INVITE_URL_TITLE = '招待 URL'
const FIELDS = ['email', 'role'] as const
// "一般ユーザー（既定）/ 管理者" (08 5.10)
const ROLE_OPTIONS: readonly UserRole[] = ['user', 'admin']

export interface IssuedInvite {
  url: string
  expiresAt: string
}

export interface InviteFormViewProps {
  state: ActionFormState<unknown>
  pending: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  fieldError: (name: string) => string | undefined
  issued: IssuedInvite | null
  onCloseUrl: () => void
  /** Changing it remounts the form, which empties it (08 7.5). */
  formKey: number
}

/** Pure view: every branch of S10 issuing is decided by its props, so it can be rendered in tests without a DOM. */
export function InviteFormView({ state, pending, onSubmit, fieldError, issued, onCloseUrl, formKey }: InviteFormViewProps) {
  const emailError = fieldError('email')
  return (
    <section aria-label="招待の発行" className="mb-6">
      <form key={formKey} onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:max-w-xl">
        <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">メールアドレス</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            maxLength={254}
            required
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'email-error' : undefined}
          />
          <FieldError name="email" message={emailError} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">役割</Label>
          <Select name="role" defaultValue="user">
            <SelectTrigger id="role" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {USER_ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError name="role" message={fieldError('role')} />
        </div>
        <div>
          <SubmitButton pending={pending}>招待 URL を発行</SubmitButton>
        </div>
        <p className="text-sm text-muted-foreground">{INVITE_NOTE}</p>
      </form>
      {issued ? <OneTimeUrlDialog title={INVITE_URL_TITLE} kind="invite" url={issued.url} expiresAt={issued.expiresAt} onClose={onCloseUrl} /> : null}
    </section>
  )
}

export function InviteForm() {
  const router = useRouter()
  const [issued, setIssued] = useState<IssuedInvite | null>(null)
  const [formKey, setFormKey] = useState(0)
  const { state, pending, onSubmit, fieldError } = useActionForm({
    action: adminCreateInvite,
    toInput: (fd) => {
      const email = fd.get('email')
      const role = fd.get('role')
      if (typeof email !== 'string' || email.trim().length === 0) return { clientError: { email: '入力してください' } }
      const r: UserRole = role === 'admin' ? 'admin' : 'user'
      return { email: email.trim(), role: r }
    },
    onSuccess: (data) => {
      setIssued({ url: data.inviteUrl, expiresAt: data.expiresAt })
      setFormKey((k) => k + 1)
      router.refresh()
    },
  })
  return (
    <InviteFormView
      state={state}
      pending={pending}
      onSubmit={onSubmit}
      fieldError={fieldError}
      issued={issued}
      onCloseUrl={() => setIssued(null)}
      formKey={formKey}
    />
  )
}
