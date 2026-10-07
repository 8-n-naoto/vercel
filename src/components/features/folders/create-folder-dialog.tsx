'use client'
// 08 4.6 D01. Rendered for admins only (UX; folders.create is auth: admin on the server).
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { foldersCreate } from '@/app/_actions/folders'
import { FieldError, FormError } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm, type ActionFormState } from '@/components/features/common/use-action-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const FIELDS = ['name', 'description'] as const

export interface CreateFolderFormViewProps {
  state: ActionFormState<unknown>
  pending: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  fieldError: (name: string) => string | undefined
  onCancel?: () => void
}

/** Pure view of the form (rendered in tests without a DOM). Values are kept on error because the form is never reset (08 6.1). */
export function CreateFolderFormView({ state, pending, onSubmit, fieldError, onCancel }: CreateFolderFormViewProps) {
  const nameError = fieldError('name')
  const descError = fieldError('description')
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="folder-name">フォルダ名（必須）</Label>
        <Input
          id="folder-name"
          name="name"
          type="text"
          maxLength={100}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'name-error' : undefined}
        />
        <FieldError name="name" message={nameError} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="folder-description">説明</Label>
        <Textarea
          id="folder-description"
          name="description"
          maxLength={500}
          rows={3}
          aria-invalid={descError ? true : undefined}
          aria-describedby={descError ? 'description-error' : undefined}
        />
        <FieldError name="description" message={descError} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          キャンセル
        </Button>
        <SubmitButton pending={pending}>作成</SubmitButton>
      </DialogFooter>
    </form>
  )
}

// The hook lives here, inside DialogContent, so that every opening starts from a clean state.
function CreateFolderForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter()
  const { state, pending, onSubmit, fieldError } = useActionForm({
    action: foldersCreate,
    toInput: (fd) => ({
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? ''),
    }), // trimmed by the server zod
    onSuccess: (data) => router.push(`/folders/${data.folderId}`),
  })
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>フォルダ作成</DialogTitle>
      </DialogHeader>
      <CreateFolderFormView state={state} pending={pending} onSubmit={onSubmit} fieldError={fieldError} onCancel={onCancel} />
    </div>
  )
}

export function CreateFolderDialog() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">+ フォルダ作成</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <CreateFolderForm onCancel={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
