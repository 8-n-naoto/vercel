'use client'
// 08 4.9 RestrictionsForm (S07, admin only). Dates are Japan time in the inputs and go out as ISO with +09:00 (08 6.3).
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { filesUpdateRestrictions } from '@/app/_actions/files'
import { DateTimeField } from '@/components/features/common/date-time-field'
import { FormError, FormSuccess } from '@/components/features/common/form-message'
import { StatusBadge } from '@/components/features/common/status-badge'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm, type ActionFormState } from '@/components/features/common/use-action-form'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { jstInputToIso } from '@/lib/datetime'
import type { FileDetail, FileRestrictions } from '@/lib/dto'
import { FILE_TEXT, message } from '@/lib/messages'
import { validateRestrictions } from '@/lib/schemas/restrictions'

const FIELDS = ['suspended', 'viewStartsAt', 'viewEndsAt', 'expiresAt', 'downloadAllowed'] as const
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/** Client-side check before sending (07 12): the same rules as the server, so the message appears without a round trip (S07-2). */
export function checkRestrictionsInput(
  next: { viewStartsAt: string | null; viewEndsAt: string | null; expiresAt: string | null },
  currentExpiresAt: string | null,
  now: Date,
): Record<string, string> {
  const toDate = (iso: string | null): Date | null => {
    if (iso === null) return null
    if (!ISO_WITH_OFFSET.test(iso)) return null // anything else is left to the server's format check (Date.parse would accept local-time notations)
    const ms = Date.parse(iso)
    return Number.isNaN(ms) ? null : new Date(ms)
  }
  const errs = validateRestrictions(
    { viewStartsAt: toDate(next.viewStartsAt), viewEndsAt: toDate(next.viewEndsAt), expiresAt: toDate(next.expiresAt) },
    { expiresAt: toDate(currentExpiresAt) },
    now,
  )
  const out: Record<string, string> = {}
  if (errs.viewEndsAt) out.viewEndsAt = message(errs.viewEndsAt)
  if (errs.expiresAt) out.expiresAt = message(errs.expiresAt)
  return out
}

export interface RestrictionsFormViewProps {
  restrictions: FileRestrictions
  displayState: FileDetail['displayState']
  state: ActionFormState<FileDetail>
  pending: boolean
  suspended: boolean
  downloadAllowed: boolean
  onSuspended: (v: boolean) => void
  onDownloadAllowed: (v: boolean) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  fieldError: (name: string) => string | undefined
}

export function RestrictionsFormView(p: RestrictionsFormViewProps) {
  // After a successful save the badge follows the returned FileDetail (08 4.9).
  const saved = p.state !== null && p.state.ok ? p.state.data : null
  const shownState = saved?.displayState ?? p.displayState
  const shownStarts = saved?.restrictions.viewStartsAt ?? p.restrictions.viewStartsAt
  return (
    <form onSubmit={p.onSubmit} noValidate className="flex flex-col gap-5 sm:max-w-2xl" aria-labelledby="restrictions-heading">
      <h2 id="restrictions-heading" className="text-lg font-semibold">
        {FILE_TEXT.restrictionsHeading}
      </h2>
      <p className="flex items-center gap-2 text-sm">
        現在の状態: <StatusBadge kind="file" value={shownState} viewStartsAt={shownStarts} />
      </p>
      <FormError error={p.state !== null && !p.state.ok ? p.state.error : null} knownFields={FIELDS} />
      {saved !== null ? <FormSuccess>保存しました</FormSuccess> : null}

      <input type="hidden" name="suspended" value={String(p.suspended)} />
      <input type="hidden" name="downloadAllowed" value={String(p.downloadAllowed)} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">公開状態</legend>
        <RadioGroup value={p.suspended ? 'suspended' : 'public'} onValueChange={(v) => p.onSuspended(v === 'suspended')} aria-label="公開状態">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="public" id="restrict-public" />
            <Label htmlFor="restrict-public">公開する</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="suspended" id="restrict-suspended" />
            <Label htmlFor="restrict-suspended">公開を停止する</Label>
          </div>
        </RadioGroup>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">公開期間</legend>
        <div className="flex flex-wrap items-start gap-3">
          <DateTimeField name="viewStartsAt" label="開始" defaultIso={p.restrictions.viewStartsAt} clearable error={p.fieldError('viewStartsAt')} />
          <span aria-hidden="true" className="pt-8">
            〜
          </span>
          <DateTimeField name="viewEndsAt" label="終了" defaultIso={p.restrictions.viewEndsAt} clearable error={p.fieldError('viewEndsAt')} />
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <DateTimeField name="expiresAt" label="有効期限" defaultIso={p.restrictions.expiresAt} clearable error={p.fieldError('expiresAt')} />
        <p className="text-sm text-muted-foreground">{FILE_TEXT.expiresNote}</p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">ダウンロード</span>
        <div className="flex items-center gap-2">
          <Checkbox id="restrict-download" checked={p.downloadAllowed} onCheckedChange={(v) => p.onDownloadAllowed(v === true)} />
          <Label htmlFor="restrict-download">許可する</Label>
        </div>
        <p className="text-sm text-muted-foreground">{FILE_TEXT.downloadNote}</p>
      </div>

      <div>
        <SubmitButton pending={p.pending}>保存</SubmitButton>
      </div>
    </form>
  )
}

export function RestrictionsForm({ fileId, restrictions, displayState }: { fileId: string; restrictions: FileRestrictions; displayState: FileDetail['displayState'] }) {
  const router = useRouter()
  const [suspended, setSuspended] = useState(restrictions.suspended)
  const [downloadAllowed, setDownloadAllowed] = useState(restrictions.downloadAllowed)
  const { state, pending, onSubmit, fieldError } = useActionForm<Parameters<typeof filesUpdateRestrictions>[0], FileDetail>({
    action: filesUpdateRestrictions,
    toInput: (fd) => {
      const viewStartsAt = jstInputToIso(fd.get('viewStartsAt'))
      const viewEndsAt = jstInputToIso(fd.get('viewEndsAt'))
      const expiresAt = jstInputToIso(fd.get('expiresAt'))
      const clientError = checkRestrictionsInput({ viewStartsAt, viewEndsAt, expiresAt }, restrictions.expiresAt, new Date())
      if (Object.keys(clientError).length > 0) return { clientError }
      return {
        fileId,
        suspended: fd.get('suspended') === 'true',
        viewStartsAt,
        viewEndsAt,
        expiresAt,
        downloadAllowed: fd.get('downloadAllowed') === 'true',
      }
    },
    onSuccess: () => router.refresh(),
  })
  return (
    <RestrictionsFormView
      restrictions={restrictions}
      displayState={displayState}
      state={state}
      pending={pending}
      suspended={suspended}
      downloadAllowed={downloadAllowed}
      onSuspended={setSuspended}
      onDownloadAllowed={setDownloadAllowed}
      onSubmit={onSubmit}
      fieldError={fieldError}
    />
  )
}
