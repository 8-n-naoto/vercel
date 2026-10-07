'use client'
// 08 5.5 settings tab: FolderSettingsForm and the danger zone (D05). Admin only: the page renders it only when access is admin.
import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'
import { foldersUpdate } from '@/app/_actions/folders'
import { FieldError, FormError, FormSuccess } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm, type ActionFormState } from '@/components/features/common/use-action-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FOLDER_TEXT } from '@/lib/messages'
import { DeleteFolderButton } from './delete-folder-button'

const FIELDS = ['name', 'description'] as const

export interface FolderSettingsFormViewProps {
  name: string
  description: string
  state: ActionFormState<unknown>
  pending: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  fieldError: (name: string) => string | undefined
}

export function FolderSettingsFormView({ name, description, state, pending, onSubmit, fieldError }: FolderSettingsFormViewProps) {
  const nameError = fieldError('name')
  const descError = fieldError('description')
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 sm:max-w-xl">
      <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
      {state !== null && state.ok ? <FormSuccess>{FOLDER_TEXT.saved}</FormSuccess> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-name">フォルダ名（必須）</Label>
        <Input
          id="settings-name"
          name="name"
          type="text"
          defaultValue={name}
          maxLength={100}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'name-error' : undefined}
        />
        <FieldError name="name" message={nameError} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-description">説明</Label>
        <Textarea
          id="settings-description"
          name="description"
          defaultValue={description}
          maxLength={500}
          rows={4}
          aria-invalid={descError ? true : undefined}
          aria-describedby={descError ? 'description-error' : undefined}
        />
        <FieldError name="description" message={descError} />
      </div>
      <div>
        <SubmitButton pending={pending}>保存</SubmitButton>
      </div>
    </form>
  )
}

export function FolderSettingsForm({ folderId, name, description }: { folderId: string; name: string; description: string }) {
  const router = useRouter()
  const { state, pending, onSubmit, fieldError } = useActionForm({
    action: foldersUpdate,
    toInput: (fd) => ({
      folderId,
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? ''),
    }),
    onSuccess: () => router.refresh(), // the header shows the saved name
  })
  return <FolderSettingsFormView name={name} description={description} state={state} pending={pending} onSubmit={onSubmit} fieldError={fieldError} />
}

/** Settings tab body: the form and the danger zone. */
export function FolderSettings({ folderId, name, description }: { folderId: string; name: string; description: string }) {
  return (
    <div className="flex flex-col gap-10">
      <FolderSettingsForm folderId={folderId} name={name} description={description} />
      <section aria-labelledby="danger-heading" className="rounded-lg border border-destructive/40 p-4 sm:max-w-xl">
        <h2 id="danger-heading" className="mb-3 text-lg font-semibold text-destructive">
          危険な操作
        </h2>
        <DeleteFolderButton folderId={folderId} name={name} after="redirect" />
      </section>
    </div>
  )
}
