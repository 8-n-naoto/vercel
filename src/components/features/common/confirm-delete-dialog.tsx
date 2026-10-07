'use client'
// 08 4.5 D05. Folder deletion that requires typing the folder name. The server validates the name again (06 6.3).
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionResult } from '@/lib/errors'
import { FieldError, FormError } from './form-message'
import { SubmitButton } from './submit-button'
import { useActionForm } from './use-action-form'

/** Enabled only when the trimmed input equals the name exactly (case-sensitive). */
export function deleteNameMatches(input: string, name: string): boolean {
  return input.trim() === name
}

export function ConfirmDeleteDialog<O>({
  trigger,
  name,
  onConfirm,
  onDone,
}: {
  trigger: React.ReactNode
  /** Folder name to be typed. */
  name: string
  /** Calls the delete Action with { folderId, confirmName }. */
  onConfirm: (confirmName: string) => Promise<ActionResult<O>>
  onDone?: (data: O) => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const { state, pending, onSubmit, fieldError } = useActionForm<{ confirmName: string }, O>({
    action: (input) => onConfirm(input.confirmName),
    toInput: (fd) => ({ confirmName: String(fd.get('confirmName') ?? '').trim() }),
    onSuccess: (data) => {
      setOpen(false)
      onDone?.(data)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) setTyped('')
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus() // initial focus is the input (08 4.5)
        }}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>フォルダを削除</DialogTitle>
            {/* C-05 */}
            <DialogDescription>{`フォルダ「${name}」と、その中のすべてのファイル・公開リンクを削除します。元に戻せません。`}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmName">確認のためフォルダ名を入力してください</Label>
            <Input
              id="confirmName"
              name="confirmName"
              ref={inputRef}
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-invalid={fieldError('confirmName') ? true : undefined}
              aria-describedby={fieldError('confirmName') ? 'confirmName-error' : undefined}
            />
            <FieldError name="confirmName" message={fieldError('confirmName')} />
          </div>
          <FormError error={state && !state.ok ? state.error : null} knownFields={['confirmName']} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <SubmitButton pending={pending} variant="destructive" disabled={!deleteNameMatches(typed, name)}>
              削除する
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
