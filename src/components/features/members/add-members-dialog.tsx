'use client'
// 08 4.7 D02. Candidates are passed in by the page (members.listCandidates); the dialog never fetches them.
// Selection is kept in state, so it survives changes of the filter text. Rendered for admins only (UX; members.add is admin-only on the server).
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { membersAdd } from '@/app/_actions/members'
import { EmptyState } from '@/components/features/common/empty-state'
import { FormError, FormSuccess } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm, type ActionFormState } from '@/components/features/common/use-action-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { MemberCandidate } from '@/lib/dto'
import { FOLDER_TEXT, membersAddedText } from '@/lib/messages'

export const MAX_ADD_MEMBERS = 50

/** Trimmed, case-insensitive partial match on display name or email (08 4.7). An empty query keeps everyone. */
export function filterCandidates(candidates: readonly MemberCandidate[], query: string): MemberCandidate[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...candidates]
  return candidates.filter((c) => c.displayName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
}

export interface AddMembersFormViewProps {
  candidates: readonly MemberCandidate[]
  query: string
  onQueryChange: (q: string) => void
  selected: ReadonlySet<string>
  onToggle: (userId: string, checked: boolean) => void
  state: ActionFormState<unknown>
  pending: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  onCancel?: () => void
}

/** Pure view of the dialog body. The selected ids are sent as hidden inputs, so hidden (filtered-out) candidates are still submitted. */
export function AddMembersFormView(p: AddMembersFormViewProps) {
  if (p.candidates.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          action={
            <Link href="/admin/invites" className="underline underline-offset-4">
              招待する
            </Link>
          }
        >
          {FOLDER_TEXT.candidatesEmpty}
        </EmptyState>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={p.onCancel}>
            キャンセル
          </Button>
        </DialogFooter>
      </div>
    )
  }
  const shown = filterCandidates(p.candidates, p.query)
  const atLimit = p.selected.size >= MAX_ADD_MEMBERS
  return (
    <form onSubmit={p.onSubmit} noValidate className="flex flex-col gap-4">
      <FormError error={p.state !== null && !p.state.ok ? p.state.error : null} knownFields={[]} />
      <Input
        type="search"
        aria-label="絞り込み"
        placeholder="表示名・メールで絞り込み"
        autoComplete="off"
        value={p.query}
        onChange={(e) => p.onQueryChange(e.target.value)}
      />
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" aria-label="追加できるユーザー">
        {shown.map((c) => {
          const checked = p.selected.has(c.userId)
          return (
            <li key={c.userId}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                <input type="checkbox" checked={checked} disabled={!checked && atLimit} onChange={(e) => p.onToggle(c.userId, e.target.checked)} />
                <span className="font-medium">{c.displayName}</span>
                <span className="text-muted-foreground">{c.email}</span>
              </label>
            </li>
          )
        })}
      </ul>
      {[...p.selected].map((id) => (
        <input key={id} type="hidden" name="userIds" value={id} />
      ))}
      <p role="status" className="text-sm">{`${p.selected.size} 人選択中`}</p>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={p.pending} onClick={p.onCancel}>
          キャンセル
        </Button>
        <SubmitButton pending={p.pending} disabled={p.selected.size === 0}>
          追加
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}

// The hook lives inside DialogContent so that each opening starts from an empty selection and a clean error state.
function AddMembersForm({
  folderId,
  candidates,
  onCancel,
  onAdded,
}: {
  folderId: string
  candidates: readonly MemberCandidate[]
  onCancel: () => void
  onAdded: (r: { added: number; skipped: number }) => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const { state, pending, onSubmit } = useActionForm({
    action: async (input: { folderId: string; userIds: string[] }) => {
      const r = await membersAdd(input)
      if (!r.ok && r.error.fieldErrors?.['userIds']) router.refresh() // member.invalid_target: reload the candidates (08 4.7)
      return r
    },
    toInput: (fd) => ({ folderId, userIds: fd.getAll('userIds').map(String) }),
    onSuccess: (data) => {
      onAdded(data)
      onCancel()
      router.refresh()
    },
  })
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>メンバー追加</DialogTitle>
      </DialogHeader>
      <AddMembersFormView
        candidates={candidates}
        query={query}
        onQueryChange={setQuery}
        selected={selected}
        onToggle={(id, checked) =>
          setSelected((prev) => {
            const next = new Set(prev)
            if (checked) next.add(id)
            else next.delete(id)
            return next
          })
        }
        state={state}
        pending={pending}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  )
}

export function AddMembersDialog({ folderId, candidates }: { folderId: string; candidates: readonly MemberCandidate[] }) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <FormSuccess>{notice}</FormSuccess>
      <div>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (next) setNotice(null)
          }}
        >
          <DialogTrigger asChild>
            <Button type="button">+ メンバー追加</Button>
          </DialogTrigger>
          <DialogContent showCloseButton={false} className="sm:max-w-lg">
            <AddMembersForm folderId={folderId} candidates={candidates} onCancel={() => setOpen(false)} onAdded={(r) => setNotice(membersAddedText(r))} />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
