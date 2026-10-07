'use client'
// 08 4.4 D04. Shows a URL once. Render it only while the caller holds the URL in its state; [close] calls onClose and the caller
// drops the URL, so it cannot be shown again. Escape and outside clicks do not close it.
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateTime } from '@/lib/format'

export type OneTimeUrlKind = 'share_link' | 'invite' | 'reset'

// 08 9.4 U-01 .. U-03
export const ONE_TIME_URL_NOTICE: Record<OneTimeUrlKind, string> = {
  share_link: 'この URL は今だけ表示されます。閉じると再表示できません（必要なら再発行）。',
  invite: 'この URL は今だけ表示されます。閉じると再表示できません。1 回限り有効です。本人にだけ渡してください。',
  reset: 'この URL は今だけ表示されます。閉じると再表示できません。1 回限り有効です。本人にだけ渡してください。',
}

export function OneTimeUrlDialog({
  title,
  url,
  expiresAt,
  kind,
  onClose,
}: {
  title: string
  url: string
  expiresAt: string
  kind: OneTimeUrlKind
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (status !== 'copied') return
    const t = setTimeout(() => setStatus('idle'), 2000)
    return () => clearTimeout(t)
  }, [status])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setStatus('copied')
    } catch {
      setStatus('failed')
      inputRef.current?.select()
    }
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{ONE_TIME_URL_NOTICE[kind]}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="one-time-url">URL</Label>
          <Input id="one-time-url" ref={inputRef} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <p className="text-sm">
          有効期限: <time dateTime={expiresAt}>{formatDateTime(expiresAt)}</time>
        </p>
        <div role="status" className="min-h-5 text-sm">
          {status === 'copied' ? 'コピーしました' : null}
          {status === 'failed' ? 'コピーできませんでした。URL を選択して手動でコピーしてください' : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void copy()}>
            コピー
          </Button>
          <Button type="button" onClick={onClose}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
