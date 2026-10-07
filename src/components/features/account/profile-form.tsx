'use client'
// 08 5.14 S14 profile section. The display name stays as typed after saving (08 6.1); the navigation is refreshed by revalidatePath in the Action.
import type { FormEvent } from 'react'
import { accountUpdateProfile } from '@/app/_actions/account'
import { FieldError, FormError, FormSuccess } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm, type ActionFormState } from '@/components/features/common/use-action-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { UserRole } from '@/lib/domain'
import { USER_ROLE_LABELS } from '@/lib/messages'

export const PROFILE_SAVED_TEXT = '保存しました'
const FIELDS = ['displayName'] as const

export interface ProfileFormViewProps {
  email: string
  role: UserRole
  displayName: string
  state: ActionFormState<unknown>
  pending: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  fieldError: (name: string) => string | undefined
}

/** Pure view: every branch is decided by its props so it can be rendered in tests without a DOM. */
export function ProfileFormView({ email, role, displayName, state, pending, onSubmit, fieldError }: ProfileFormViewProps) {
  const nameError = fieldError('displayName')
  return (
    <section aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="mb-3 text-lg font-semibold">
        プロフィール
      </h2>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
        {state !== null && state.ok ? <FormSuccess>{PROFILE_SAVED_TEXT}</FormSuccess> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">メールアドレス</Label>
          <Input id="email" name="email" type="email" value={email} readOnly autoComplete="email" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">役割</span>
          <p>{USER_ROLE_LABELS[role]}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="displayName">表示名</Label>
          <Input
            id="displayName"
            name="displayName"
            type="text"
            defaultValue={displayName}
            autoComplete="nickname"
            maxLength={50}
            required
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'displayName-error' : undefined}
          />
          <FieldError name="displayName" message={nameError} />
        </div>
        <div>
          <SubmitButton pending={pending}>保存</SubmitButton>
        </div>
      </form>
    </section>
  )
}

export function ProfileForm({ email, role, displayName }: { email: string; role: UserRole; displayName: string }) {
  const { state, pending, onSubmit, fieldError } = useActionForm({
    action: accountUpdateProfile,
    toInput: (fd) => {
      const v = fd.get('displayName')
      return { displayName: typeof v === 'string' ? v : '' } // trimming and length are checked by the server zod (08 6.2)
    },
  })
  return <ProfileFormView email={email} role={role} displayName={displayName} state={state} pending={pending} onSubmit={onSubmit} fieldError={fieldError} />
}
