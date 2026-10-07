'use client'
// 08 5.7 FileInfoForm (S07, admin only): display name and charset are editable, the rest is read-only.
// Only changed fields are sent to filesUpdate; when nothing changed nothing is sent and "変更はありません" is shown.
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { filesUpdate } from '@/app/_actions/files'
import { DateTime } from '@/components/features/common/date-time'
import { FieldError, FormError, FormSuccess } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm, type ActionFormState } from '@/components/features/common/use-action-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FILE_CHARSETS, type FileCharset } from '@/lib/domain'
import type { FileDetail } from '@/lib/dto'
import { formatBytes } from '@/lib/format'
import { FILE_CHARSET_LABELS, FILE_TEXT, FOLDER_TEXT } from '@/lib/messages'

const FIELDS = ['displayName', 'charset'] as const

type UpdateInput = { fileId: string; displayName?: string; charset?: FileCharset }

/** Only the fields that differ from the current values (06 7.4). Empty object = nothing to send. */
export function changedFields(current: { displayName: string; charset: FileCharset }, next: { displayName: string; charset: string }): Omit<UpdateInput, 'fileId'> {
  const out: Omit<UpdateInput, 'fileId'> = {}
  const name = next.displayName.trim()
  if (name !== current.displayName) out.displayName = name
  const charset = FILE_CHARSETS.find((c) => c === next.charset)
  if (charset !== undefined && charset !== current.charset) out.charset = charset
  return out
}

export interface FileInfoFormViewProps {
  file: Pick<FileDetail, 'displayName' | 'originalFilename' | 'sizeBytes' | 'charset' | 'uploadedBy' | 'activatedAt'>
  state: ActionFormState<FileDetail>
  pending: boolean
  noChange: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  fieldError: (name: string) => string | undefined
}

export function FileInfoFormView({ file, state, pending, noChange, onSubmit, fieldError }: FileInfoFormViewProps) {
  const nameError = fieldError('displayName')
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 sm:max-w-2xl" aria-labelledby="file-info-heading">
      <h2 id="file-info-heading" className="text-lg font-semibold">
        基本情報
      </h2>
      <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
      {state !== null && state.ok && !noChange ? <FormSuccess>{FOLDER_TEXT.saved}</FormSuccess> : null}
      {noChange ? (
        <div role="status" className="rounded-lg border px-3 py-2 text-sm">
          {FILE_TEXT.noChanges}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file-displayName">表示名</Label>
        <Input
          id="file-displayName"
          name="displayName"
          defaultValue={file.displayName}
          maxLength={200}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'displayName-error' : undefined}
        />
        <FieldError name="displayName" message={nameError} />
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">元ファイル名</dt>
        <dd className="break-all">{file.originalFilename}</dd>
        <dt className="text-muted-foreground">サイズ</dt>
        <dd>{formatBytes(file.sizeBytes)}</dd>
        <dt className="text-muted-foreground">アップロード</dt>
        <dd>
          {file.uploadedBy.displayName}・<DateTime iso={file.activatedAt} />
        </dd>
      </dl>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file-charset">文字コード</Label>
        <Select name="charset" defaultValue={file.charset}>
          <SelectTrigger id="file-charset" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILE_CHARSETS.map((c) => (
              <SelectItem key={c} value={c}>
                {FILE_CHARSET_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{FILE_TEXT.charsetNote}</p>
        <FieldError name="charset" message={fieldError('charset')} />
      </div>
      <div>
        <SubmitButton pending={pending}>保存</SubmitButton>
      </div>
    </form>
  )
}

export function FileInfoForm({ fileId, file }: { fileId: string; file: FileInfoFormViewProps['file'] }) {
  const router = useRouter()
  const [noChange, setNoChange] = useState(false)
  const { state, pending, onSubmit, fieldError } = useActionForm<UpdateInput, FileDetail>({
    action: filesUpdate,
    toInput: (fd) => ({
      fileId,
      ...changedFields(file, { displayName: String(fd.get('displayName') ?? ''), charset: String(fd.get('charset') ?? '') }),
    }),
    onSuccess: () => router.refresh(),
  })
  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    const fd = new FormData(e.currentTarget)
    const changed = changedFields(file, { displayName: String(fd.get('displayName') ?? ''), charset: String(fd.get('charset') ?? '') })
    if (Object.keys(changed).length === 0) {
      e.preventDefault()
      setNoChange(true)
      return
    }
    setNoChange(false)
    onSubmit(e)
  }
  return <FileInfoFormView file={file} state={state} pending={pending} noChange={noChange} onSubmit={handleSubmit} fieldError={fieldError} />
}
