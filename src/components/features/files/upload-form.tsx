'use client'
// 08 5.6 S06 upload form. States: idle -> starting -> uploading(%) -> finalizing -> done | failed (failed returns to idle with an error).
// The transfer itself lives in lib/upload-client.ts (testable without a DOM); this component only wires state, Actions and the DOM.
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { filesCancelUpload, filesFinalizeUpload, filesStartUpload } from '@/app/_actions/files'
import { FieldError, FormError } from '@/components/features/common/form-message'
import { handleCommonError } from '@/components/features/common/handle-common-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import type { UploadContext } from '@/lib/dto'
import type { AppErrorShape } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { FILE_TEXT } from '@/lib/messages'
import {
  bytesToMb,
  defaultDisplayName,
  runUploadFlow,
  uploadWithProgress,
  validateUploadFile,
  type UploadFlowDeps,
  type UploadPhase,
} from '@/lib/upload-client'

const ACCEPT = '.html,.htm,text/html'
const BUSY: readonly UploadPhase['kind'][] = ['starting', 'uploading', 'finalizing', 'done']

export interface UploadFormViewProps {
  ctx: UploadContext
  file: { name: string; size: number } | null
  displayName: string
  selectError: string | null
  /** Non-error notices: S06-M1 (several files dropped) and S06-M2 (cancelled). */
  notice: string | null
  phase: UploadPhase
  error: AppErrorShape | null
  dragging?: boolean
  onReset: () => void
  onDisplayName: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  onDragState?: (dragging: boolean) => void
  onDropFiles?: (files: File[]) => void
  onInputChange?: (files: File[]) => void
}

export function UploadFormView(p: UploadFormViewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const busy = BUSY.includes(p.phase.kind)
  const canSubmit = p.file !== null && p.selectError === null && !busy
  const displayNameError = p.error?.fieldErrors?.displayName?.[0]
  return (
    <form
      noValidate
      className="flex flex-col gap-5 sm:max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) p.onSubmit()
      }}
    >
      <FormError error={p.error} knownFields={['displayName']} />
      {p.notice !== null ? (
        <div role="status" className="rounded-lg border px-3 py-2 text-sm">
          {p.notice}
        </div>
      ) : null}

      {p.file === null ? (
        <div
          data-testid="drop-zone"
          className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-10 text-center text-sm ${p.dragging ? 'bg-muted' : ''}`}
          onDragOver={(e: DragEvent) => {
            e.preventDefault()
            p.onDragState?.(true)
          }}
          onDragLeave={() => p.onDragState?.(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault()
            p.onDragState?.(false)
            p.onDropFiles?.(Array.from(e.dataTransfer.files))
          }}
        >
          <p>{FILE_TEXT.dropZoneHint(bytesToMb(p.ctx.maxFileSizeBytes))}</p>
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
            ファイルを選択
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
          <span data-testid="selected-file">{`${p.file.name}（${formatBytes(p.file.size)}）`}</span>
          <Button type="button" variant="outline" size="sm" disabled={busy}
            onClick={() => {
              p.onReset()
              inputRef.current?.click()
            }}
          >
            選び直す
          </Button>
        </div>
      )}
      {/* The input is always rendered so that the picker works from both states; `multiple` is deliberately absent. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="アップロードするファイル"
        onChange={(e) => {
          p.onInputChange?.(Array.from(e.target.files ?? []))
          e.target.value = '' // the same file can be picked again after [選び直す]
        }}
      />
      {p.selectError !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {p.selectError}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">表示名</Label>
        <Input
          id="displayName"
          name="displayName"
          maxLength={200}
          autoComplete="off"
          value={p.displayName}
          disabled={busy}
          onChange={(e) => p.onDisplayName(e.target.value)}
          aria-invalid={displayNameError ? true : undefined}
          aria-describedby={displayNameError ? 'displayName-error' : undefined}
        />
        <FieldError name="displayName" message={displayNameError} />
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p data-testid="quota">
          {FILE_TEXT.quota({
            userUsed: formatBytes(p.ctx.userQuota.usedBytes),
            userLimit: formatBytes(p.ctx.userQuota.limitBytes),
            totalUsed: formatBytes(p.ctx.totalQuota.usedBytes),
            totalLimit: formatBytes(p.ctx.totalQuota.limitBytes),
          })}
        </p>
        <p>{FILE_TEXT.cdnNote}</p>
        <p>{FILE_TEXT.backupNote}</p>
      </div>

      {p.phase.kind === 'uploading' ? (
        <div className="flex flex-col gap-1.5">
          <Progress value={p.phase.percent} aria-label="アップロードの進捗" data-testid="upload-progress" />
          <p className="text-sm" aria-live="polite">{`${p.phase.percent}%`}</p>
        </div>
      ) : null}
      {p.phase.kind === 'starting' || p.phase.kind === 'finalizing' ? (
        <p role="status" className="text-sm">
          {p.phase.kind === 'starting' ? '準備しています…' : '確認しています…'}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {busy ? '処理中…' : 'アップロード'}
        </Button>
        {p.phase.kind === 'uploading' ? (
          <Button type="button" variant="outline" onClick={p.onCancel}>
            キャンセル
          </Button>
        ) : null}
      </div>
    </form>
  )
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const flowDeps: UploadFlowDeps = {
  start: (input) => filesStartUpload(input),
  finalize: (fileId) => filesFinalizeUpload({ fileId }),
  cancel: (fileId) => filesCancelUpload({ fileId }),
  put: uploadWithProgress,
  sleep,
}

export function UploadForm({ folderId, ctx }: { folderId: string; ctx: UploadContext }) {
  const router = useRouter()
  const abortRef = useRef<AbortController | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [selectError, setSelectError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [phase, setPhase] = useState<UploadPhase>({ kind: 'idle' })
  const [error, setError] = useState<AppErrorShape | null>(null)
  const [dragging, setDragging] = useState(false)

  // Leave-page confirmation from starting to finalizing (08 5.6). The browser shows its own text.
  const guarded = phase.kind === 'starting' || phase.kind === 'uploading' || phase.kind === 'finalizing'
  useEffect(() => {
    if (!guarded) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [guarded])

  const choose = (files: File[]): void => {
    const first = files[0]
    if (first === undefined) return
    setError(null)
    setNotice(files.length > 1 ? FILE_TEXT.multipleDropped : null)
    setFile(first)
    setDisplayName(defaultDisplayName(first.name))
    setSelectError(validateUploadFile(first, ctx))
  }

  const reset = (): void => {
    setFile(null)
    setDisplayName('')
    setSelectError(null)
    setNotice(null)
    setError(null)
  }

  const submit = async (): Promise<void> => {
    if (file === null || selectError !== null || guarded) return
    setError(null)
    setNotice(null)
    const ac = new AbortController()
    abortRef.current = ac
    const out = await runUploadFlow(flowDeps, { folderId, file, displayName }, setPhase, ac.signal)
    abortRef.current = null
    if (out.status === 'done') {
      router.push(`/folders/${folderId}/files/${out.fileId}?uploaded=1`)
    } else if (out.status === 'cancelled') {
      setNotice(FILE_TEXT.uploadCancelled)
    } else {
      setError(out.error)
      handleCommonError(out.error, router)
    }
  }

  return (
    <UploadFormView
      ctx={ctx}
      file={file === null ? null : { name: file.name, size: file.size }}
      displayName={displayName}
      selectError={selectError}
      notice={notice}
      phase={phase}
      error={error}
      dragging={dragging}
      onReset={reset}
      onDisplayName={setDisplayName}
      onSubmit={() => void submit()}
      onCancel={() => abortRef.current?.abort()}
      onDragState={setDragging}
      onDropFiles={choose}
      onInputChange={choose}
    />
  )
}
