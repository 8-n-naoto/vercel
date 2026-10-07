'use client'
// 08 4.3. AlertDialog with [cancel] and a confirm button. Initial focus is [cancel] (Radix AlertDialog default).
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { ActionResult, AppErrorShape } from '@/lib/errors'
import { FormError } from './form-message'
import { handleCommonError } from './handle-common-error'

export function ConfirmDialog<O>({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onDone,
}: {
  /** The element that opens the dialog (a Button). Focus returns to it on close. */
  trigger: React.ReactNode
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<ActionResult<O>>
  onDone?: (data: O) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppErrorShape | null>(null)

  const run = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const r = await onConfirm()
      if (r.ok) {
        setOpen(false)
        onDone?.(r.data)
      } else {
        setError(r.error)
        handleCommonError(r.error, router)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <FormError error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={(e) => {
              e.preventDefault() // keep the dialog open until the Action finishes; failures stay visible
              void run()
            }}
          >
            {pending ? '処理中…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
